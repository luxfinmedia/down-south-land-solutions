/**
 * Down South Land Solutions — lead endpoint.
 *
 * Everything on this site is a static asset except POST /api/lead, which takes
 * the estimate form and pushes it into GoHighLevel as:
 *   1. a contact (upserted, so repeat enquiries don't duplicate)
 *   2. an opportunity in the pipeline's "New Lead" stage, named after the person
 *   3. a note on that contact holding every field they filled in
 *
 * Configuration lives in Cloudflare, never in this file — the repo is public.
 *   GHL_TOKEN        secret  Private Integration Token from GoHighLevel
 *   GHL_LOCATION_ID  var     the sub-account id
 *   GHL_PIPELINE_ID  var     optional; first pipeline is used when unset
 *   GHL_STAGE_ID     var     optional; the "New Lead" stage is found by name
 *   GHL_SETUP_KEY    var     optional; enables GET /api/ghl-check?key=… while wiring up
 */

const GHL = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";
const SITE = "dsland.solutions";

/* Pipeline lookups are stable, so cache per isolate rather than per request. */
let pipelineCache = null;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function ghlFetch(token, path, init = {}) {
  return fetch(GHL + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: API_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function readBody(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 400) }; }
}

/* ------------------------------------------------------------------ helpers */

function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** GHL wants E.164. Ten digits is a US number; eleven starting with 1 likewise. */
function normalisePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d[0] === "1") return "+" + d;
  if (d.length > 11) return "+" + d;
  return String(raw || "").trim();
}

function prettyPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  const t = d.length === 11 && d[0] === "1" ? d.slice(1) : d;
  return t.length === 10 ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : String(raw || "");
}

function centralTime(d = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short",
    }).format(d) + " CT";
  } catch { return d.toISOString(); }
}

function clean(v, max = 2000) {
  return String(v == null ? "" : v).replace(/\r\n/g, "\n").trim().slice(0, max);
}

/* --------------------------------------------------------------- GHL calls */

async function upsertContact(token, locationId, lead) {
  const { firstName, lastName } = splitName(lead.full_name);
  const payload = {
    locationId,
    firstName,
    lastName,
    name: lead.full_name,
    phone: normalisePhone(lead.phone),
    source: `Website — ${SITE}`,
    tags: ["website lead", "dsland.solutions"],
  };
  if (lead.email) payload.email = lead.email;

  let res = await ghlFetch(token, "/contacts/upsert", {
    method: "POST", body: JSON.stringify(payload),
  });

  /* Older sub-accounts don't expose /contacts/upsert — fall back to
     search-then-create/update so the lead still lands. */
  if (res.status === 404 || res.status === 405) {
    const q = new URLSearchParams({ locationId });
    if (lead.email) q.set("email", lead.email);
    else q.set("phone", payload.phone);
    const found = await ghlFetch(token, `/contacts/search/duplicate?${q}`, { method: "GET" });
    const dup = found.ok ? await readBody(found) : null;
    const existing = dup && (dup.contact || (dup.contacts && dup.contacts[0]));
    if (existing && existing.id) {
      const { locationId: _drop, ...update } = payload;
      res = await ghlFetch(token, `/contacts/${existing.id}`, {
        method: "PUT", body: JSON.stringify(update),
      });
    } else {
      res = await ghlFetch(token, "/contacts", { method: "POST", body: JSON.stringify(payload) });
    }
  }

  const body = await readBody(res);
  const id = body?.contact?.id || body?.id || body?.contactId || null;
  return { ok: res.ok && !!id, status: res.status, id, body };
}

