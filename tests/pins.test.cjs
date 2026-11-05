// Every SHA-256 (and size) pinned in LAYOUT.md against the file in the repo, every vendored file pinned there, and the
// pins kept a second time in code (VisionCore.FILES, SFFull's) the same as LAYOUT.md's. The piece sets' and boards' one
// hash over all their files is checked by piece-sets.test.cjs and board-themes.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { loadUnit } = require('./load.cjs');
const ROOT = path.join(__dirname, '..');

// [{ name, sha256, size (null where LAYOUT.md gives none), line }]: each `sha256 \`hex\``, named by the last `name` before
// it since the previous pin on its line (a pin without one, such as "all 312 files", is left out)
function layoutPins() {
  const out = [];
  fs.readFileSync(path.join(ROOT, 'LAYOUT.md'), 'utf8').split('\n').forEach((line, n) => {
    let from = 0;
    for (const m of line.matchAll(/sha256 `([0-9a-f]{64})`/g)) {
      const seg = line.slice(from, m.index), names = [...seg.matchAll(/`([^`\s]+)`/g)].map((x) => x[1]);
      from = m.index + m[0].length;
      if (!names.length) continue;
      const size = seg.match(/\(?([\d,]+) bytes\)?/);
      out.push({ name: names[names.length - 1], sha256: m[1], size: size ? +size[1].replace(/,/g, '') : null, line: n + 1 });
    }
  });
  return out;
}
// where a pinned name is in the repo: the path itself, or under vendor/, vendor/sounds/ or vision/ (null: not in the repo)
function fileOf(name) {
  const hits = [name, 'vendor/' + name, 'vendor/sounds/' + name, 'vision/' + name].filter((p) => fs.existsSync(path.join(ROOT, p)) && fs.statSync(path.join(ROOT, p)).isFile());
  assert.ok(hits.length <= 1, `${name}: more than one file (${hits.join(', ')})`);
  return hits[0] || null;
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');

test('every file LAYOUT.md pins matches its SHA-256 and size; the pins it names that are not in the repo are SFFull\'s downloads', () => {
  const pins = layoutPins();
  assert.ok(pins.length >= 40, `${pins.length} pins read`);
  const sfFull = fs.readFileSync(path.join(ROOT, 'app', 'sf-full.js'), 'utf8');
  for (const p of pins) {
    const f = fileOf(p.name);
    if (!f) {
      // the full engine, downloaded from unpkg on the viewer's click: its pins must be SFFull's
      assert.ok(sfFull.includes(`name: '${p.name}', size: ${p.size}`) && sfFull.includes(p.sha256), `LAYOUT.md:${p.line} ${p.name} is neither in the repo nor one of sf-full.js's pinned files`);
      continue;
    }
    assert.equal(sha(f), p.sha256, `LAYOUT.md:${p.line} ${f}`);
    if (p.size != null) assert.equal(fs.statSync(path.join(ROOT, f)).size, p.size, `LAYOUT.md:${p.line} ${f} size`);
  }
});

test('every vendored file is pinned in LAYOUT.md (licence texts aside)', () => {
  const pinned = new Set(layoutPins().map((p) => fileOf(p.name)).filter(Boolean));
  const vendored = ['babel/babel.min.js'];
  const walk = (d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => !f.startsWith('.')).forEach((f) => {
    const rel = d + '/' + f;
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel); else vendored.push(rel);
  });
  walk('vendor'); walk('vision');
  const unpinned = vendored.filter((f) => !/^vendor\/(pieces|boards)\//.test(f) && !/(LICENSE|NOTICE)$/.test(f) && !pinned.has(f));
  assert.deepEqual(unpinned, []);
});

test('VisionCore.FILES pins the same SHA-256s and sizes as LAYOUT.md', () => {
  loadUnit('vision-core.js');
  const pins = new Map(layoutPins().map((p) => [p.name, p]));
  for (const f of window.VisionCore.FILES) {
    const p = pins.get(f.name);
    assert.ok(p, f.name + ' in LAYOUT.md');
    assert.equal(f.sha256, p.sha256, f.name);
    assert.equal(f.size, p.size, f.name + ' size');
  }
});
