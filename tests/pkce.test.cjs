// The shared OAuth2 + PKCE steps (app/pkce.js) of the Hugging Face and Lichess sign-ins, against a fake page
// (location, history, sessionStorage) and token endpoint.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { loadUnit } = require('./load.cjs');

const session = new Map();
globalThis.sessionStorage = { getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => { session.set(k, String(v)); }, removeItem: (k) => { session.delete(k); } };
globalThis.location = { origin: 'https://example.test', pathname: '/folder/page.html', search: '' };
const replaced = [];
globalThis.history = { replaceState: (s, t, url) => { replaced.push(url); } };
loadUnit('pkce.js');
const P = window.Pkce;

const O = { store: 'test-pkce', clientId: 'client', redirect: 'https://example.test/folder/' };
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; session.clear(); replaced.length = 0; });

test('the redirect is the folder the page is served from', () => {
  assert.equal(P.redirect(), 'https://example.test/folder/');
});

test('b64url is base64 without +, / or padding', () => {
  assert.equal(P.b64url(new Uint8Array([251, 255, 254])), '-__-');
  assert.equal(P.b64url(new Uint8Array([1]).buffer), 'AQ');
});

test('authorizeUrl stashes the verifier and state, and sends the verifier\'s SHA-256 as the challenge', async () => {
  const url = new URL(await P.authorizeUrl({ ...O, url: 'https://id.test/authorize', scope: 'openid profile', prefix: 'lichess.' }));
  assert.equal(url.origin + url.pathname, 'https://id.test/authorize');
  const q = url.searchParams, saved = JSON.parse(session.get('test-pkce'));
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('client_id'), 'client');
  assert.equal(q.get('redirect_uri'), O.redirect);
  assert.equal(q.get('scope'), 'openid profile');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('state'), saved.state);
  assert.match(saved.state, /^lichess\.[\w-]{22}$/);
  assert.match(saved.verifier, /^[\w-]{43}$/);
  assert.equal(q.get('code_challenge'), crypto.createHash('sha256').update(saved.verifier).digest('base64url'));
});

test('authorizeUrl leaves the scope out when there is none', async () => {
  const url = new URL(await P.authorizeUrl({ ...O, url: 'https://id.test/authorize' }));
  assert.equal(url.searchParams.has('scope'), false);
  assert.match(url.searchParams.get('state'), /^[\w-]{22}$/);
});

test('finish exchanges the code with the stashed verifier and clears the address bar and the stash', async () => {
  session.set('test-pkce', JSON.stringify({ verifier: 'v123', state: 's1' }));
  let sent;
  globalThis.fetch = async (url, init) => { sent = { url, init }; return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })); };
  const got = await P.finish({ ...O, q: new URLSearchParams('code=c9&state=s1'), url: 'https://id.test/token' });
  assert.deepEqual(got, { token: 'tok', expiresIn: 3600 });
  assert.equal(sent.url, 'https://id.test/token');
  assert.equal(sent.init.method, 'POST');
  assert.deepEqual(Object.fromEntries(sent.init.body), { grant_type: 'authorization_code', code: 'c9', redirect_uri: O.redirect, client_id: 'client', code_verifier: 'v123' });
  assert.deepEqual(replaced, ['/folder/page.html']);
  assert.equal(session.has('test-pkce'), false);
});

test('finish with no stash, or another state, asks nothing and says the sign-in did not complete', async () => {
  globalThis.fetch = async () => { throw new Error('must not be asked'); };
  assert.deepEqual(await P.finish({ ...O, q: new URLSearchParams('code=c&state=s1'), url: 'https://id.test/token' }), { note: P.INCOMPLETE });
  session.set('test-pkce', JSON.stringify({ verifier: 'v', state: 'other' }));
  assert.deepEqual(await P.finish({ ...O, q: new URLSearchParams('code=c&state=s1'), url: 'https://id.test/token' }), { note: P.INCOMPLETE });
  assert.equal(session.has('test-pkce'), false);
  assert.equal(replaced.length, 2);
});

test('finish says why the provider gave no token', async () => {
  const ask = () => { session.set('test-pkce', JSON.stringify({ verifier: 'v', state: 's1' })); return P.finish({ ...O, q: new URLSearchParams('code=c&state=s1'), url: 'https://id.test/token' }); };
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'The code has expired' }), { status: 400 });
  assert.deepEqual(await ask(), { note: 'Sign-in failed: The code has expired' });
  globalThis.fetch = async () => new Response('{}');
  assert.deepEqual(await ask(), { note: 'Sign-in failed: no token' });
  globalThis.fetch = async () => { throw new TypeError('NetworkError'); };
  assert.deepEqual(await ask(), { note: 'Sign-in failed: NetworkError' });
});

test('a token with no lifetime given has expiresIn null', async () => {
  session.set('test-pkce', JSON.stringify({ verifier: 'v', state: 's1' }));
  globalThis.fetch = async () => new Response(JSON.stringify({ access_token: 'tok' }));
  assert.deepEqual(await P.finish({ ...O, q: new URLSearchParams('code=c&state=s1'), url: 'https://id.test/token' }), { token: 'tok', expiresIn: null });
});

test('expires stops a minute short of the token\'s lifetime', () => {
  const at = P.expires(3600) - Date.now();
  assert.ok(at <= 3600000 - P.MARGIN_MS && at > 3600000 - P.MARGIN_MS - 1000);
});

test('account reads the provider\'s JSON with the token, and is {} when it can\'t', async () => {
  let auth;
  globalThis.fetch = async (url, init) => { auth = init.headers.Authorization; return new Response(JSON.stringify({ username: 'me' })); };
  assert.deepEqual(await P.account('https://id.test/me', 'tok'), { username: 'me' });
  assert.equal(auth, 'Bearer tok');
  globalThis.fetch = async () => new Response('no', { status: 401 });
  assert.deepEqual(await P.account('https://id.test/me', 'tok'), {});
  globalThis.fetch = async () => { throw new TypeError('NetworkError'); };
  assert.deepEqual(await P.account('https://id.test/me', 'tok'), {});
});
