const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('layout-core.js');
const LC = window.LayoutCore;
const VIEWS = ['replay', 'free', 'game', 'edit'];
const PANELS = ['header', 'moves', 'comment', 'analysis', 'plot', 'tray', 'panel'];
const boxes = (L) => PANELS.filter((k) => L[k]).map((k) => [k, L[k]]);
const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

test('two columns on a desktop', () => {
  const L = LC.compute({ w: 1440, h: 818 });
  assert.equal(L.cols, 2);
  assert.ok(L.board.size <= 900 && L.board.size >= 360, L.board.size);
  assert.ok(L.moves.x >= L.board.x + L.board.size);
  assert.equal(L.plot.x, 12);
  assert.equal(L.plot.x + L.plot.w, 1440 - 12);
});

test('boxes stay inside and never overlap', () => {
  for (const [w, h] of [[1920, 1000], [1440, 818], [1024, 690], [1280, 520], [768, 950], [844, 340], [390, 770], [320, 500], [2560, 1000]]) {
    for (const [name, text] of Object.entries(LC.TEXT_SIZES)) for (const view of VIEWS) for (const video of [false, true]) {
      const id = `${w}x${h} ${name} ${view} video=${video}`;
      const L = LC.compute({ w, h, text, view, video });
      assert.ok(L.board.size >= 200, `${id}: board ${L.board.size}`);
      const all = boxes(L);
      const b = { x: L.board.x, y: L.board.y, w: L.board.size, h: L.board.size };
      all.push(['board', b]);
      if (L.eval) all.push(['eval', { x: L.eval.x, y: b.y, w: L.eval.w, h: b.h }]);
      all.push(['top bar', { x: b.x, y: b.y - L.bars.gap - L.bars.h, w: b.w, h: L.bars.h }], ['bottom bar', { x: b.x, y: b.y + b.h + L.bars.gap, w: b.w, h: L.bars.h }]);
      // a flowing box's height is its contents' (the view lays the column out), so only its width and start are checked
      for (const [k, x] of all) assert.ok(x.x >= -0.5 && x.y >= -0.5 && x.x + x.w <= w + 0.5 && (x.flow || x.y + x.h <= L.h + 0.5), `${id}: ${k} outside ${JSON.stringify(x)} (h ${L.h})`);
      const fixed = all.filter(([, x]) => !x.flow);
      for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) assert.ok(!overlap(fixed[i][1], fixed[j][1]), `${id}: ${fixed[i][0]} overlaps ${fixed[j][0]}`);
      if (L.flow) for (const [k, x] of all.filter(([, x]) => x.flow)) assert.ok(x.y >= L.flow.top - 0.5 && Math.abs(x.x - L.flow.x) < 0.5 && Math.abs(x.w - L.flow.w) < 0.5, `${id}: ${k} off the flowing column`);
      if (video) assert.equal(L.h, h, id);
    }
  }
});

// a video in a very short window (a phone held sideways, 568×260): the board gives up its 200 px so the player bars and
// the board's edge stay inside the stage
test('a very short video keeps everything inside', () => {
  for (const [name, text] of Object.entries(LC.TEXT_SIZES)) for (const view of VIEWS) {
    const L = LC.compute({ w: 568, h: 260, text, view, video: true });
    const id = `${name} ${view}`;
    assert.equal(L.cols, 2, id);
    assert.ok(L.board.size > 0 && L.board.size < 200, `${id}: board ${L.board.size}`);
    assert.ok(L.board.y + L.board.size + L.bars.gap + L.bars.h <= 260 + 0.5, `${id}: bottom bar past the stage`);
  }
});

test('stacking thresholds', () => {
  assert.equal(LC.compute({ w: 1024, h: 690 }).cols, 2);
  assert.equal(LC.compute({ w: 748, h: 958 }).cols, 1); // an iPad upright (768x1024), less the stage's padding and bar
  const s = LC.compute({ w: 844, h: 340 });
  assert.equal(s.cols, 2);
  assert.ok(s.plot === null || s.plot.x >= s.board.x + s.board.size);
});

