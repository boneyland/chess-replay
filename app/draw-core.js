// The viewer's own drawings on the board, as on Lichess: a right click on a square rings it, a right-button drag from one
// square to another draws an arrow. A shape is a plain object { from, to, brush } (square names, 'e4'; to is null for a
// circle), never mutated; a list of them is what the board shows. Drawing a shape again in its colour takes it off, in
// another colour recolours it.
(function () {
  const BRUSHES = ['green', 'red', 'blue', 'yellow'];
  // Lichess's brush colours, darker than the engine's and Queen's arrows so the viewer's own read as theirs
  const COLORS = { green: '#15781b', red: '#882020', blue: '#003088', yellow: '#e68f00' };
  // the modifier held as the button goes down picks the colour: none green, Shift red, Alt (or ⌘) blue, Ctrl yellow;
  // Shift with Alt is yellow too, as on Lichess
  const brush = (e) => {
    const a = !!e.shiftKey, b = !!(e.altKey || e.metaKey);
    if (e.ctrlKey || (a && b)) return 'yellow';
    return a ? 'red' : b ? 'blue' : 'green';
  };
  // a drag that ends on the square it began on is a circle
  const shape = (from, to, br) => ({ from, to: to == null || to === from ? null : to, brush: br });
  const same = (s, t) => s.from === t.from && s.to === t.to;
  const toggle = (shapes, s) => {
    const k = shapes.findIndex((t) => same(t, s));
    if (k < 0) return [...shapes, s];
    if (shapes[k].brush === s.brush) return shapes.filter((_, j) => j !== k);
    return shapes.map((t, j) => (j === k ? s : t));
  };
  const sqName = (i) => 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8));
  window.DrawCore = { BRUSHES, COLORS, brush, shape, toggle, sqName };
})();
