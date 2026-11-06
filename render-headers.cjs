// render.yaml's `headers:` entries, which are all for every path (/*), as { name: value }: what Render sends with every
// file. build.cjs puts the cross-origin isolation pair into sw.js (so removing them here removes them there too),
// tests/live/serve.cjs answers with all of them, and the tests read them from here
const fs = require('fs'), path = require('path');

// Each entry of the `headers:` list, its keys in any order, comment lines skipped, a quoted value unquoted. An entry
// without path, name and value, or for a path other than /*, is an error: one skipped here would be sent by Render but
// missing from sw.js and the local server
function headers(yaml = fs.readFileSync(path.join(__dirname, 'render.yaml'), 'utf8')) {
  const lines = yaml.split('\n'), at = lines.findIndex((l) => /^\s*headers:\s*$/.test(l));
  if (at < 0) return {};
  const indent = (l) => l.match(/^ */)[0].length, base = indent(lines[at]), entries = [];
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    if (indent(l) <= base) break;
    const m = l.match(/^\s*(- )?([\w-]+):\s*(.*?)\s*$/);
    if (!m) throw new Error(`render.yaml: can't read the header line "${l.trim()}"`);
    if (m[1]) entries.push({});
    if (!entries.length) throw new Error(`render.yaml: "${l.trim()}" is outside a header entry`);
    entries[entries.length - 1][m[2]] = m[3].replace(/^(["'])(.*)\1$/, '$2');
  }
  const out = {};
  for (const e of entries) {
    if (!e.path || !e.name || !e.value) throw new Error(`render.yaml: a header entry without path, name and value (${JSON.stringify(e)})`);
    if (e.path !== '/*') throw new Error(`render.yaml: a header for ${e.path} (only /* is read)`);
    out[e.name] = e.value;
  }
  return out;
}

// the cross-origin isolation headers render.yaml sends (none, or the pair)
const ISOLATION_NAMES = ['Cross-Origin-Opener-Policy', 'Cross-Origin-Embedder-Policy'];
const isolation = (h = headers()) => Object.fromEntries(ISOLATION_NAMES.filter((k) => h[k]).map((k) => [k, h[k]]));

module.exports = { headers, isolation };