test('device tiers: smaller screens are tighter', () => {
  const d = LC.compute({ w: 1440, h: 818 }), t = LC.compute({ w: 748, h: 958 }), f = LC.compute({ w: 900, h: 860 }), p = LC.compute({ w: 390, h: 770 });
  assert.deepEqual([d.tier, t.tier, f.tier, p.tier], ['desktop', 'tablet', 'foldable', 'phone']);
  assert.equal(LC.compute({ w: 844, h: 340 }).tier, 'phone'); // held sideways
  assert.ok(p.eval.w < t.eval.w && t.eval.w < d.eval.w);
  assert.ok(p.text < t.text && t.text < d.text);
  assert.ok(p.board.x - p.eval.w < d.board.x - d.eval.w, 'phone margins are thinner');
  // a square foldable keeps the sidebar; a tablet upright stacks
  assert.equal(f.cols, 2);
  assert.equal(t.cols, 1);
});

// a squarish window keeps the sidebar, Analysis and the eval graph filling the height under the board (it stacked,
// for a larger board, until 2026-10-28)
test('a squarish window keeps the sidebar, Analysis and the graph under the board', () => {
  const L = LC.compute({ w: 772, h: 905 });
  assert.equal(L.cols, 2);
  assert.ok(L.analysis.x < L.board.x && L.plot && L.plot.y > L.analysis.y, JSON.stringify([L.analysis, L.plot]));
  // a window just as tall but wide enough for a big board keeps the sidebar
  assert.equal(LC.compute({ w: 1440, h: 818 }).cols, 2);
  assert.equal(LC.compute({ w: 1024, h: 690 }).cols, 2);
});

test('larger text stacks sooner', () => {
  let found = false;
  for (let w = 700; w <= 1100; w++) if (LC.compute({ w, h: 800, text: 1 }).cols === 2 && LC.compute({ w, h: 800, text: 1.3 }).cols === 1) found = true;
  assert.ok(found);
});

test('board stops at 900', () => {
  const a = LC.compute({ w: 2560, h: 1400 }), b = LC.compute({ w: 1920, h: 1400 });
  assert.equal(a.board.size, 900);
  assert.ok(a.moves.w > b.moves.w);
});

test('video fits the screen', () => {
  const v = LC.compute({ w: 390, h: 770, video: true });
  assert.equal(v.h, 770);
  for (const [k, x] of boxes(v)) assert.ok(x.y + x.h <= 770, k);
  // paused, the panels flow under the board and the page scrolls
  assert.ok(LC.compute({ w: 390, h: 770 }).flow);
});

test('game and edit views', () => {
  const g = LC.compute({ w: 1440, h: 818, view: 'game' });
  assert.equal(g.eval, null);
  assert.equal(g.plot, null);
  const leftW = g.header.x - 10 - 12;
  assert.ok(Math.abs(g.board.x + g.board.size / 2 - (12 + leftW / 2)) <= 1);
  const e = LC.compute({ w: 390, h: 770, view: 'edit' });
  assert.ok(e.tray.y >= e.board.y + e.board.size);
  assert.ok(e.panel.y >= e.tray.y + e.tray.h);
  assert.equal(e.header, null);
  assert.equal(LC.compute({ w: 1440, h: 818, view: 'edit' }).moves, null);
});

test('hysteresis, by width and by aspect', () => {
  // width rule, on a tablet: the board beside the sidebar is 370 px (its eval bar, margins and gap, and the sidebar at
  // the tablet's 0.95 text, come off the width)
  const w = 370 + 22 + 16 + 8 + 320 * 0.95;
  assert.equal(LC.compute({ w, h: w * 0.7, prevCols: 2 }).cols, 2);
  assert.equal(LC.compute({ w, h: w * 0.7, prevCols: 1 }).cols, 1);
  // aspect rule: a window 1.25 times as tall as wide
  // (a window wide enough for the 900 px board beside the sidebar, so the empty-height rule stays out of it)
  const h = Math.round(1.27 * 1600); // over 1.25, under 1.3
  assert.equal(LC.compute({ w: 1600, h, prevCols: null }).cols, 1);
  assert.equal(LC.compute({ w: 1600, h, prevCols: 2 }).cols, 2);
  const h2 = 1.15 * 1600; // under 1.2 w
  assert.equal(LC.compute({ w: 1600, h: Math.round(1.22 * 1600), prevCols: 1 }).cols, 1);
  assert.equal(LC.compute({ w: 1600, h: h2, prevCols: 1 }).cols, 2);
});

