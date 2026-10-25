// A static server for out/site that answers the way Render does with render.yaml's settings: `/` rewritten to the
// page, render.yaml's headers on every file (read from it), and the right types. Keep the rewrite in step with it.
//   node tests/live/serve.cjs [dir] [port]   (defaults: out/site, 8765)
const http = require('http'), fs = require('fs'), path = require('path');

const PAGE = '/chess-game-video.html';
// render.yaml's `headers:` entries, all for every path (/*)
const HEADERS = Object.fromEntries([...fs.readFileSync(path.join(__dirname, '..', '..', 'render.yaml'), 'utf8')
  .matchAll(/- path: \/\*\n\s+name: (.+)\n\s+value: (.+)/g)].map((m) => [m[1].trim(), m[2].trim()]));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' };

function serve(dir, port = 0) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end('bad request'); }
    if (p === '/') p = PAGE; // render.yaml's rewrite
    const file = path.join(root, path.normalize(p));
    const head = { ...HEADERS };
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { ...head, 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { ...head, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

if (require.main === module) {
  serve(process.argv[2] || path.join(__dirname, '..', '..', 'out', 'site'), +(process.argv[3] || 8765)).then((s) => console.log('serving at ' + s.url));
}
module.exports = { serve };
