// queen.jsx's calls to the Space and its Hugging Face sign-in, run in node: the file compiled as build.cjs does, in a vm
// with a stub React (one render: useState hands back the first value and a setter that re-renders nothing), a fake
// fetch and storage. What a later render would see is left out on purpose: a call started in one render keeps that
// render's closures, so what it sends must not depend on them
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { jsx } = require('../build-js.cjs');
const { loadUnit } = require('./load.cjs');
loadUnit('queen-core.js');
loadUnit('pkce.js');
// Pkce.redirect() (queen.jsx's HF_OAUTH) reads this realm's location
globalThis.location = { origin: 'https://chess-replay.onrender.com', pathname: '/' };

const SRC = jsx(fs.readFileSync(path.join(__dirname, '..', 'app', 'queen.jsx'), 'utf8'), 'queen.jsx');
const AUTH_STORE = 'chess-video.hf-auth.v1';

// fetchFn(url, opts) answers the page's fetch; store: localStorage's items
function load({ fetchFn = async () => new Response('', { status: 500 }), store = {} } = {}) {
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
  const React = {
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useRef: (v) => ({ current: v }),
    useEffect: () => {},
    useMemo: (f) => f(),
    useCallback: (f) => f,
  };
  const location = {
    hostname: 'chess-replay.onrender.com',
    origin: 'https://chess-replay.onrender.com',
    pathname: '/',
  };
  location.search = '';
  const ctx = {
    React,
    localStorage,
    location,
    history: { replaceState() {} },
    fetch: fetchFn,
    Response,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Math,
    console,
  };
  ctx.window = Object.assign(ctx, { QueenCore: window.QueenCore, Pkce: window.Pkce, ChessCore: {} });
  ctx.addEventListener = () => {};
  ctx.removeEventListener = () => {};
  return vm.runInNewContext(SRC + '\n;({ directCall, useHfAuth });', ctx);
}

const signedIn = () => ({ [AUTH_STORE]: JSON.stringify({ token: 'hf_old', expires: Date.now() + 3600e3, name: 'x' }) });

// Sign out during "Test Queen on N marked moves" (minutes of calls): the calls still to come, retries included, go
// without the old token, though they were started by a render from before the sign-out
test('the token a Queen call sends is read when it is sent: none after Sign out', () => {
  const store = signedIn();
  const hf = load({ store }).useHfAuth();
  assert.equal(hf.token(), 'hf_old');
  hf.signOut();
  assert.equal(hf.token(), null, "the render's own token() after Sign out");
  assert.equal(store[AUTH_STORE], undefined);
});

test('a token that expires during the visit is signed out and not sent', () => {
  const store = signedIn();
  const hf = load({ store }).useHfAuth();
  assert.equal(hf.token(), 'hf_old');
  const real = Date.now;
  try {
    Date.now = () => real() + 7200e3;
    assert.equal(hf.token(), null);
    assert.equal(hf.token(), null, 'stays signed out');
  } finally {
    Date.now = real;
  }
  assert.equal(store[AUTH_STORE], undefined);
});

// A Space that answers 200 with the event id and then a stream
const space =
  (stream, { postStatus = 200, eventId = 'ev1', seen = [] } = {}) =>
  async (url, opts = {}) => {
    seen.push({ url, auth: (opts.headers || {}).Authorization || null });
    if (/\/call\/analyse_position$/.test(url))
      return new Response(JSON.stringify(eventId ? { event_id: eventId } : {}), { status: postStatus });
    if (typeof stream === 'function') return stream(opts);
    return new Response(stream, { status: 200 });
  };

const ANSWER = JSON.stringify([{ best_move_uci: 'e2e4', analysis: 'x' }]);

test('directCall reads an answer and sends the token it is given', async () => {
  const seen = [];
  const { directCall } = load({ fetchFn: space(`event: complete\ndata: ${ANSWER}\n\n`, { seen }) });
  const r = await directCall('e2e4', 'hf_t', null);
  assert.equal(r.payload.best_move_uci, 'e2e4');
  assert.deepEqual(
    seen.map((s) => s.auth),
    ['Bearer hf_t', 'Bearer hf_t'],
  );
});

// once the Space has given the event id the call is queued and costs ZeroGPU: a cut or slow stream is not asked again
// by itself (the viewer may), while a failure before the event id is
test('a stream cut short after the event id is not retryable', async () => {
  const { directCall } = load({ fetchFn: space('event: heartbeat\ndata: null\n\n') });
  await assert.rejects(directCall('e2e4', null, null), (e) => e.code === 'server_unavailable' && !e.retryable);
});

test('a stream that fails after the event id is not retryable', async () => {
  const { directCall } = load({
    fetchFn: space(() => {
      throw new TypeError('network');
    }),
  });
  await assert.rejects(directCall('e2e4', null, null), (e) => e.code === 'server_unavailable' && !e.retryable);
});

test('a failure before the event id is retryable: no answer to the call, a 503, no event id', async () => {
  const unreachable = load({
    fetchFn: async () => {
      throw new TypeError('network');
    },
  });
  await assert.rejects(unreachable.directCall('e2e4', null, null), (e) => e.retryable === true);
  const busy = load({ fetchFn: space('', { postStatus: 503 }) });
  await assert.rejects(busy.directCall('e2e4', null, null), (e) => e.retryable === true);
  const noId = load({ fetchFn: space('', { eventId: null }) });
  await assert.rejects(noId.directCall('e2e4', null, null), (e) => e.retryable === true);
});

test('the Stop button during the stream is a cancel, not a failure', async () => {
  const ctrl = new AbortController();
  const { directCall } = load({
    fetchFn: space(() => {
      ctrl.abort();
      throw new DOMException('aborted', 'AbortError');
    }),
  });
  await assert.rejects(directCall('e2e4', null, ctrl.signal), (e) => e.code === 'cancelled');
});

// the event id comes in the call's own answer body: Stop while that body hangs stops the call
test('the Stop button while the event id is read is a cancel', async () => {
  const ctrl = new AbortController();
  const { directCall } = load({
    fetchFn: async (url, opts) => {
      const body = new ReadableStream({
        start(c) {
          opts.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
        },
      });
      setTimeout(() => ctrl.abort(), 20);
      return new Response(body, { status: 200 });
    },
  });
  await assert.rejects(directCall('e2e4', null, ctrl.signal), (e) => e.code === 'cancelled');
});
