(function () {
  'use strict';

  const S = window.SITE;
  const $ = s => document.querySelector(s);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- content ----
  $('#project-list').innerHTML = S.projects
    .slice().sort((a, b) => b.year.localeCompare(a.year))
    .map(p => `<li>
      <span class="when">${esc(p.year)}</span>
      <span class="name">${esc(p.name)}</span>
      <span class="text">${esc(p.text)}</span>
      <span class="links">${p.links.map(([label, href]) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`).join('')}</span>
    </li>`).join('');
  $('#award-list').innerHTML = S.awards.map(([y, t]) => `<li><span class="when">${esc(y)}</span><span>${esc(t)}</span></li>`).join('');
  $('#talk-video').innerHTML = S.talkVideo
    ? `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(S.talkVideo)}?rel=0" title="AAPT Summer Meeting 2026 talk" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`
    : `<div class="placeholder"><span>The recording is on <a href="${esc(S.talkFallback)}" target="_blank" rel="noopener">my LinkedIn</a>.</span></div>`;
  $('#year').textContent = new Date().getFullYear();

  // ---- smooth scroll ----
  gsap.registerPlugin(ScrollTrigger);
  let lenis = null;
  if (!reduced && window.Lenis) {
    lenis = new Lenis({ lerp: 0.1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    const el = id === '#top' ? 0 : document.querySelector(id);
    if (el === null) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(el, { offset: el === 0 ? 0 : -60, duration: 1.6 });
    else window.scrollTo({ top: el === 0 ? 0 : el.getBoundingClientRect().top + window.scrollY - 60, behavior: reduced ? 'auto' : 'smooth' });
  });

  // ---- ocean camera, driven by scroll ----
  const canvas = $('#ocean');
  const ocean = window.Ocean && Ocean.create(canvas);
  if (!ocean) document.body.classList.add('no-webgl');

  // [scrollY, camera height in metres, pitch in radians]
  let path = [];
  function buildPath() {
    const H = window.innerHeight;
    const contentTop = $('.content').getBoundingClientRect().top + window.scrollY;
    const end = Math.max(document.documentElement.scrollHeight - H, contentTop + H);
    path = [
      [0, 1.6, -0.025],
      [H * 0.55, 0.55, -0.06],
      [H * 0.92, -0.2, 0.04],
      [H * 1.45, -3.2, 0.95],
      [contentTop - H * 0.4, -14, 0.05],
      [end, -900, -0.03],
    ];
  }
  function cameraAt(y) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if (y <= b[0]) {
        const t = smooth(clamp((y - a[0]) / Math.max(1, b[0] - a[0]), 0, 1));
        return [lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
      }
    }
    const l = path[path.length - 1];
    return [l[1], l[2]];
  }

  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', e => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -((e.clientY / window.innerHeight) * 2 - 1);
  }, { passive: true });

  const nav = $('#nav'), gauge = $('#gauge'), gDepth = $('#gauge-depth'), gFill = $('#gauge-fill'), scrim = $('.hero-scrim');
  const cam = { y: 1.6, pitch: -0.025, init: false };
  const t0 = performance.now();

  function frame() {
    const sy = window.scrollY, H = window.innerHeight;
    const [ty, tp] = cameraAt(sy);
    if (!cam.init) { cam.y = ty; cam.pitch = tp; cam.init = true; }
    cam.y = lerp(cam.y, ty, reduced ? 1 : 0.12);
    cam.pitch = lerp(cam.pitch, tp, reduced ? 1 : 0.12);
    mouse.sx = lerp(mouse.sx, mouse.x, 0.04);
    mouse.sy = lerp(mouse.sy, mouse.y, 0.04);

    nav.classList.toggle('solid', sy > H * 0.8);
    gauge.classList.toggle('on', sy > H * 0.25);
    scrim.style.opacity = String(1 - clamp(sy / (H * 0.7), 0, 1));
    const d = Math.max(0, -cam.y);
    gDepth.textContent = d < 20 ? `${d.toFixed(1)} m` : `${Math.round(d).toLocaleString('en-US')} m`;
    gFill.style.height = `${clamp(sy / Math.max(1, document.documentElement.scrollHeight - H), 0, 1) * 100}%`;
    if (window.OceanSound) OceanSound.setDepth(-cam.y);

    if (!ocean) return;
    const t = (performance.now() - t0) / 1000 * (reduced ? 0.25 : 1) + 18;
    const st = ocean.state;
    st.cam[0] = Math.sin(t * 0.021) * 3.0;
    st.cam[1] = cam.y;
    st.cam[2] = t * 0.9;
    st.look[0] = mouse.sx * 0.07 + Math.sin(t * 0.05) * 0.015;
    st.look[1] = cam.pitch + mouse.sy * 0.035;
    st.mouse[0] = mouse.sx; st.mouse[1] = mouse.sy;
    ocean.render(t);
    if (!canvas.classList.contains('on')) requestAnimationFrame(() => canvas.classList.add('on'));
  }

  $('#sound').addEventListener('click', e => {
    const on = !!(window.OceanSound && OceanSound.toggle(-cam.y));
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'Sound on' : 'Sound off';
  });

  ScrollTrigger.addEventListener('refresh', buildPath);
  window.addEventListener('resize', buildPath);
  if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());
  buildPath();
  gsap.ticker.add(frame);
})();
