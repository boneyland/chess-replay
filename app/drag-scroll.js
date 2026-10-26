// Drag to scroll: a mouse drag on anything that scrolls (a list, a panel, a menu, a settings page, a one-line strip)
// scrolls it, as a finger does, and glides on when let go while moving. A finger or pen already scrolls natively.
// One listener for the page: it starts from the nearest box that scrolls along the drag, skipping text fields,
// sliders, anything marked data-no-drag-scroll (a piece or board drag of its own), and any press a pointerdown handler
// claimed (preventDefault).
(function () {
  const START = 4; // px the pointer moves before a press becomes a drag
  const GLIDE_MS = 325, GLIDE_MIN = 0.03, GLIDE_MAX = 5; // the glide's decay time constant, and the speeds (px/ms) it stops at and starts at most
  const SKIP = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [data-no-drag-scroll]';

  const scrolls = (el, axis) => {
    const s = getComputedStyle(el), o = axis === 'x' ? s.overflowX : s.overflowY;
    if (o !== 'auto' && o !== 'scroll') return false;
    return axis === 'x' ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1;
  };
  // the nearest box from el up that scrolls along axis
  const scroller = (el, axis) => {
    for (; el && el !== document.documentElement; el = el.parentElement) if (scrolls(el, axis)) return el;
    return null;
  };

  let drag = null, glide = 0, swallow = false;
  const stop = () => { cancelAnimationFrame(glide); glide = 0; };

  const flick = (el, vx, vy, k) => {
    let x = el.scrollLeft, y = el.scrollTop, last = performance.now();
    const step = (now) => {
      const dt = Math.min(now - last, 50);
      last = now;
      if (!el.isConnected) return stop();
      x += vx * dt / k.x; y += vy * dt / k.y;
      const decay = Math.exp(-dt / GLIDE_MS);
      vx *= decay; vy *= decay;
      if (k.ax.x) el.scrollLeft = x;
      if (k.ax.y) el.scrollTop = y;
      // slowed down, or at an end
      if (Math.hypot(vx, vy) < GLIDE_MIN || (k.ax.x && Math.abs(el.scrollLeft - x) > 1) || (k.ax.y && Math.abs(el.scrollTop - y) > 1)) return stop();
      glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  };

  // capturing, as a handler may stop the press from bubbling; whether one claimed it is read once the pointer moves
  window.addEventListener('pointerdown', (e) => {
    stop();
    swallow = false;
    drag = null;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const t = e.target instanceof Element ? e.target : null;
    if (!t || t.closest(SKIP)) return;
    if (!scroller(t, 'x') && !scroller(t, 'y')) return;
    drag = { ev: e, id: e.pointerId, t, x: e.clientX, y: e.clientY, el: null, pts: [] };
  }, true);
  window.addEventListener('pointermove', (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.el) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= START) return;
      if (d.ev.defaultPrevented) { drag = null; return; }
      // the box that scrolls along the way the pointer went; a box that scrolls both ways follows both
      const main = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y', el = scroller(d.t, main);
      if (!el) { drag = null; return; }
      const r = el.getBoundingClientRect();
      // screen px per scrolled px: 1 unless a transform or zoom scales the box
      d.k = { x: r.width / el.offsetWidth || 1, y: r.height / el.offsetHeight || 1, ax: { x: scrolls(el, 'x'), y: scrolls(el, 'y') } };
      Object.assign(d, { el, left: el.scrollLeft, top: el.scrollTop });
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      document.documentElement.style.cursor = 'grabbing';
    }
    if (d.k.ax.x) d.el.scrollLeft = d.left - (e.clientX - d.x) / d.k.x;
    if (d.k.ax.y) d.el.scrollTop = d.top - (e.clientY - d.y) / d.k.y;
    const now = performance.now();
    d.pts.push({ x: e.clientX, y: e.clientY, t: now });
    while (d.pts.length > 2 && now - d.pts[0].t > 100) d.pts.shift();
    e.preventDefault();
  });
  const end = (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    if (!d.el) return;
    document.documentElement.style.cursor = '';
    if (e.type === 'pointercancel') return;
    // the click that follows lands on whatever was under the press: it picks nothing
    swallow = true;
    setTimeout(() => { swallow = false; }, 0);
    // the speed over the last 100 ms of the drag; none if the pointer stopped before letting go
    const now = performance.now(), a = d.pts[0], b = d.pts[d.pts.length - 1];
    if (a && b !== a && now - b.t < 60) {
      const cap = (v) => Math.max(-GLIDE_MAX, Math.min(GLIDE_MAX, v));
      flick(d.el, cap(-(b.x - a.x) / (b.t - a.t)), cap(-(b.y - a.y) / (b.t - a.t)), d.k);
    }
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('click', (e) => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
  // a dragged link or image would start the browser's own drag instead
  window.addEventListener('dragstart', (e) => { if (drag) e.preventDefault(); });
  window.addEventListener('wheel', stop, { passive: true });
})();
