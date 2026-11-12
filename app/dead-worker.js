// The dead-position prover's Worker (DeadCore's client starts it): chasolver built to WebAssembly (vendor/chasolver.wasm,
// served next to it). In: { id, fen, side } ('w' or 'b', the side that would mate). Out: { id, verdict, mb }, verdict
// 'unwinnable', 'winnable' or 'undecided', mb the module's memory in MB (it never shrinks); { id, verdict: 'undecided',
// error: true } when the module didn't load.
const VERDICTS = ['unwinnable', 'winnable', 'undecided', 'undecided']; // solve(): 3 is a FEN it refuses
const BUF_LEN = 256;
let X = null;
// (with the Worker's own ?v=, the page's deploy: see window.siteFile in build.cjs)
const ready = fetch('chasolver.wasm' + self.location.search)
  .then((r) => { if (!r.ok) throw new Error('chasolver.wasm: HTTP ' + r.status); return r.arrayBuffer(); })
  .then((b) => WebAssembly.instantiate(b, {}))
  .then((r) => { X = r.instance.exports; });
const enc = new TextEncoder();

self.onmessage = (e) => {
  const { id, fen, side } = e.data;
  ready.then(() => {
    const bytes = enc.encode(String(fen));
    let code = 3;
    if (bytes.length <= BUF_LEN) {
      new Uint8Array(X.memory.buffer, X.buf(), bytes.length).set(bytes);
      code = X.solve(bytes.length, side === 'b' ? 1 : 0);
    }
    postMessage({ id, verdict: VERDICTS[code] || 'undecided', mb: X.memory.buffer.byteLength / 1048576 });
  }, () => postMessage({ id, verdict: 'undecided', error: true }));
};
