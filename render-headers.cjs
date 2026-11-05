// render.yaml's `headers:` entries, which are all for every path (/*), as { name: value }: what Render sends with every
// file. build.cjs puts the cross-origin isolation pair into sw.js (so removing them here removes them there too),
// tests/live/serve.cjs answers with all of them, and the tests read them from here
const fs = require('fs'), path = require('path');

function headers(yaml = fs.readFileSync(path.join(__dirname, 'render.yaml'), 'utf8')) {
  const out = {};
  for (const m of yaml.matchAll(/^\s*- path: (\S+)\n\s+name: (.+)\n\s+value: (.+)$/gm)) {
    if (m[1] !== '/*') throw new Error(`render.yaml: a header for ${m[1]} (only /* is read)`);
    out[m[2].trim()] = m[3].trim();
  }
  return out;
}

// the cross-origin isolation headers render.yaml sends (none, or the pair)
const ISOLATION_NAMES = ['Cross-Origin-Opener-Policy', 'Cross-Origin-Embedder-Policy'];
const isolation = (h = headers()) => Object.fromEntries(ISOLATION_NAMES.filter((k) => h[k]).map((k) => [k, h[k]]));

module.exports = { headers, isolation };