test('video one column: board shrinks first, panels keep a floor', () => {
  const v = LC.compute({ w: 390, h: 770, video: true });
  assert.ok(v.comment.h >= 96 - 1 && v.analysis.h >= 120 - 1 && v.moves.h >= 96 - 1);
  const s = LC.compute({ w: 320, h: 500, video: true });
  assert.ok(s.board.size >= 200);
  for (const k of ['comment', 'analysis', 'moves']) assert.ok(s[k].h >= 48 - 0.5, k);
  // Moves keeps room for its title and one row at every text size, as MoveList draws them (MoveList takes its rows from here)
  for (const [name, text] of Object.entries(LC.TEXT_SIZES)) {
    assert.ok(LC.compute({ w: 390, h: 760, text, video: true }).moves.rows >= 1, `Moves at 390x760 ${name}`);
    const L = LC.compute({ w: 390, h: 770, text, video: true });
    assert.ok(L.board.size >= 200 && L.h === 770, `390x770 ${name}: board ${L.board.size}`);
  }
});

test('cols override and moves rows', () => {
  assert.equal(LC.compute({ w: 1440, h: 818, cols: 1 }).cols, 1);
  const L = LC.compute({ w: 1440, h: 818 });
  // rows: what fits under the title at MoveList's sizes, which are tx() sizes (0.8 × the text): 38 px rows, the panel's
  // padding (2 × 16), title row (15 × 1.4) and its margin (12), and the borders (2, not scaled)
  assert.equal(L.moves.rows, Math.floor((L.moves.h - (0.8 * (2 * 16 + 15 * 1.4 + 12) + 2)) / (38 * 0.8) + 1e-6));
  const big = LC.compute({ w: 1440, h: 818, text: 1.3 });
  assert.equal(big.moves.rows, Math.floor((big.moves.h - (0.8 * 1.3 * (2 * 16 + 15 * 1.4 + 12) + 2)) / (38 * 0.8 * 1.3) + 1e-6));
  assert.equal(LC.columns({ w: 1440, h: 818 }), 2);
});

// the sidebar keeps 380 px and a gap where the board can stay at 360 px or more beside it
test('the sidebar keeps its width while the board keeps 360 px', () => {
  for (const [w, h, text] of [[1024, 690, 1], [1100, 900, 1], [960, 800, 1]]) {
    const L = LC.compute({ w, h, text });
    assert.equal(L.cols, 2, `${w}x${h}`);
    assert.ok(L.moves.w >= 380 * L.text - 0.5, `${w}x${h} sidebar ${L.moves.w}`);
  }
  for (let w = 700; w <= 1200; w += 5) {
    const L = LC.compute({ w, h: 800 });
    if (L.cols === 2) assert.ok(L.board.size >= 360, `${w}: board ${L.board.size}`);
  }
});

// a narrow, short window (a phone with its keyboard up): paused, the one-column page scrolls, as two columns would
// leave no sidebar; a video, which must fit, keeps two columns there. A phone held sideways at Larger text has room
// for both columns, and keeps them
test('a short window keeps two columns when they fit, or for a video', () => {
  assert.equal(LC.columns({ w: 390, h: 400 }), 1);
  assert.equal(LC.compute({ w: 390, h: 400 }).cols, 1);
  assert.equal(LC.columns({ w: 390, h: 400, video: true }), 2);
  assert.equal(LC.compute({ w: 390, h: 400, video: true }).cols, 2);
  assert.equal(LC.columns({ w: 844, h: 346, text: 1.3 }), 2);
});

test('textScale', () => {
  assert.equal(LC.textScale('Larger'), 1.3);
  assert.equal(LC.textScale('Huge'), 1);
  assert.equal(LC.textScale(undefined), 1);
  assert.equal(LC.textScale('toString'), 1);
});

// the board is never more than half the viewport's longer side: a tablet upright leaves the panels room under it
test('the board stays within half the viewport', () => {
  for (const [w, h, vw, vh] of [[768, 975, 768, 1024], [1440, 818, 1440, 900], [390, 795, 390, 844], [844, 346, 844, 390], [2560, 1300, 2560, 1440]]) {
    const L = LC.compute({ w, h, vw, vh });
    assert.ok(L.board.size <= 0.5 * Math.max(vw, vh) + 0.5, `${vw}x${vh}: board ${L.board.size}`);
  }
  assert.equal(LC.compute({ w: 768, h: 975, vw: 768, vh: 1024 }).board.size, 512);
});

