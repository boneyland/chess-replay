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
      for (const [k, x] of all) assert.ok(x.x >= -0.5 && x.y >= -0.5 && x.x + x.w <= w + 0.5 && x.y + x.h <= L.h + 0.5, `${id}: ${k} outside ${JSON.stringify(x)} (h ${L.h})`);
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i][1], all[j][1]), `${id}: ${all[i][0]} overlaps ${all[j][0]}`);
      if (video) assert.equal(L.h, h, id);
    }
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
  assert.equal(LC.compute({ w: 768, h: 950 }).moves.cols, 2);
});

test('cols override and moves rows', () => {
  assert.equal(LC.compute({ w: 1440, h: 818, cols: 1 }).cols, 1);
  const L = LC.compute({ w: 1440, h: 818 });
  assert.equal(L.moves.rows, Math.floor((L.moves.h - 40) / (38 * 0.8)));
  assert.equal(LC.columns({ w: 1440, h: 818 }), 2);
});

test('textScale', () => {
  assert.equal(LC.textScale('Larger'), 1.3);
  assert.equal(LC.textScale('Huge'), 1);
  assert.equal(LC.textScale(undefined), 1);
  assert.equal(LC.textScale('toString'), 1);
});
