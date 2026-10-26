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
      for (const [k, x] of all) assert.ok(x.x >= -0.5 && x.y >= -0.5 && x.x + x.w <= w + 0.5 && x.y + x.h <= L.h + 0.5, `${id}: ${k} outside ${JSON.stringify(x)} (h ${L.h})`);
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i][1], all[j][1]), `${id}: ${all[i][0]} overlaps ${all[j][0]}`);
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
  assert.equal(LC.compute({ w: 768, h: 950 }).cols, 1);
  const s = LC.compute({ w: 844, h: 340 });
  assert.equal(s.cols, 2);
  assert.ok(s.plot === null || s.plot.x >= s.board.x + s.board.size);
});

test('larger text stacks sooner', () => {
  let found = false;
  for (let w = 700; w <= 1100; w++) if (LC.compute({ w, h: 800, text: 1 }).cols === 2 && LC.compute({ w, h: 800, text: 1.3 }).cols === 1) found = true;
  assert.ok(found);
});

test('board stops at 900', () => {
  const a = LC.compute({ w: 2560, h: 1400 }), b = LC.compute({ w: 1920, h: 1400 });
  assert.equal(a.board.size, 900);
  assert.ok(a.moves.w + a.comment.w > b.moves.w + b.comment.w);
});

test('video fits the screen', () => {
  const v = LC.compute({ w: 390, h: 770, video: true });
  assert.equal(v.h, 770);
  for (const [k, x] of boxes(v)) assert.ok(x.y + x.h <= 770, k);
  assert.ok(LC.compute({ w: 390, h: 770 }).h > 770);
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
  // width rule: the board beside the sidebar is 370 px (eval bar, margins and gap come off the width)
  const w = 370 + 36 + 24 + 10 + 320;
  assert.equal(LC.compute({ w, h: w * 0.8, prevCols: 2 }).cols, 2);
  assert.equal(LC.compute({ w, h: w * 0.8, prevCols: 1 }).cols, 1);
  // aspect rule: a window 1.15 times as tall as wide
  const h = Math.round(1.17 * 1200); // over 1.15, under 1.2
  assert.equal(LC.compute({ w: 1200, h, prevCols: null }).cols, 1);
  assert.equal(LC.compute({ w: 1200, h, prevCols: 2 }).cols, 2);
  const h2 = 1.05 * 1200; // under 1.1 w
  assert.equal(LC.compute({ w: 1200, h: Math.round(1.12 * 1200), prevCols: 1 }).cols, 1);
  assert.equal(LC.compute({ w: 1200, h: h2, prevCols: 1 }).cols, 2);
});

test('video one column: board shrinks first, panels keep a floor', () => {
  const v = LC.compute({ w: 390, h: 770, video: true });
  assert.ok(v.comment.h >= 96 - 1 && v.analysis.h >= 120 - 1 && v.moves.h >= 96 - 1);
  const s = LC.compute({ w: 320, h: 500, video: true });
  assert.ok(s.board.size >= 200);
  for (const k of ['comment', 'analysis', 'moves']) assert.ok(s[k].h >= 48 - 0.5, k);
  assert.equal(LC.compute({ w: 390, h: 770, video: true }).moves.cols, 1);
  // Moves keeps room for its title and one row at every text size, as MoveList draws them (MoveList takes its rows from here)
  for (const [name, text] of Object.entries(LC.TEXT_SIZES)) {
    assert.ok(LC.compute({ w: 390, h: 760, text, video: true }).moves.rows >= 1, `Moves at 390x760 ${name}`);
    const L = LC.compute({ w: 390, h: 770, text, video: true });
    assert.ok(L.board.size >= 200 && L.h === 770, `390x770 ${name}: board ${L.board.size}`);
  }
  assert.equal(LC.compute({ w: 768, h: 950 }).moves.cols, 2);
});

test('cols override and moves rows', () => {
  assert.equal(LC.compute({ w: 1440, h: 818, cols: 1 }).cols, 1);
  const L = LC.compute({ w: 1440, h: 818 });
  // rows: what fits under the title at MoveList's 38 px rows, the panel's padding (2 × 16), title row (15 × 1.4), its margin (12) and borders (2)
  assert.equal(L.moves.rows, Math.floor((L.moves.h - (2 * 16 + 15 * 1.4 + 12 + 2)) / 38));
  const big = LC.compute({ w: 1440, h: 818, text: 1.3 });
  assert.equal(big.moves.rows, Math.floor((big.moves.h - (1.3 * (2 * 16 + 15 * 1.4 + 12) + 2)) / (38 * 1.3)));
  assert.equal(LC.columns({ w: 1440, h: 818 }), 2);
});

// a laptop's window: the board gives up some size so the moves list keeps its width (a two-move row of long moves
// needs it) beside a commentary of at least 150 px; never below the 360 px that keeps two columns
test('the sidebar keeps room for the moves and commentary', () => {
  for (const [w, h, text] of [[1024, 690, 1], [1024, 690, 1.3], [1100, 900, 1], [960, 800, 1]]) {
    const L = LC.compute({ w, h, text });
    assert.equal(L.cols, 2, `${w}x${h}`);
    assert.equal(L.moves.w, 230 * text, `${w}x${h} moves`);
    assert.ok(L.comment.w >= 150 * text - 0.5, `${w}x${h} comment ${L.comment.w}`);
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
