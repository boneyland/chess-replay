// A Worker-like wrapper around the vendored engine run by Node (stdin/stdout UCI), for integration tests.
const { spawn } = require('child_process');
const path = require('path');
const VENDOR = path.join(__dirname, '..', 'vendor');

// file: the build in vendor/ (the threaded one for thread tests)
function nodeWorker(file = 'stockfish-19-lite-single.js') {
  const child = spawn(process.execPath, [path.join(VENDOR, file)], { stdio: ['pipe', 'pipe', 'inherit'], detached: true });
  const w = { onmessage: null, onerror: null };
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line && w.onmessage) w.onmessage({ data: line }); }
  });
  child.on('error', (e) => w.onerror && w.onerror(e));
  w.postMessage = (s) => child.stdin.write(s + '\n');
  w.terminate = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {} };
  return w;
}
module.exports = { nodeWorker };
