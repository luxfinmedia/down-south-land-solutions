(function(){
  /* every page opens at the top — never halfway down where the last one was */
  try{ if('scrollRestoration' in history) history.scrollRestoration='manual'; }catch(e){}
  function toTop(){ if(!location.hash) window.scrollTo(0,0); }
  toTop();
  window.addEventListener('pageshow',toTop);
  window.addEventListener('load',toTop);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',toTop);

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  if(!reduced) root.classList.add('anim');

  /* ---------------- nav dropdowns ----------------
     Hover opens, moving the mouse away closes it on its own after a short
     grace period. Keyboard still works, Escape closes, and a click anywhere
     outside closes — no more menus stuck open waiting to be clicked off. */
  function dropdowns(){
    var drops=[].slice.call(document.querySelectorAll('.drop'));
    if(!drops.length) return;
    var openOne=null, timer=null;

    function close(dr){ if(!dr) return; dr.classList.remove('open');
      var t=dr.querySelector(':scope > a'); if(t) t.setAttribute('aria-expanded','false');
      if(openOne===dr) openOne=null; }
    function closeAll(){ drops.forEach(close); }
    function open(dr){ clearTimeout(timer); if(openOne&&openOne!==dr) close(openOne);
      dr.classList.add('open');
      var t=dr.querySelector(':scope > a'); if(t) t.setAttribute('aria-expanded','true');
      openOne=dr; }
    function scheduleClose(dr){ clearTimeout(timer); timer=setTimeout(function(){ close(dr); },140); }

    drops.forEach(function(dr){
      var top=dr.querySelector(':scope > a');
      if(top){ top.setAttribute('aria-haspopup','true'); top.setAttribute('aria-expanded','false'); }
      dr.addEventListener('mouseenter',function(){ open(dr); });
      dr.addEventListener('mouseleave',function(){ scheduleClose(dr); });
      dr.addEventListener('focusin',function(){ open(dr); });
      dr.addEventListener('focusout',function(){
        setTimeout(function(){ if(!dr.contains(document.activeElement)) close(dr); },0);
      });
    });

    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'&&openOne){ var t=openOne.querySelector(':scope > a'); close(openOne); if(t) t.focus(); }
    });
    document.addEventListener('pointerdown',function(e){
      if(openOne&&!openOne.contains(e.target)) close(openOne);
    });
    /* a pointer that leaves the header entirely closes whatever is open */
    var head=document.querySelector('.head');
    if(head) head.addEventListener('mouseleave',function(){ if(openOne) scheduleClose(openOne); });
    window.addEventListener('blur',closeAll);
    window.addEventListener('scroll',function(){ if(openOne) closeAll(); },{passive:true});
  }

  /* ---------------- sticky header state ---------------- */
  function headerState(){
    var h=document.querySelector('.head'); if(!h) return;
    var on=false;
    function tick(){ var want=window.scrollY>18; if(want!==on){on=want;h.classList.toggle('scrolled',on);} }
    tick(); window.addEventListener('scroll',tick,{passive:true});
  }

  /* ---------------- reveal on scroll ----------------
     Markup is untouched: the hidden state is added here, so a page with no
     JS (or with reduced motion asked for) renders complete and static. */
  /* Text blocks fade up. Anything picture-led is deliberately left alone —
     photos just appear, no slide, no wipe. */
  var REVEAL = [
    ['.sec-head',1],['.eyebrow',1],['.blk',1],['.lede',1],
    ['.fact',1],['.feature-body',1],
    ['.faq details',1],['.areacol',1],['.ctychips',1],['.townchips',1],
    ['.speclist li',1],['.tablewrap',1],['.q-side',1],['.quote',1],['.ctaband-in',1]
  ];
  function reveals(){
    if(reduced||!('IntersectionObserver' in window)) return;
    var seen=[];
    REVEAL.forEach(function(pair){
      [].slice.call(document.querySelectorAll(pair[0])).forEach(function(el){
        if(el.closest('.hero')||el.closest('.head')) return;      /* above the fold stays put */
        if(seen.indexOf(el)>-1) return; seen.push(el);
        el.classList.add('rv');
      });
    });
    /* stagger siblings so groups cascade instead of popping together */
    var groups={};
    seen.forEach(function(el){
      var p=el.parentNode; var i=groups[p]===undefined?0:groups[p];
      if(i<5) el.style.setProperty('--d',(i*45)+'ms');
      groups[p]=i+1;
    });
    var io=new IntersectionObserver(function(en){
      en.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target);} });
    },{rootMargin:'0px 0px -6% 0px',threshold:0.05});
    seen.forEach(function(el){ io.observe(el); });
    setTimeout(function(){ seen.forEach(function(el){ el.classList.add('in'); }); },2500);
  }

  /* ---------------- hero parallax + counters ---------------- */
  function parallax(){
    if(reduced) return;
    var layers=[].slice.call(document.querySelectorAll('.hero-bg img,.phero-bg img,.band-bg img,.gphero-bg img'));
    if(!layers.length) return;
    var ticking=false;
    function frame(){
      var y=window.scrollY;
      layers.forEach(function(im){
        var box=im.parentNode.getBoundingClientRect();
        if(box.bottom<-200||box.top>window.innerHeight+200) return;
        im.style.transform='translate3d(0,'+(y*0.11).toFixed(1)+'px,0) scale(1.12)';
      });
      ticking=false;
    }
    window.addEventListener('scroll',function(){ if(!ticking){ticking=true;requestAnimationFrame(frame);} },{passive:true});
    frame();
  }

  function counters(){
    if(reduced||!('IntersectionObserver' in window)) return;
    var els=[].slice.call(document.querySelectorAll('.fact .k,.facts .k')).filter(function(el){
      return /^\s*\d+[+%]?\s*$/.test(el.textContent);
    });
    if(!els.length) return;
    var io=new IntersectionObserver(function(en){
      en.forEach(function(e){
        if(!e.isIntersecting) return; io.unobserve(e.target);
        var el=e.target, raw=el.textContent.trim(), suffix=raw.replace(/[0-9]/g,'');
        var to=parseInt(raw,10), t0=null;
        function step(t){ if(t0===null)t0=t; var p=Math.min((t-t0)/900,1);
          el.textContent=Math.round(to*(1-Math.pow(1-p,3)))+suffix;
          if(p<1) requestAnimationFrame(step); }
        el.textContent='0'+suffix; requestAnimationFrame(step);
      });
    },{threshold:.5});
    els.forEach(function(el){ io.observe(el); });
  }

  var b=document.getElementById('burger'),d=document.getElementById('drawer');
  if(b&&d){b.addEventListener('click',function(){var o=b.getAttribute('aria-expanded')==='true';
    b.setAttribute('aria-expanded',String(!o));d.classList.toggle('open',!o);});
    d.addEventListener('click',function(e){if(e.target.tagName==='A'){b.setAttribute('aria-expanded','false');d.classList.remove('open');}});
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'&&d.classList.contains('open')){b.setAttribute('aria-expanded','false');d.classList.remove('open');b.focus();}});}

  /* ---------------- reading progress ---------------- */
  function progress(){
    if(reduced) return;
    var bar=document.createElement('div'); bar.className='prog'; document.body.appendChild(bar);
    var ticking=false;
    function frame(){
      var h=document.documentElement.scrollHeight-window.innerHeight;
      bar.style.transform='scaleX('+(h>0?Math.min(window.scrollY/h,1):0)+')';
      ticking=false;
    }
    window.addEventListener('scroll',function(){ if(!ticking){ticking=true;requestAnimationFrame(frame);} },{passive:true});
    window.addEventListener('resize',frame); frame();
  }

  dropdowns(); headerState(); reveals(); parallax(); counters(); progress();

  var ck=document.getElementById('cookie');
  function pref(v){try{localStorage.setItem('dsls_cookie',v);}catch(e){} if(ck) ck.hidden=true;}
  try{ if(ck && !localStorage.getItem('dsls_cookie')) ck.hidden=false; }catch(e){ if(ck) ck.hidden=false; }
  var ok=document.getElementById('ckOk'),no=document.getElementById('ckNo');
  if(ok) ok.addEventListener('click',function(){pref('all');});
  if(no) no.addEventListener('click',function(){pref('essential');});

  /* ---------------------------------------------------------------
     ESTIMATE FORM — static until GoHighLevel is connected.
     To wire it up, either:
       (a) replace the <form> markup with the GHL embed, or
       (b) set ENDPOINT below to the GHL inbound webhook URL.
     Field names are already GHL-friendly: full_name, phone, email,
     county, service, job_size, details, page_context.
     --------------------------------------------------------------- */
  var ENDPOINT = '';
  var f=document.getElementById('quoteForm');
  if(!f) return;
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var need=['q-name','q-phone','q-county','q-service'],ok=true,first=null;
    need.forEach(function(id){var el=document.getElementById(id);
      if(!el) return;
      if(!el.value.trim()){el.classList.add('bad');ok=false;first=first||el;}else{el.classList.remove('bad');}});
    if(!ok){first.focus();return;}
    function done(){f.classList.add('done');f.querySelector('.sent').scrollIntoView({block:'center',behavior:'smooth'});}
    if(!ENDPOINT){done();return;}
    fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.fromEntries(new FormData(f).entries()))}).then(done).catch(done);
  });
})();