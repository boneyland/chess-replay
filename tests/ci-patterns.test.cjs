const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'),
  path = require('path');
const ROOT = path.join(__dirname, '..');

// test.yml splits the live suite by subtest name (LIVE_ONLY / LIVE_SKIP): ENGINE_TESTS and HEAVY_TESTS are regular
// expressions whose alternatives each name one or more subtests of tests/live/site.test.cjs. A renamed subtest leaves
// its alternative matching nothing, and the test silently moves back into its browser's main part (PR 254 did that)

// the subtests' names as written: t.test('…', t.test("…" or t.test(`…` (a template's ${…} matches anything)
function subtestNames() {
  const src = fs.readFileSync(path.join(ROOT, 'tests', 'live', 'site.test.cjs'), 'utf8');
  return [...src.matchAll(/\bt\.test\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]);
}

// a pattern '<prefix>(a|b|…)<suffix>' as one RegExp per top-level alternative of its first group
function alternatives(p) {
  let depth = 0,
    open = -1,
    close = -1;
  for (let i = 0; i < p.length && close < 0; i++) {
    if (p[i] === '\\') i++;
    else if (p[i] === '(') {
      if (depth === 0) open = i;
      depth++;
    } else if (p[i] === ')' && --depth === 0) close = i;
  }
  assert.ok(open >= 0 && close > open, 'a group of alternatives in ' + p);
  const body = p.slice(open + 1, close),
    alts = [];
  let cur = '';
  depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {
      cur += c + body[++i];
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === '|' && depth === 0) {
      alts.push(cur);
      cur = '';
    } else cur += c;
  }
  alts.push(cur);
  return alts.map((a) => ({ alt: a, re: new RegExp(p.slice(0, open) + '(?:' + a + ')' + p.slice(close + 1)) }));
}

test("test.yml's ENGINE_TESTS and HEAVY_TESTS each name live subtests that exist", () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8');
  const names = subtestNames().map((n) => n.replace(/\$\{[^}]*\}/g, '…'));
  assert.ok(names.length > 50, 'the live subtests were found');
  for (const key of ['ENGINE_TESTS', 'HEAVY_TESTS']) {
    const m = yml.match(new RegExp('^\\s*' + key + ": '(.*)'$", 'm'));
    assert.ok(m, key + ' is set in test.yml');
    for (const { alt, re } of alternatives(m[1]))
      assert.ok(
        names.some((n) => re.test(n)),
        `${key}'s "${alt}" matches no subtest in tests/live/site.test.cjs (renamed?)`,
      );
  }
});

// the jobs run npm install of unlocked packages, whose install scripts would find a token checkout left in .git/config
test('every checkout in test.yml leaves no token behind (persist-credentials: false)', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8');
  const steps = [...yml.matchAll(/^(\s*)- uses: actions\/checkout@[^\n]*\n((?:\1  [^\n]*\n)*)/gm)];
  assert.ok(steps.length >= 5, 'the checkouts were found');
  for (const s of steps) assert.match(s[2], /^\s+persist-credentials: false$/m, s[0]);
});
