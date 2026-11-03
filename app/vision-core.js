// The pure parts of Position from image: the board reader's pinned files, its logits turned into a board, the squares
// it is unsure of, the 180-degree turn for a picture read upside down, and the crop and drag-box maths. The reader
// itself (ONNX Runtime and the model, run in a Worker on the device) is elsewhere; nothing here touches the network.
(function () {
  const CC = () => window.ChessCore;
  const EC = () => window.EditCore;
  const CLASSES = '.PNBRQKpnbrqk'; // the model's 13 classes, in output order
  const FILES = [ // fetched from vision/ next to the page (the base is the caller's); onnxruntime-web 1.30.0 dist files
    { name: 'chessq-lite-v4-int8.onnx', size: 41370398, type: 'application/octet-stream', sha256: '89d75e343c5d98f235855a67588efb469a4e7cff1e003ee6b6ee0de67732ae1f' },
    { name: 'ort.wasm.min.mjs', size: 50126, type: 'text/javascript', sha256: '219e6a1fc8a9938268d18efca3c91d310bd2f4a59bbd13744df5b2b7fc6cee3b' },
    { name: 'ort-wasm-simd-threaded.mjs', size: 24381, type: 'text/javascript', sha256: 'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b' },
    { name: 'ort-wasm-simd-threaded.wasm', size: 14239897, type: 'application/wasm', sha256: '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2' },
  ];
  const CACHE = 'chess-vision-1'; // the same name sw.js keeps out of its cleanup
  const SIZE = 644, MAX_SIDE = 2048, UNSURE = 0.8, MB = 56, MIN_BOX = 0.05;
  const WHOLE = { x0: 0, y0: 0, x1: 1, y1: 1 };

  // logits [64 x 13], squares a8..h1 (a ChessCore board). Per square: the class with the highest logit (the first on a
  // tie), and its softmax probability, in float64, as the confidence
  function read(logits) {
    const b = new Array(64), conf = new Array(64);
    for (let i = 0; i < 64; i++) {
      let top = 0;
      for (let c = 1; c < 13; c++) if (logits[i * 13 + c] > logits[i * 13 + top]) top = c;
      let sum = 0;
      for (let c = 0; c < 13; c++) sum += Math.exp(logits[i * 13 + c] - logits[i * 13 + top]);
      b[i] = top ? CLASSES[top] : null;
      conf[i] = 1 / sum;
    }
    return { b, conf };
  }
  const unsure = (conf) => conf.map((c, i) => (c < UNSURE ? i : -1)).filter((i) => i >= 0);

  // the read pieces as a position: White to move, every castling right whose king and rook stand at home
  function setupFrom(b) {
    const s = { ...EC().empty(), b: b.slice() };
    return { ...s, castle: 'KQkq'.split('').filter((r) => EC().canCastle(s, r)).join('') };
  }
  // the board turned half way round, for a picture read from Black's side; the rights are worked out again
  // (a king now off its home square loses them), the side to move and the move counts stay
  function turn(s) {
    const t = setupFrom(s.b.slice().reverse());
    return { ...t, turn: s.turn, half: s.half, full: s.full };
  }
  const turnSquares = (list) => list.map((i) => 63 - i).sort((a, b) => a - b);

  // the picture box { x0, y0, x1, y1 } (fractions) as the source rectangle in pixels and the size to draw it at:
  // the longest side at most MAX_SIDE, aspect kept, never enlarged
  function cropRect(box, w, h) {
    const sx = Math.round(box.x0 * w), sy = Math.round(box.y0 * h);
    const sw = Math.max(1, Math.round(box.x1 * w) - sx), sh = Math.max(1, Math.round(box.y1 * h) - sy);
    const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    return { sx, sy, sw, sh, dw: Math.max(1, Math.round(sw * k)), dh: Math.max(1, Math.round(sh * k)) };
  }

  // a drag of dx, dy (fractions of the picture) on a handle: 'move' slides the whole box and keeps its size, the
  // others pull their edges; the box stays inside the picture and each side at least MIN_BOX
  function dragBox(box, handle, dx, dy) {
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    let { x0, y0, x1, y1 } = box;
    if (handle === 'move') {
      dx = clamp(dx, -x0, 1 - x1); dy = clamp(dy, -y0, 1 - y1);
      return { x0: x0 + dx, y0: y0 + dy, x1: x1 + dx, y1: y1 + dy };
    }
    if (handle.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN_BOX);
    if (handle.includes('e')) x1 = clamp(x1 + dx, x0 + MIN_BOX, 1);
    if (handle.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN_BOX);
    if (handle.includes('s')) y1 = clamp(y1 + dy, y0 + MIN_BOX, 1);
    return { x0, y0, x1, y1 };
  }

  window.VisionCore = { FILES, CACHE, SIZE, MAX_SIDE, UNSURE, MB, WHOLE, read, unsure, setupFrom, turn, turnSquares, cropRect, dragBox };
})();
