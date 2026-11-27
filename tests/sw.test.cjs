const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const ROOT = path.join(__dirname, '..');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js');
loadUnit('board-core.js');
loadUnit('edit-core.js');
loadUnit('vision-core.js');
// the board reader's cache name, from its one home (build.cjs gives sw.js the same), and the one before it
const VISION = window.VisionCore.CACHE,
  OLD_VISION = VISION.replace(/\d+$/, (n) => n - 1);

// Loads the built sw.js in a vm with a fake self, caches and fetch, and dispatches fetch events at it
// status: what the network answers (200 unless given; offline: the fetch fails); fetched gets each URL, fetchOpts the
// options a URL was fetched with; windows: the ids of the site's open windows (clients.matchAll); reg: the registration
// tampered: a CDN answers a wrong body, which a fetch given its integrity refuses (as the browser's does)
function load({ status = 200, offline = false, windows = [], reg = {}, tampered = false } = {}) {
  execFileSync(process.execPath, [path.join(ROOT, 'build.cjs')], { cwd: ROOT });
  // the prune a moment after a visit to the page runs at once (awaited through held)
  const src = fs
    .readFileSync(path.join(ROOT, 'out', 'site', 'sw.js'), 'utf8')
    .replace(/^const PRUNE_DELAY_MS = \d+;/m, 'const PRUNE_DELAY_MS = 0;');
  const stores = {},
    puts = [],
    fetched = [],
    fetchOpts = [],
    handlers = {};
  const store = (name) => stores[name] || (stores[name] = new Map());
  const caches = {
    open: async (name) => ({
      match: async (u) => store(name).get(typeof u === 'string' ? u : u.url),
      put: async (u, r) => {
        puts.push([name, u]);
        store(name).set(u, r);
      },
      addAll: async () => {},
    }),
    match: async (u, { cacheName } = {}) =>
      cacheName in stores ? stores[cacheName].get(typeof u === 'string' ? u : u.url) : undefined,
    keys: async () => Object.keys(stores),
    delete: async (name) => delete stores[name],
  };
  const self = {
    location: { origin: 'https://site.test', href: 'https://site.test/sw.js' },
    addEventListener: (t, f) => {
      handlers[t] = f;
    },
    skipWaiting: async () => {},
    registration: reg,
    clients: { claim: async () => {}, matchAll: async () => windows.map((id) => ({ id })) },
  };
  // a same-origin answer, as the browser's fetch gives one (Node's Response says 'default')
  const fakeFetch = async (req, opts) => {
    fetched.push(typeof req === 'string' ? req : req.url);
    fetchOpts.push(opts);
    if (offline) throw new TypeError('Failed to fetch');
    if (tampered && opts && opts.integrity) throw new TypeError('Failed integrity metadata check');
    return Object.defineProperty(new Response('from network', { status }), 'type', {
      value: typeof req === 'string' ? 'cors' : 'basic',
    });
  };
  vm.runInNewContext(src, {
    self,
    caches,
    fetch: fakeFetch,
    Response,
    Headers,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    AbortController,
    console,
  });
  // the event's waitUntil promises are kept in held (the cache writes the worker must stay alive for)
  const held = [];
  const fetchEvent = async (url, method = 'GET', mode = 'cors', resultingClientId = '') => {
    let answer;
    const req = { url, method, mode };
    handlers.fetch({
      request: req,
      resultingClientId,
      respondWith: (p) => {
        answer = p;
      },
      waitUntil: (p) => {
        held.push(p);
      },
    });
    return answer === undefined ? undefined : await answer;
  };
  const activate = async () => {
    let done;
    handlers.activate({
      waitUntil: (p) => {
        done = p;
      },
    });
    await done;
  };
  const install = async () => {
    let done;
    handlers.install({
      waitUntil: (p) => {
        done = p;
      },
    });
    await done;
  };
  const VERSION = src.match(/^const VERSION = '([0-9a-f]+)';/m)[1];
  return { stores, store, puts, fetched, fetchOpts, held, fetchEvent, activate, install, VERSION, windows, src };
}

const WASM = 'https://site.test/vision/ort.wasm.min.mjs';

