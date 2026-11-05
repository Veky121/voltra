/* Initial document load only. Shared by the browser and desktop Vite builds. */
(() => {
  const root = document.getElementById('root');
  if (!root || document.getElementById('voltra-startup')) return;
  const splash = document.createElement('div');
  splash.innerHTML = `<div class="startup" id="voltra-startup" role="status" aria-label="Opening Voltra"><div class="voltra-startup-identity"><svg class="voltra-startup-liquid" viewBox="-60 -50 120 100" role="img" aria-label="Voltra liquid logo"><defs><filter id="clean-liquid" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="4"/><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 24 -9"/></filter></defs><g filter="url(#clean-liquid)" fill="#abcaff"><ellipse cx="-24.25" cy="-14" rx="12" ry="12"/><ellipse cx="0" cy="28" rx="12" ry="12"/><ellipse cx="24.25" cy="-14" rx="12" ry="12"/></g></svg><p class="voltra-startup-wordmark">Voltra</p><div class="voltra-startup-beam-track" aria-hidden="true"></div></div></div>`;
  const overlay = splash.firstElementChild;
  document.body.append(overlay);
  const wasInert = root.inert;
  root.inert = true;
  const dots = overlay.querySelectorAll('ellipse');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let elapsed = 0, last = 0, finishAt = null, captured = null, current = [];
  let frameId = 0, checkId = 0, stopped = false;
  const ease = x => { x = Math.min(1, Math.max(0, x)); return x*x*x*(x*(x*6-15)+10); };
  function remove() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frameId);
    clearTimeout(checkId);
    clearTimeout(watchdog);
    observer.disconnect();
    window.removeEventListener('error', assetError, true);
    overlay.remove();
    root.inert = wasInert;
  }
  function pending() {
    if (!root.firstElementChild) return true;
    // Expose real recovery screens instead of hiding them behind a spinner.
    if (root.querySelector('[role="alert"]')) return false;
    return !!root.querySelector('.loading, .loading-skeleton, [aria-busy="true"]') ||
      [...root.querySelectorAll('[role="status"]')].some(node => /^loading\b/i.test(node.textContent.trim()));
  }
  function check() {
    clearTimeout(checkId);
    if (pending()) {
      finishAt = null;
      overlay.classList.remove('settled', 'leaving');
      return;
    }
    // Allow chained gate renders, cached requests and lazy routes to commit.
    checkId = setTimeout(() => {
      if (stopped || pending() || finishAt !== null || !current.length) return;
      captured = current.map(point => ({...point}));
      finishAt = performance.now();
    }, 100);
  }
  const observer = new MutationObserver(check);
  observer.observe(root, {childList:true, subtree:true, attributes:true, characterData:true});
  function assetError(event) {
    if (event.target instanceof HTMLScriptElement) remove();
  }
  window.addEventListener('error', assetError, true);
  // A stalled dependency must never permanently cover a retry/login screen.
  const watchdog = setTimeout(remove, 20000);
  function frame(now) {
    const dt = last ? Math.min(now-last,50) : 0;
    last = now;
    if (finishAt === null && !reduced.matches) elapsed += dt;
    const half=elapsed/2700, phase=half%1;
    const direction=(Math.floor(half)%2===0?1:-1)*(phase<.5?1:-1);
    const spread=phase<.5?1-ease((phase-.12)/.3):ease((phase-.58)/.3);
    const stretch=reduced.matches?0:.075*Math.sin(Math.PI*spread)**2;
    const age=finishAt===null?0:now-finishAt, converge=ease(age/280);
    current=[];
    dots.forEach((dot,i) => {
      let x=(i-1)*24.25*spread, y=(i===1?28:-14)*direction*spread;
      let r=12+5*(1-spread), s=stretch;
      if(finishAt!==null){x=captured[i].x*(1-converge);y=captured[i].y*(1-converge);r=captured[i].r+(17-captured[i].r)*converge;s=captured[i].s*(1-converge);}
      current.push({x,y,r,s});
      dot.setAttribute('cx',x);dot.setAttribute('cy',y);
      dot.setAttribute('rx',r*(1+s));dot.setAttribute('ry',r/(1+s));
      dot.setAttribute('transform',`rotate(${Math.atan2(y,x)*180/Math.PI} ${x} ${y})`);
    });
    if(finishAt!==null){
      if(reduced.matches){remove();return;}
      if(age>=280)overlay.classList.add('settled');
      if(age>=430)overlay.classList.add('leaving');
      if(age>=580){remove();return;}
    }
    frameId=requestAnimationFrame(frame);
  }
  frameId=requestAnimationFrame(frame);
  check();
})();
