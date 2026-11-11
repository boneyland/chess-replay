// The board reader's Worker (a module Worker; Vision.read in vision.js starts it): ChessQ Lite V4, int8, run by
// onnxruntime-web 1.30.0's WebAssembly build, on the device, as Lichess's editor does (lila's editor.vision.worker.ts).
// The runtime and the model are the vision/ files next to the page, handed over by Vision (vision.js) as Blob URLs of
// the viewer's kept copy, typed (a module import needs text/javascript), so they don't depend on sw.js, which doesn't
// control a page after Shift+reload; Vision lets them go once this has loaded them.
// In: { type: 'load', urls, size, threads } (urls: each of VisionCore.FILES' names → its Blob URL; size: the model's
// input side, VisionCore.SIZE), then { type: 'image', image } (an ImageBitmap, closed here after use).
// Out: { type: 'ready' } once loaded, { type: 'logits', logits } (a Float32Array of 64 x 13, squares a8..h1,
// transferred), or { type: 'error', message }.
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225]; // ImageNet's RGB normalisation, which the model was trained with
let SIZE = 0, PLANE = 0; // the model's input side, and its square
let ort = null, session = null;

self.onmessage = (e) => handle(e.data).catch((err) => self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) }));

async function handle(msg) {
  if (msg.type === 'load') {
    const url = (name) => { const u = msg.urls && msg.urls[name]; if (!u) throw new Error('The board reader is missing ' + name); return u; };
    SIZE = msg.size;
    PLANE = SIZE * SIZE;
    ort = await import(url('ort.wasm.min.mjs'));
    // threads need SharedArrayBuffer, which only a cross-origin isolated page has (render.yaml's COOP and COEP)
    ort.env.wasm.numThreads = self.crossOriginIsolated && typeof SharedArrayBuffer === 'function' ? Math.max(1, msg.threads) : 1;
    ort.env.wasm.proxy = false; // this is already a Worker
    ort.env.wasm.wasmPaths = { wasm: url('ort-wasm-simd-threaded.wasm'), mjs: url('ort-wasm-simd-threaded.mjs') };
    session = await ort.InferenceSession.create(url('chessq-lite-v4-int8.onnx'), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    // the Blob URLs are read by now (the runtime imported, its threads started, the model loaded)
    self.postMessage({ type: 'ready' });
    return;
  }
  if (msg.type !== 'image') throw new Error('Unknown message ' + msg.type);
  let input;
  try {
    if (!session) throw new Error('The board reader is not loaded');
    input = tensor(msg.image);
  } finally {
    msg.image.close();
  }
  const out = (await session.run({ image: input })).logits;
  if (!out || out.dims.join(',') !== '1,64,13') throw new Error('The board reader gave an unexpected answer'); // 1 image, 64 squares, 13 classes
  const logits = new Float32Array(out.data); // a copy of its own, so the whole buffer can be transferred
  self.postMessage({ type: 'logits', logits }, [logits.buffer]);
}

// The picture squashed to SIZE x SIZE (the crop is the board's square, whatever its aspect), as float32 NCHW RGB,
// each value (v / 255 - mean) / std
function tensor(image) {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error('No canvas to draw the picture on');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // on white: an opaque canvas starts black, and a diagram's transparent squares would be read as black ones
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(image, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const data = new Float32Array(3 * PLANE);
  for (let p = 0, q = 0; p < PLANE; p++, q += 4) {
    for (let c = 0; c < 3; c++) data[c * PLANE + p] = (px[q + c] / 255 - MEAN[c]) / STD[c];
  }
  return new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]);
}