test(`a vision/ file kept in ${VISION} is answered from it, with the isolation headers`, async () => {
  const sw = load();
  sw.store(VISION).set(WASM, new Response('kept', { status: 200 }));
  const r = await sw.fetchEvent(WASM);
  assert.equal(await r.text(), 'kept');
  assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.equal(r.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.deepEqual(sw.fetched, []);
});

test('a vision/ file that is not kept comes from the network and is put in no cache', async () => {
  const sw = load();
  const r = await sw.fetchEvent(WASM);
  assert.equal(await r.text(), 'from network');
  assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.deepEqual(sw.fetched, [WASM]);
  assert.deepEqual(sw.puts, []);
});

test('another file next to the page still goes through cacheFirst, into the per-deploy cache', async () => {
  const sw = load();
  const u = 'https://site.test/dead-worker.js';
  const r = await sw.fetchEvent(u);
  assert.equal(await r.text(), 'from network');
  assert.equal(sw.held.length, 1, 'the cache write is held open with waitUntil');
  await Promise.all(sw.held);
  assert.equal(sw.puts.length, 1);
  assert.match(sw.puts[0][0], /^chess-replay-/);
  assert.equal(sw.puts[0][1], u);
});

test('a HEAD for a kept vision/ file gets no body, the kept headers and the isolation headers', async () => {
  const sw = load();
  sw.store(VISION).set(WASM, new Response('kept', { status: 200, headers: { 'Content-Length': '4' } }));
  const r = await sw.fetchEvent(WASM, 'HEAD');
  assert.equal(r.body, null);
  assert.equal(r.headers.get('Content-Length'), '4');
  assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.equal(r.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.deepEqual(sw.fetched, []);
});

test('activate deletes a board reader kept under an older name, and keeps the current one and Full Stockfish', async () => {
  const sw = load();
  for (const n of [OLD_VISION, VISION, 'stockfish-full-19', 'chess-replay-old']) sw.store(n);
  await sw.activate();
  assert.deepEqual(Object.keys(sw.stores).sort(), [VISION, 'stockfish-full-19'].sort());
});

// a newer worker that bumped the name and failed to install leaves its 56 MB download: an older worker keeps it
test('activate keeps a board reader kept under a newer name', async () => {
  const sw = load();
  const NEWER = VISION.replace(/\d+$/, (n) => +n + 1),
    LATER = VISION.replace(/\d+$/, (n) => +n + 10);
  for (const n of [OLD_VISION, VISION, NEWER, LATER]) sw.store(n);
  await sw.activate();
  assert.deepEqual(Object.keys(sw.stores).sort(), [VISION, NEWER, LATER].sort());
});

const PAGE = 'chess-game-video.html';

for (const u of [
  'https://site.test/',
  'https://site.test/?code=abc&state=xyz',
  'https://site.test/chess-game-video.html',
]) {
  test(`a navigation to the page (${u.slice(17) || '/'}) is kept as the page, the write held open with waitUntil`, async () => {
    const sw = load();
    const r = await sw.fetchEvent(u, 'GET', 'navigate');
    assert.equal(await r.text(), 'from network');
    assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
    assert.equal(sw.held.length, 2, "the page's copy, and the prune after the visit");
    await Promise.all(sw.held);
    assert.equal(sw.puts.length, 1);
    assert.match(sw.puts[0][0], /^chess-replay-/);
    assert.equal(sw.puts[0][1], PAGE);
  });
}

test('a navigation to another file next to the page is not kept as the page, nor answered with it', async () => {
  const sw = load();
  const r0 = await sw.fetchEvent('https://site.test/', 'GET', 'navigate');
  await r0.text();
  await Promise.all(sw.held);
  const u = 'https://site.test/og-image.png';
  const r = await sw.fetchEvent(u, 'GET', 'navigate');
  assert.equal(await r.text(), 'from network');
  await Promise.all(sw.held);
  assert.deepEqual(
    sw.puts.map((p) => p[1]),
    [PAGE, u],
  );
});

// The page asks for its Workers and libraries with its deploy's version (window.siteFile)
test("this deploy's file asked for with ?v= is answered from the copy kept under its plain URL", async () => {
  const sw = load();
  sw.store('chess-replay-' + sw.VERSION).set('https://site.test/dead-worker.js', new Response('kept', { status: 200 }));
  const r = await sw.fetchEvent('https://site.test/dead-worker.js?v=' + sw.VERSION);
  assert.equal(await r.text(), 'kept');
  assert.deepEqual(sw.fetched, []);
});

test("this deploy's file not kept yet is fetched and kept under its plain URL", async () => {
  const sw = load();
  const u = 'https://site.test/dead-worker.js?v=' + sw.VERSION;
  assert.equal(await (await sw.fetchEvent(u)).text(), 'from network');
  await Promise.all(sw.held);
  assert.deepEqual(sw.fetched, [u]);
  assert.deepEqual(
    sw.puts.map((p) => p[1]),
    ['https://site.test/dead-worker.js'],
  );
});

test("another deploy's file comes from the network, never from this deploy's copy, and is not kept", async () => {
  const sw = load();
  sw.store('chess-replay-' + sw.VERSION).set('https://site.test/dead-worker.js', new Response('kept', { status: 200 }));
  const u = 'https://site.test/dead-worker.js?v=0123456789abcdef';
  const r = await sw.fetchEvent(u);
  assert.equal(await r.text(), 'from network');
  assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  await Promise.all(sw.held);
  assert.deepEqual(sw.fetched, [u]);
  assert.deepEqual(sw.puts, []);
});

test('a failed answer is not kept, here or from a CDN', async () => {
  const sw = load({ status: 503 });
  for (const u of ['https://site.test/pieces/alpha/wK.svg', 'https://cdn.jsdelivr.net/npm/x@1/x.js'])
    assert.equal((await sw.fetchEvent(u)).status, 503, u);
  await Promise.all(sw.held);
  assert.deepEqual(sw.puts, []);
});

test('a CDN file is fetched with CORS, so its status can be read, and kept', async () => {
  const sw = load();
  const u = 'https://fonts.gstatic.com/s/x.woff2';
  assert.equal(await (await sw.fetchEvent(u)).text(), 'from network');
  await Promise.all(sw.held);
  assert.equal(sw.fetchOpts[0].mode, 'cors');
  assert.deepEqual(
    sw.puts.map((p) => p[1]),
    [u],
  );
});

const OTHER = '0123456789abcdef';

test("another deploy's file still kept in that deploy's copy is answered from it (a page older than its worker)", async () => {
  const sw = load();
  sw.store('chess-replay-' + sw.VERSION).set('https://site.test/dead-worker.js', new Response('this', { status: 200 }));
  sw.store('chess-replay-' + OTHER).set('https://site.test/dead-worker.js', new Response('its own', { status: 200 }));
  const r = await sw.fetchEvent('https://site.test/dead-worker.js?v=' + OTHER);
  assert.equal(await r.text(), 'its own');
  assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.deepEqual(sw.fetched, []);
});

test("another deploy's file not kept, asked for offline, is answered with this deploy's copy", async () => {
  const sw = load({ offline: true });
  sw.store('chess-replay-' + sw.VERSION).set('https://site.test/dead-worker.js', new Response('this', { status: 200 }));
  const r = await sw.fetchEvent('https://site.test/dead-worker.js?v=' + OTHER);
  assert.equal(await r.text(), 'this');
  assert.deepEqual(Object.keys(sw.stores), ['chess-replay-' + sw.VERSION], 'no cache made for the other deploy');
});

test("another deploy's file offline with no copy anywhere fails as the network did", async () => {
  const sw = load({ offline: true });
  await assert.rejects(sw.fetchEvent('https://site.test/dead-worker.js?v=' + OTHER), /Failed to fetch/);
});

test("activate keeps older deploys' copies while a window of the site is open", async () => {
  const sw = load({ windows: ['old-tab'] });
  for (const n of [OLD_VISION, VISION, 'chess-replay-old']) sw.store(n);
  await sw.activate();
  assert.deepEqual(Object.keys(sw.stores).sort(), [OLD_VISION, VISION, 'chess-replay-old'].sort());
});

test('a visit to the page deletes older copies once every window shows a page this worker served', async () => {
  const sw = load({ windows: ['old-tab'] });
  for (const n of [OLD_VISION, VISION, 'chess-replay-old']) sw.store(n);
  await sw.activate();
  sw.windows.push('new-tab');
  await (await sw.fetchEvent('https://site.test/', 'GET', 'navigate', 'new-tab')).text();
  await Promise.all(sw.held);
  assert.ok('chess-replay-old' in sw.stores, 'kept while the old tab is open');
  sw.windows.splice(0, 1); // the old tab reloads, through this worker
  sw.windows.push('old-tab-reloaded');
  await (await sw.fetchEvent('https://site.test/', 'GET', 'navigate', 'old-tab-reloaded')).text();
  await Promise.all(sw.held);
  assert.deepEqual(Object.keys(sw.stores).sort(), [VISION, 'chess-replay-' + sw.VERSION].sort());
});

test("no copy is deleted while a newer worker is installing or waiting: its new copy isn't an old one", async () => {
  for (const reg of [{ installing: {} }, { waiting: {} }]) {
    const sw = load({ reg });
    for (const n of ['chess-replay-newer', OLD_VISION]) sw.store(n);
    await sw.activate();
    assert.deepEqual(Object.keys(sw.stores).sort(), ['chess-replay-newer', OLD_VISION].sort(), JSON.stringify(reg));
  }
});

test('with a window open, only the two newest older copies are kept', async () => {
  const sw = load({ windows: ['old-tab'] });
  for (const n of ['chess-replay-a', 'chess-replay-b', 'chess-replay-c', OLD_VISION]) sw.store(n);
  await sw.activate();
  assert.deepEqual(Object.keys(sw.stores).sort(), ['chess-replay-b', 'chess-replay-c', OLD_VISION].sort());
});

// The page refuses a CDN script that fails its integrity hash; a copy kept unchecked would then blank the page on every
// visit until the next deploy. The worker fetches each with its hash, and keeps only what passes
const REMOTE_OF = (src) => JSON.parse(src.match(/^const REMOTE = (\[[\s\S]*?\]);/m)[1]);
const INTEGRITY_OF = (src) => JSON.parse(src.match(/^const INTEGRITY = (\{[\s\S]*?\});/m)[1]);

test("install fetches each CDN script with the page's integrity hash", async () => {
  const sw = load();
  await sw.install();
  const INTEGRITY = INTEGRITY_OF(sw.src);
  const scripts = REMOTE_OF(sw.src).filter((u) => /\.js$/.test(u));
  assert.ok(scripts.length >= 3, 'React, ReactDOM, html2canvas-pro');
  for (const u of scripts) {
    const i = sw.fetched.indexOf(u);
    assert.ok(i >= 0, u + ' fetched');
    assert.match(sw.fetchOpts[i].integrity, /^sha384-[\w+/=]+$/, u);
    assert.equal(sw.fetchOpts[i].integrity, INTEGRITY[u], u);
  }
});

test('install keeps no CDN script whose body fails its integrity hash', async () => {
  const sw = load({ tampered: true });
  await sw.install();
  const kept = sw.puts.map((p) => p[1]);
  for (const u of REMOTE_OF(sw.src).filter((u) => /\.js$/.test(u))) assert.ok(!kept.includes(u), u + ' not kept');
});

test('a CDN script the page asks for is fetched with its hash, and a tampered one is not kept', async () => {
  const sw = load({ tampered: true });
  const u = REMOTE_OF(sw.src).find((x) => /react\.production/.test(x));
  await assert.rejects(sw.fetchEvent(u), /integrity/);
  await Promise.all(sw.held);
  assert.equal(sw.fetchOpts[0].integrity, INTEGRITY_OF(sw.src)[u]);
  assert.deepEqual(sw.puts, []);
});

test('a CDN file with no pinned hash goes with the integrity the page asked for, or none', async () => {
  const sw = load();
  const u = 'https://fonts.gstatic.com/s/x.woff2';
  await (await sw.fetchEvent(u)).text();
  assert.ok(!sw.fetchOpts[0].integrity, 'none pinned, none asked');
});
