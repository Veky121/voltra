/* Initial document load only. Shared by the browser and desktop Vite builds. */
/* Two head starts while the bundle is still downloading and compiling. Neither
   may stop the splash below, so a failure here only loses the head start. */
(() => {
  try {
    // The desktop app's host asks the panel for these reads as its process starts
    // and answers each the moment the app asks (desktop/boot.go), so the page
    // starts none of its own there. They would save nothing, and while a panel is
    // slow to answer they would hold every connection the WebView allows this
    // origin, which the window's own buttons need as well.
    if (!document.documentElement.hasAttribute('data-voltra-desktop')) {
      // The first reads. src/bootReads.ts hands each answer to the request that asks.
      const paths = ['/api/setup/status'];
      let signedIn = false, revision;
      // The session revision as these reads begin (src/signedOut.ts moves it at every
      // sign-out): an answer is used only if nobody signed out or in meanwhile. Where
      // storage cannot be read there is no such signal, so nothing that depends on
      // who is signed in is asked for early.
      try {
        // Both are read before either is used: a hint without a revision to
        // check it against must not start account reads.
        const hint = localStorage.getItem('voltra.signed-in') === '1';
        let noted = localStorage.getItem('voltra.snapshot-session');
        // A browser that has never held one is given one now. If it cannot be
        // written there is nothing to check against, and this throws.
        if (!noted) {
          noted = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
          localStorage.setItem('voltra.snapshot-session', noted);
          if (localStorage.getItem('voltra.snapshot-session') !== noted) throw new Error('storage did not keep the revision');
        }
        revision = noted;
        signedIn = hint;
        paths.push('/api/auth/session');
      } catch { /* Only the setup state: what the page reads from it does not depend on who is signed in. */ }
      // Account reads would only be refused unless they succeeded last time.
      if (signedIn) {
        paths.push('/api/client/account', '/api/client/settings', '/api/client/account/server-navigation', '/api/client/artwork/catalog');
        if (location.pathname === '/') paths.push('/api/client?summary=overview&per_page=100');
      }
      // One switch abandons every read still on its way, when the app no longer wants them.
      const abandon = new AbortController();
      const fresh = ['/api/setup/status', '/api/auth/session'];
      const reads = new Map(paths.map(path => [path, fetch(path, {headers: {Accept: 'application/json'}, cache: fresh.includes(path) ? 'no-store' : 'default', signal: abandon.signal}).catch(() => undefined)]));
      window.__voltraBoot = {at: performance.now(), revision, take(path) { const read = reads.get(path); reads.delete(path); return read; }, cancel() { abandon.abort(); }};
    }
  } catch { /* The app asks for everything itself. */ }
  try {
    // The first page's modules and styles, named by the build (build/bootHints.ts)
    // so they download beside the entry. The admin section never uses them.
    const files = document.querySelector('meta[name="voltra-first-page"]')?.content;
    if (files && !/^\/admin(\/|$)/.test(location.pathname)) for (const href of files.split(' ')) {
      const link = document.createElement('link');
      if (href.endsWith('.css')) { link.rel = 'preload'; link.as = 'style'; } else link.rel = 'modulepreload';
      // Vite requests lazy modules and styles with crossorigin; the hint has to match to be reused.
      link.crossOrigin = '';
      link.href = href;
      document.head.append(link);
    }
  } catch { /* The files load when the app asks for them. */ }
})();

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
    if (pending()) {
      clearTimeout(checkId);
      checkId = 0;
      finishAt = null;
      overlay.classList.remove('settled', 'leaving');
      return;
    }
    // Allow chained gate renders, cached requests and lazy routes to commit.
    // The wait runs from the first moment nothing is loading; a page that is
    // already drawn keeps changing (live readings, artwork) without restarting it.
    if (checkId || finishAt !== null) return;
    checkId = setTimeout(settle, 100);
  }
  function settle() {
    checkId = 0;
    if (stopped || finishAt !== null || pending()) return;
    // No frame has been drawn yet, so there is nothing to animate from.
    if (!current.length) { checkId = setTimeout(settle, 100); return; }
    captured = current.map(point => ({...point}));
    finishAt = performance.now();
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
    // Exit: the dots converge while the track fills, then the mark fades.
    const age=finishAt===null?0:now-finishAt, converge=ease(age/180);
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
      overlay.classList.add('settled');
      if(age>=180)overlay.classList.add('leaving');
      if(age>=330){remove();return;}
    }
    frameId=requestAnimationFrame(frame);
  }
  frameId=requestAnimationFrame(frame);
  check();
})();
