// The OAuth2 code flow with PKCE (no secret) that the two sign-ins share: Hugging Face's (queen.jsx) and Lichess's
// (explorer.jsx). Each keeps its own client, endpoints, token store and messages; the steps here are the same for both.
(function () {
  // a token is taken as expired this long before it is, so a request never leaves with one about to lapse
  const MARGIN_MS = 60000;
  const INCOMPLETE = 'Sign-in didn’t complete (it was started in another tab or expired). Try again.';
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // where the provider sends the viewer back: the folder the page is served from
  const redirect = () => location.origin + location.pathname.replace(/[^/]*$/, '');

  // The provider's sign-in URL to go to. The verifier and state wait in sessionStorage (store) for finish().
  // o: { store, url, clientId, redirect, scope, prefix } (prefix: what the state starts with, to tell the providers' returns apart)
  async function authorizeUrl({ store, url, clientId, redirect: back, scope, prefix = '' }) {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = prefix + b64url(crypto.getRandomValues(new Uint8Array(16)));
    try { sessionStorage.setItem(store, JSON.stringify({ verifier, state })); } catch (e) {}
    return url + '?' + new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: back, ...(scope ? { scope } : {}), state, code_challenge: challenge, code_challenge_method: 'S256' });
  }

  // The return from the provider (q: the page's query, with code and state): the query leaves the address bar, and the code
  // is exchanged for a token. Answers { token, expiresIn (seconds, or null) }, or { note } saying why there is none
  async function finish({ store, q, url, clientId, redirect: back }) {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(store) || 'null'); sessionStorage.removeItem(store); } catch (e) {}
    history.replaceState(null, '', location.pathname);
    if (!saved || saved.state !== q.get('state')) return { note: INCOMPLETE };
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: back, client_id: clientId, code_verifier: saved.verifier }) });
      const t = await r.json();
      if (!t.access_token) throw new Error(t.error_description || t.error || 'no token');
      return { token: t.access_token, expiresIn: t.expires_in || null };
    } catch (e) { return { note: 'Sign-in failed: ' + ((e && e.message) || e) }; }
  }

  // when a token given for secs seconds stops being used
  const expires = (secs) => Date.now() + secs * 1000 - MARGIN_MS;
  // the account a token belongs to (the provider's own JSON), {} when it can't be read: only the name shown comes from it
  const account = (url, token) => fetch(url, { headers: { Authorization: 'Bearer ' + token } }).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));

  window.Pkce = { MARGIN_MS, INCOMPLETE, b64url, redirect, authorizeUrl, finish, expires, account };
})();