// Moves stands over Commentary, as wide, in every layout and view, and is never taller than its title and five lines
// (three in one column)
test('Moves sits over Commentary, five lines at most, three in one column', () => {
  const cap = (L) => 0.8 * L.text * (2 * L.pad[0] + 15 * 1.4 + 12) + 2 + (L.cols === 1 ? 3 : 5) * 38 * 0.8 * L.text + 0.5;
  for (const [w, h] of [[1440, 900], [2560, 1400], [1024, 690], [820, 600], [390, 844], [768, 1024], [844, 390], [320, 500]]) {
    for (const text of [1, 1.3]) for (const video of [false, true]) for (const view of ['replay', 'free']) {
      const L = LC.compute({ w, h, text, video, view }), at = `${w}x${h} text ${text}${video ? ' video' : ''} ${view}`;
      assert.ok(L.moves.h <= cap(L), `${at}: moves ${L.moves.h} over ${cap(L)}`);
      assert.ok(Math.abs(L.moves.x - L.comment.x) < 0.5 && Math.abs(L.moves.w - L.comment.w) < 0.5, `${at}: not stacked`);
      const gap = L.tier === 'phone' ? 6 : L.tier === 'desktop' ? 10 : 8;
      if (L.flow) assert.ok(L.moves.order < L.comment.order && L.moves.maxRows === 3, `${at}: flow order`);
      // one column: Analysis between Moves and Commentary
      else if (L.cols === 1) assert.ok(Math.abs(L.analysis.y + L.analysis.h + gap - L.comment.y) < 0.5 && Math.abs(L.moves.y + L.moves.h + gap - L.analysis.y) < 0.5, `${at}: not Moves, Analysis, Commentary`);
      else assert.ok(Math.abs(L.moves.y + L.moves.h + gap - L.comment.y) < 0.5, `${at}: Commentary not under Moves`);
    }
  }
});

// under 670 px high there is no eval graph; a square-ish two-column window has none either, and its Analysis runs the
// full width under the board; one column puts Commentary at the bottom
test('eval graph height floor, square-ish and portrait layouts', () => {
  assert.equal(LC.compute({ w: 1440, h: 669 }).plot, null);
  assert.ok(LC.compute({ w: 1440, h: 680 }).plot);
  for (const [w, h] of [[900, 860], [1000, 1000], [1280, 1100], [1100, 900]]) for (const video of [false, true]) {
    const L = LC.compute({ w, h, video }), at = `${w}x${h}${video ? ' video' : ''}`;
    assert.equal(L.cols, 2, at);
    // the eval graph, if any, under Analysis, the full width, where Analysis keeps 240 px (times text) over it
    if (L.plot) assert.ok(L.plot.y >= L.analysis.y + L.analysis.h && L.plot.x === L.analysis.x && L.plot.w === L.analysis.w && L.analysis.h >= 240 * L.text - 0.5, `${at}: graph ${JSON.stringify(L.plot)}`);
    assert.ok(Math.abs(L.analysis.x - L.eval.x) < 0.5 && Math.abs(L.analysis.w - (w - 2 * L.analysis.x)) < 0.5, `${at}: analysis not full width`);
    assert.ok(L.analysis.y >= L.board.y + L.board.size + L.bars.h && L.analysis.h >= 160 * L.text - 0.5, `${at}: analysis ${JSON.stringify(L.analysis)}`);
    assert.ok(L.comment.y + L.comment.h <= L.analysis.y, at);
    // Moves takes 40% of the sidebar's room under the header there (30% elsewhere), up to its five lines
    const room = L.moves.h + L.comment.h, cap = 0.8 * L.text * (2 * L.pad[0] + 15 * 1.4 + 12) + 2 + 5 * 38 * 0.8 * L.text;
    const line = 38 * 0.8 * L.text, chrome = cap - 5 * line;
    assert.ok(L.moves.h <= Math.min(cap, 0.4 * room) + 0.5 && L.moves.h > Math.min(cap, 0.4 * room) - line, `${at}: moves ${L.moves.h} of ${room}`);
  }
  assert.ok(LC.compute({ w: 1440, h: 900 }).plot); // landscape keeps it
  const p = LC.compute({ w: 390, h: 844 });
  assert.ok(p.moves.order < p.analysis.order && p.analysis.order < p.comment.order);
});