/** Find the pipeline and the stage the client calls "New Lead". */
async function resolveStage(token, locationId, env) {
  if (env.GHL_PIPELINE_ID && env.GHL_STAGE_ID) {
    return { ok: true, pipelineId: env.GHL_PIPELINE_ID, stageId: env.GHL_STAGE_ID };
  }
  if (pipelineCache) return pipelineCache;

  const res = await ghlFetch(token, `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { method: "GET" });
  const body = await readBody(res);
  const pipelines = body?.pipelines || [];
  if (!res.ok || !pipelines.length) {
    return { ok: false, status: res.status, body };
  }

  const pipeline = env.GHL_PIPELINE_ID
    ? pipelines.find(p => p.id === env.GHL_PIPELINE_ID) || pipelines[0]
    : pipelines[0];
  const stages = pipeline.stages || [];
  const byName = stages.find(s => /new\s*lead/i.test(s.name || ""));
  const stage = env.GHL_STAGE_ID
    ? stages.find(s => s.id === env.GHL_STAGE_ID) || byName || stages[0]
    : byName || stages[0];

  const out = { ok: !!stage, pipelineId: pipeline.id, stageId: stage?.id, stageName: stage?.name, pipelineName: pipeline.name };
  if (out.ok) pipelineCache = out;
  return out;
}

async function createOpportunity(token, locationId, contactId, lead, stage) {
  const service = lead.service ? ` — ${lead.service}` : "";
  const payload = {
    locationId,
    contactId,
    pipelineId: stage.pipelineId,
    pipelineStageId: stage.stageId,
    name: `${lead.full_name}${service}`,
    status: "open",
  };
  const res = await ghlFetch(token, "/opportunities/", { method: "POST", body: JSON.stringify(payload) });
  const body = await readBody(res);
  return { ok: res.ok, status: res.status, id: body?.opportunity?.id || body?.id || null, body };
}

function noteBody(lead) {
  const row = (label, value) => (value ? `${label.padEnd(10)}${value}\n` : "");
  let out = `New website lead — ${SITE}\n\n`;
  out += row("Name:", lead.full_name);
  out += row("Phone:", prettyPhone(lead.phone));
  out += row("Email:", lead.email);
  out += row("County:", lead.county);
  out += row("Service:", lead.service);
  out += row("Job size:", lead.job_size);
  if (lead.details) out += `\nWhat they wrote:\n${lead.details}\n`;
  out += `\nSubmitted: ${centralTime()}\n`;
  out += `From page: ${lead.page || "/contact/"}\n`;
  return out;
}

async function addNote(token, contactId, lead) {
  const res = await ghlFetch(token, `/contacts/${contactId}/notes`, {
    method: "POST", body: JSON.stringify({ body: noteBody(lead) }),
  });
  const body = await readBody(res);
  return { ok: res.ok, status: res.status, body };
}

/* ------------------------------------------------------------------ routes */

async function handleLead(request, env, ctx) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let data;
  try {
    const raw = await request.text();
    if (raw.length > 20000) return json({ ok: false, error: "too_large" }, 413);
    data = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  /* Bots fill hidden fields and submit instantly. Both look like success to
     them so they don't retune and come back. */
  const elapsed = Number(data.ts) ? Date.now() - Number(data.ts) : 99999;
  if (clean(data.company) || elapsed < 2500) {
    return json({ ok: true, filtered: true });
  }

  const lead = {
    full_name: clean(data.full_name, 120),
    phone: clean(data.phone, 40),
    email: clean(data.email, 160),
    county: clean(data.county, 80),
    service: clean(data.service, 120),
    job_size: clean(data.job_size, 80),
    details: clean(data.details, 4000),
    page: clean(data.page_context || data.page, 200),
  };
  if (!lead.full_name || !lead.phone) return json({ ok: false, error: "missing_fields" }, 422);

  const token = env.GHL_TOKEN;
  const locationId = env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    console.error("GHL not configured — lead not forwarded:", JSON.stringify(lead));
    return json({ ok: true, forwarded: false, reason: "not_configured" });
  }

  const result = { contact: false, opportunity: false, note: false };
  try {
    const contact = await upsertContact(token, locationId, lead);
    result.contact = contact.ok;
    if (!contact.ok) {
      console.error("GHL contact failed", contact.status, JSON.stringify(contact.body), JSON.stringify(lead));
      return json({ ok: true, forwarded: false, result });
    }

    /* The note is the part Joe reads, so write it before the opportunity —
       if anything downstream fails the detail is already saved on the contact. */
    const note = await addNote(token, contact.id, lead);
    result.note = note.ok;
    if (!note.ok) console.error("GHL note failed", note.status, JSON.stringify(note.body));

    const stage = await resolveStage(token, locationId, env);
    if (stage.ok) {
      const opp = await createOpportunity(token, locationId, contact.id, lead, stage);
      result.opportunity = opp.ok;
      if (!opp.ok) console.error("GHL opportunity failed", opp.status, JSON.stringify(opp.body));
    } else {
      console.error("GHL pipeline lookup failed", stage.status, JSON.stringify(stage.body));
    }

    if (!result.opportunity || !result.note) console.error("Lead payload for recovery:", JSON.stringify(lead));
    return json({ ok: true, forwarded: result.contact, result });
  } catch (err) {
    console.error("GHL threw", String(err), JSON.stringify(lead));
    return json({ ok: true, forwarded: false, error: "upstream" });
  }
}

/** Setup helper: confirms the token works and prints pipeline + stage ids.
 *  Disabled unless GHL_SETUP_KEY is set, and meant to be removed afterwards. */
async function handleCheck(request, env) {
  const key = new URL(request.url).searchParams.get("key");
  if (!env.GHL_SETUP_KEY || key !== env.GHL_SETUP_KEY) {
    return new Response("Not found", { status: 404 });
  }
  const token = env.GHL_TOKEN, locationId = env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    return json({ ok: false, token: !!token, locationId: !!locationId, hint: "Set GHL_TOKEN and GHL_LOCATION_ID" });
  }
  /* Probe each endpoint the lead flow uses and report exactly what GHL says,
     so a scope or header problem names itself instead of being guessed at. */
  const probe = async (label, path, version) => {
    const r = await fetch(GHL + path, {
      headers: { Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" },
    });
    const b = await readBody(r);
    return { label, version, status: r.status, message: b?.message || b?.error || (r.ok ? "ok" : JSON.stringify(b).slice(0, 160)) };
  };
  const loc = encodeURIComponent(locationId);
  const probes = [
    await probe("pipelines", `/opportunities/pipelines?locationId=${loc}`, "2021-07-28"),
    await probe("pipelines v3", `/opportunities/pipelines?locationId=${loc}`, "v3"),
    await probe("contacts", `/contacts/?locationId=${loc}&limit=1`, "2021-07-28"),
    await probe("location", `/locations/${loc}`, "2021-07-28"),
  ];

  const res = await ghlFetch(token, `/opportunities/pipelines?locationId=${loc}`, { method: "GET" });
  const body = await readBody(res);
  if (!res.ok) return json({ ok: false, status: res.status, body, tokenPrefix: String(token).slice(0, 8),
                             tokenLength: String(token).length, locationId, probes });
  const pipelines = (body.pipelines || []).map(p => ({
    id: p.id, name: p.name,
    stages: (p.stages || []).map(s => ({ id: s.id, name: s.name })),
  }));
  const chosen = await resolveStage(token, locationId, env);
  return json({ ok: true, pipelines, willUse: chosen, probes });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/lead") return handleLead(request, env, ctx);
    if (pathname === "/api/ghl-check") return handleCheck(request, env);
    return env.ASSETS.fetch(request);
  },
};
