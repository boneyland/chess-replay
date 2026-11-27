// Drag to scroll (app/drag-scroll.js) in a vm with a fake window: its listeners, a scrolling box and a clock the test sets
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'app', 'drag-scroll.js'), 'utf8');

function load() {
  const on = {},
    frames = [];
  let now = 1000;
  class Element {
    constructor() {
      this.parentElement = null;
      this.isConnected = true;
      this.scrollLeft = 0;
      this.scrollTop = 0;
      this.events = [];
    }
    closest() {
      return null;
    }
    getBoundingClientRect() {
      return { width: 300, height: 400 };
    }
    setPointerCapture() {}
    dispatchEvent(e) {
      this.events.push(e.type);
    }
  }
  // a list that scrolls up and down
  const box = Object.assign(new Element(), {
    offsetWidth: 300,
    offsetHeight: 400,
    clientWidth: 300,
    clientHeight: 400,
    scrollWidth: 300,
    scrollHeight: 4000,
    overflowY: 'auto',
  });
  const win = {
    Element,
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    addEventListener: (type, fn) => (on[type] = on[type] || []).push(fn),
    matchMedia: () => ({ matches: false }),
    getComputedStyle: (el) => ({ overflowX: 'visible', overflowY: el.overflowY || 'visible' }),
    requestAnimationFrame: (fn) => frames.push(fn),
    cancelAnimationFrame: () => {},
    setTimeout: (fn) => fn(),
    performance: { now: () => now },
    document: { documentElement: { style: {} } },
  };
  win.window = win;
  vm.runInNewContext(SRC, win);
  const fire = (type, e) => (on[type] || []).forEach((fn) => fn({ preventDefault() {}, ...e, type }));
  return {
    box,
    frames,
    fire,
    at: (t) => (now = t),
    DragScroll: win.DragScroll,
    ptr: (type, y, extra) => fire(type, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: y, ...extra }),
  };
}

// runs the glide's frames 16 ms apart, at most n of them; how many ran
function runFrames(d, from, n) {
  let i = 0;
  for (; i < n && d.frames.length; i++) d.frames.shift()(from + 16 * (i + 1));
  return i;
}

test('a drag scrolls the box and a let-go while moving glides on, then stops', () => {
  const d = load();
  d.ptr('pointerdown', 300, { button: 0, target: d.box });
  d.at(1010);
  d.ptr('pointermove', 290);
  d.at(1020);
  d.ptr('pointermove', 250);
  assert.equal(d.box.scrollTop, 50);
  d.at(1025);
  d.ptr('pointerup', 250);
  assert.ok(d.DragScroll.gliding(d.box));
  const ran = runFrames(d, 1025, 2000);
  assert.ok(ran < 2000, 'the glide ends');
  assert.ok(d.box.scrollTop > 50);
  assert.ok(!d.DragScroll.gliding(d.box));
  assert.deepEqual(d.box.events, ['dragscroll-end']);
});

// audit 2026-11-27: the let-go speed divided by the time between the drag's last two points, which can be 0 (a coarse
// clock, e.g. Firefox's): NaN never fell under the glide's stopping speed, so the glide never ended (nor BoardGroup's
// settle after it), and a move with 0 ms gave a full-speed fling
test('a let-go whose last two points share a time does not glide forever or fling', () => {
  for (const [y1, y2] of [
    [300, 300],
    [300, 240],
  ]) {
    const d = load();
    d.ptr('pointerdown', 400, { button: 0, target: d.box });
    d.at(1000);
    d.ptr('pointermove', 300); // the drag's points 200 ms before: dropped from the speed's window
    d.at(1200);
    d.ptr('pointermove', y1);
    d.ptr('pointermove', y2); // the same millisecond
    const top = d.box.scrollTop;
    d.ptr('pointerup', y2);
    const ran = runFrames(d, 1200, 2000);
    assert.ok(ran < 2000, `the glide ends (${y1} → ${y2})`);
    assert.ok(!d.DragScroll.gliding(d.box));
    assert.ok(Number.isFinite(d.box.scrollTop), 'no NaN scroll');
    assert.ok(d.box.scrollTop - top < 100, `no full-speed fling (${d.box.scrollTop - top} px)`);
  }
});