// two columns: the Moves box holds whole lines, none cut off
test('two-column Moves holds whole lines', () => {
  for (const [w, h] of [[1440, 900], [1440, 818], [1024, 690], [1000, 960], [900, 860], [1280, 520], [844, 390], [2560, 1400]]) for (const text of [0.9, 1, 1.15, 1.3]) for (const video of [false, true]) {
    const L = LC.compute({ w, h, text, video }), at = `${w}x${h} text ${text}${video ? ' video' : ''}`;
    if (L.cols !== 2) continue;
    const line = 38 * 0.8 * L.text, chrome = 0.8 * L.text * (2 * L.pad[0] + 15 * 1.4 + 12) + 2;
    const n = (L.moves.h - chrome) / line;
    if (n >= 1 - 1e-6) assert.ok(Math.abs(n - Math.round(n)) < 1e-6, `${at}: ${n} lines`);
  }
});

test('a short window docks the transport bar at the foot of the sidebar', () => {
  for (const [w, h] of [[814, 366], [844, 390], [568, 320]]) {
    const L = LC.compute({ w, h, dock: true }), plain = LC.compute({ w, h });
    assert.equal(L.cols, 2);
    assert.equal(L.header, null, 'no header');
    assert.ok(L.board.size > plain.board.size, `${w}x${h}: the board grows`);
    const d = L.dock, a = L.analysis;
    assert.equal(d.x, a.x); assert.equal(d.w, a.w);
    assert.ok(a.y + a.h <= d.y, 'the bar under the panels');
    assert.ok(Math.abs(d.y + d.h - (L.board.y + L.board.size + L.bars.gap + L.bars.h)) < 1, 'its foot level with the bottom player bar');
    assert.equal(LC.compute({ w, h, dock: true, view: 'edit' }).panel.y + LC.compute({ w, h, dock: true, view: 'edit' }).panel.h <= d.y, true);
  }
  assert.equal(LC.compute({ w: 1440, h: 818 }).dock, null);
});

test('a square-ish window keeps two columns, Analysis under the board, while it shrinks in height', () => {
  // 760 px wide windows from 770 down to 642 px high once went to one column part of the way (the room under the board
  // was judged as if the eval graph went there)
  for (let h = 572; h <= 720; h += 4) {
    const L = LC.compute({ w: 740, h });
    assert.equal(L.cols, 2, `740x${h}`);
    assert.ok(L.analysis.x < L.board.x && L.analysis.y > L.board.y + L.board.size, `740x${h}: Analysis under the board`);
  }
});

test('the eval graph runs under the board wherever that leaves the board its size', () => {
  for (const h of [670, 690]) {
    const L = LC.compute({ w: 910, h });
    assert.ok(L.plot && L.plot.x < L.board.x && L.plot.w > L.board.size + L.analysis.w, `910x${h}: the graph the full width`);
  }
  // held by the width with less than the graph's 110 px under it (966x680): the graph shrinks to the room, from 80 px
  for (const [w, h] of [[966, 680], [966, 690], [1000, 685]]) {
    const L = LC.compute({ w, h }), alone = LC.compute({ w, h, view: 'free' }), at = `${w}x${h}`;
    assert.ok(L.plot && L.plot.x < L.board.x && L.plot.h >= 80 && L.plot.h <= 110, `${at}: under the board ${JSON.stringify(L.plot)}`);
    assert.ok(Math.abs(L.board.size - alone.board.size) < 0.5, `${at}: the board keeps its size`);
    assert.ok(L.plot.y >= L.board.y + L.board.size + L.bars.gap + L.bars.h + 7.5 && L.plot.y + L.plot.h <= h, at);
  }
  const s = LC.compute({ w: 1100, h: 690 }); // held by the height: the graph under it would shrink the board
  assert.ok(s.plot && s.plot.x > s.board.x + s.board.size, 'beside it in the sidebar');
});

test('a tall square-ish window shows the eval graph under Analysis', () => {
  const s = LC.compute({ w: 738, h: 700 }), t = LC.compute({ w: 738, h: 800 });
  assert.equal(s.plot, null, 'not while Analysis would be under 240 px');
  assert.ok(t.plot && t.plot.y > t.analysis.y + t.analysis.h && t.plot.y + t.plot.h <= 800 && t.plot.w === t.analysis.w);
  assert.equal(LC.compute({ w: 738, h: 800, view: 'free' }).plot, null, 'the replay only');
});
