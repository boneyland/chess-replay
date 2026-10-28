// ---------- the Lichess opening explorer (Settings › Online) ----------
// Game counts per move from Lichess's explorer (explorer.lichess.ovh), in the free board's Commentary box in place of the
// local opening book while the setting is on. Lichess answers only with a token (401 without), so this file also holds the
// sign-in: OAuth2 code flow with PKCE (no secret, no registration: any client id), or a personal token pasted by the viewer.
const EXPL = window.LichessCore ? window.LichessCore.create() : null;
const EXPL_DEBOUNCE_MS = 300; // after the last position change
const LI_AUTH_STORE = 'chess-video.lichess-auth.v1', LI_PKCE_STORE = 'chess-video.lichess-pkce';
const LI_CLIENT_ID = 'chess-replay';
const LI_REDIRECT = location.origin + location.pathname.replace(/[^/]*$/, '');
// the Lichess rating groups and speeds the Settings choices stand for (empty: all)
const EXPL_RATINGS = { All: [], '1600+': [1600, 1800, 2000, 2200, 2500], '2000+': [2000, 2200, 2500], '2200+': [2200, 2500] };
const EXPL_SPEEDS = { All: [], 'Rapid and slower': ['rapid', 'classical'], 'Blitz and slower': ['blitz', 'rapid', 'classical'] };
const explorerFilters = (tw) => ({ db: tw && tw.explorerDb === 'Masters' ? 'masters' : 'lichess', ratings: EXPL_RATINGS[tw && tw.explorerRating] || [], speeds: EXPL_SPEEDS[tw && tw.explorerSpeed] || [] });

function readLiAuth() { try { const a = JSON.parse(localStorage.getItem(LI_AUTH_STORE) || 'null'); return a && a.token && (!a.expires || a.expires > Date.now()) ? a : null; } catch (e) { return null; } }
// the signed-in state is shared by the panel and the settings
let liAuth = readLiAuth(), liNote = '';
const liSubs = new Set();
const liSet = (auth, note = liNote) => { liAuth = auth; liNote = note; liSubs.forEach((f) => f({ auth: liAuth, note: liNote })); };
const liB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liStore(a) { try { if (a) localStorage.setItem(LI_AUTH_STORE, JSON.stringify(a)); else localStorage.removeItem(LI_AUTH_STORE); } catch (e) {} }
async function liSignIn() {
  if (window.top !== window) { window.open(LI_REDIRECT + '#lichess-signin', '_blank'); return; }
  const verifier = liB64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = liB64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = 'lichess.' + liB64(crypto.getRandomValues(new Uint8Array(16)));
  try { sessionStorage.setItem(LI_PKCE_STORE, JSON.stringify({ verifier, state })); } catch (e) {}
  location.href = 'https://lichess.org/oauth?' + new URLSearchParams({ response_type: 'code', client_id: LI_CLIENT_ID, redirect_uri: LI_REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, state });
}
async function liFinish(q) {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(LI_PKCE_STORE) || 'null'); sessionStorage.removeItem(LI_PKCE_STORE); } catch (e) {}
  history.replaceState(null, '', location.pathname);
  if (!saved || saved.state !== q.get('state')) { liSet(liAuth, 'Sign-in didn’t complete (it was started in another tab or expired). Try again.'); return; }
  try {
    const r = await fetch('https://lichess.org/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: LI_REDIRECT, client_id: LI_CLIENT_ID, code_verifier: saved.verifier }) });
    const t = await r.json();
    if (!t.access_token) throw new Error(t.error_description || t.error || 'no token');
    const u = await fetch('https://lichess.org/api/account', { headers: { Authorization: 'Bearer ' + t.access_token } }).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
    const a = { token: t.access_token, expires: t.expires_in ? Date.now() + t.expires_in * 1000 - 60000 : 0, name: u.username || '' };
    liStore(a);
    liSet(a, `Signed in to Lichess${a.name ? ' as ' + a.name : ''}.`);
  } catch (e) { liSet(liAuth, 'Sign-in failed: ' + ((e && e.message) || e)); }
}
// a personal token pasted in Settings (lichess.org/account/oauth/token, no scopes needed), kept as it is
function liPaste(token) {
  const t = String(token || '').trim();
  if (!/^[\w-]{8,}$/.test(t)) { liSet(liAuth, 'That doesn’t look like a Lichess token.'); return false; }
  const a = { token: t, expires: 0, name: '' };
  liStore(a); liSet(a, 'Token saved.');
  return true;
}
function liSignOut() { liStore(null); liSet(null, ''); }
// the page was opened by Lichess's redirect, or by the embedded copy's "sign in in a new tab": finish or start it once
function liResume() {
  const q = new URLSearchParams(location.search), st = q.get('state') || '';
  if (st.startsWith('lichess.') && q.get('code')) liFinish(q);
  else if (st.startsWith('lichess.') && q.get('error')) { history.replaceState(null, '', location.pathname); liSet(liAuth, 'Lichess sign-in was cancelled.'); }
  else if (location.hash === '#lichess-signin') { history.replaceState(null, '', location.pathname); liSignIn(); }
}
if (EXPL) liResume();
window.addEventListener('storage', (e) => { if (e.key === LI_AUTH_STORE) liSet(readLiAuth()); });

function useLichessAuth() {
  const [v, setV] = React.useState({ auth: liAuth, note: liNote });
  React.useEffect(() => { liSubs.add(setV); setV({ auth: liAuth, note: liNote }); return () => { liSubs.delete(setV); }; }, []);
  return { auth: v.auth, note: v.note, signIn: liSignIn, signOut: liSignOut, paste: liPaste, clearNote: () => liSet(liAuth, '') };
}

// The explorer's answer for the position on the board, or null when it isn't asked (off, in a game):
// { state: 'loading' | 'auth' (no token, or one Lichess refuses) | 'none' (offline, an error, a back-off) | 'ready', x }.
// fen: the position's full FEN; filters: explorerFilters(tweaks)
function useExplorer(fen, on, filters) {
  const key = fen && on && EXPL ? EXPL_KEY(fen, filters) : null;
  const LA = useLichessAuth(), token = LA.auth && LA.auth.token; // follows a sign-in or out as it happens
  const [st, setSt] = React.useState({ key: null, x: undefined });
  const hit = key ? EXPL.explorerCached(fen, filters) : undefined;
  React.useEffect(() => {
    if (!key || !token || (hit && !hit.auth)) return; // no token: the panel asks to sign in, and nothing is sent
    const ctl = new AbortController();
    const id = setTimeout(() => EXPL.explorer(fen, filters, { signal: ctl.signal, token }).then((x) => { if (!ctl.signal.aborted) setSt({ key, x }); }), EXPL_DEBOUNCE_MS);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [key, token]);
  if (!key) return null;
  const x = hit || (st.key === key ? st.x : undefined);
  if (x && x.auth) return { state: 'auth', x: null, signedIn: !!token };
  if (!token && !x) return { state: 'auth', x: null, signedIn: false };
  return x ? { state: 'ready', x } : { state: x === null ? 'none' : 'loading', x: null };
}
const EXPL_KEY = (fen, f) => window.LichessCore.explorerKey(fen, f);

const nf = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
// white / draws / black as a bar, with the percentages in the tooltip
function ResultBar({ w, d, b, height }) {
  const t = Math.max(1, w + d + b), pc = (n) => Math.round((100 * n) / t);
  const seg = (n, bg, color) => (n ? <span style={{ flex: n, minWidth: 0, background: bg, color, textAlign: 'center', font: `600 ${tx(12)}px ${MONO}`, overflow: 'hidden', lineHeight: `${height}px` }}>{pc(n) >= 12 ? pc(n) + '%' : ''}</span> : null);
  return (
    <span className="expl-bar" title={`White ${pc(w)}% · draws ${pc(d)}% · Black ${pc(b)}%`} style={{ display: 'flex', flex: 1, minWidth: tx(60), height, borderRadius: 2, overflow: 'hidden', border: `1px solid ${C.line}` }}>
      {seg(w, '#f1ebe1', '#15100d')}{seg(d, '#8a8178', '#fff')}{seg(b, '#2a2320', '#f1ebe1')}
    </span>
  );
}

// The Commentary box on the free board while the explorer is on: the opening's name, then the moves with their game
// counts and results, each a button that plays the move as a drag would. x: useExplorer's answer; fallback: the local book's
// panel, for an answer that can't come (offline, a back-off)
function LichessExplorer({ x, tw, posKey, onPlay, white, fallback }) {
  const LA = useLichessAuth();
  const top = React.useRef(null);
  React.useLayoutEffect(() => { const box = top.current && top.current.parentElement; if (box) box.scrollTop = 0; }, [posKey]);
  if (x.state === 'none' && fallback) return fallback;
  const heading = (txt, dim) => <span className="book-head" style={{ display: 'block', font: `400 ${tx(30)}px/1.14 ${SERIF}`, color: dim ? C.dim : C.ink, textWrap: 'pretty' }}>{txt}</span>;
  const note = (txt) => <span style={{ display: 'block', marginTop: tx(8), font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{txt}</span>;
  const play = (e, uci) => { e.preventDefault(); e.stopPropagation(); onPlay(uci); };
  const masters = explorerFilters(tw).db === 'masters';
  let body, right = null;
  if (x.state === 'auth') {
    body = (
      <React.Fragment>
        {heading(x.signedIn ? 'Lichess refused the token' : 'Sign in to use the explorer', true)}
        {note('Lichess’s explorer answers only signed-in requests. Your positions go to explorer.lichess.ovh; the token stays in this browser.')}
        <button type="button" className="twk-btn" style={{ marginTop: tx(12) }} onClick={LA.signIn}>Sign in with Lichess</button>
      </React.Fragment>
    );
  } else if (x.state === 'loading') body = heading('Looking up…', true);
  else if (x.state === 'none') body = <React.Fragment>{heading('Not available', true)}{note('Lichess can’t be reached: offline, or busy for a minute.')}</React.Fragment>;
  else {
    const e = x.x;
    right = e.opening ? `${e.opening.eco} ${e.opening.name}` : null;
    body = (
      <React.Fragment>
        {heading(e.opening ? e.opening.name : e.total ? 'Not named' : 'No games', !e.opening)}
        {note(`${nf(e.total)} games · ${masters ? 'masters' : 'Lichess'}`)}
        <div className="expl-moves" style={{ display: 'flex', flexDirection: 'column', gap: tx(2), marginTop: tx(10) }}>
          {e.moves.map((m) => {
            const tip = `Play ${m.san}: ${nf(m.total)} games${m.averageRating ? `, average rating ${m.averageRating}` : ''}`;
            return (
              <div key={m.uci} className="mv" role="button" tabIndex={0} title={tip} aria-label={tip} onClick={(ev) => play(ev, m.uci)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') play(ev, m.uci); }}
                style={{ display: 'flex', alignItems: 'center', gap: tx(10), minWidth: 0, padding: `${tx(3)}px ${tx(6)}px`, borderRadius: 2, cursor: 'pointer' }}>
                <span style={{ flex: 'none', minWidth: tx(58), boxSizing: 'border-box', textAlign: 'center', padding: `${tx(2)}px ${tx(8)}px`, borderRadius: 2, font: `600 ${tx(17)}px ${MONO}`, background: white ? '#f1ebe1' : '#2a2320', color: white ? '#15100d' : '#f1ebe1' }}>{m.san}</span>
                <span style={{ flex: 'none', minWidth: tx(44), textAlign: 'right', font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{nf(m.total)}</span>
                <ResultBar w={m.white} d={m.draws} b={m.black} height={tx(20)} />
              </div>
            );
          })}
          {!e.moves.length && note('No games from here.')}
        </div>
        {e.games.length > 0 && <div style={{ marginTop: tx(12) }}>{e.games.map((g) => (
          <a key={g.id} href={`https://lichess.org/${g.id}`} target="_blank" rel="noopener noreferrer" title="Open the game on Lichess" onClick={(ev) => ev.stopPropagation()}
            style={{ display: 'block', font: `400 ${tx(15)}px ${SANS}`, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {g.white} {g.winner === 'white' ? '1–0' : g.winner === 'black' ? '0–1' : '½–½'} {g.black}{g.year ? ` · ${g.year}` : ''}
          </a>
        ))}</div>}
      </React.Fragment>
    );
  }
  return (
    <Panel box={{ ...L.comment, scroll: !L.comment.flow }} a={1} title="Opening explorer" right={right}>
      <div ref={top}>{body}</div>
    </Panel>
  );
}

// Settings › Online: the toggle, the filters, and the sign-in
function ExplorerSettings({ t, setTweak }) {
  const LA = useLichessAuth(), field = React.useRef(null);
  // the field is uncontrolled: the settings can be redrawn under it (an engine update), which would clear a controlled one
  const save = () => { if (field.current && LA.paste(field.current.value)) field.current.value = ''; };
  const on = t.explorer === true, db = t.explorerDb === 'Masters' ? 'Masters' : 'Lichess';
  return (
    <React.Fragment>
      <TweakToggle id="tw-explorer" label="Lichess opening explorer" info="With this on, the free board’s Commentary box lists the moves played from the position with their game counts (explorer.lichess.ovh), in place of the local book. Lichess answers only signed-in requests: sign in, or paste a personal token (lichess.org/account/oauth/token, no scopes). The position goes to Lichess; the token stays in this browser and goes only to Lichess. Off by default." value={on} onChange={(v) => setTweak('explorer', v)} />
      {on && <React.Fragment>
        <TweakSelect id="tw-expl-db" label="Games" value={db} options={['Lichess', 'Masters']} onChange={(v) => setTweak('explorerDb', v)} />
        {db === 'Lichess' && <TweakSelect id="tw-expl-rating" label="Rating" value={EXPL_RATINGS[t.explorerRating] ? t.explorerRating : 'All'} options={Object.keys(EXPL_RATINGS)} onChange={(v) => setTweak('explorerRating', v)} />}
        {db === 'Lichess' && <TweakSelect id="tw-expl-speed" label="Speed" value={EXPL_SPEEDS[t.explorerSpeed] ? t.explorerSpeed : 'All'} options={Object.keys(EXPL_SPEEDS)} onChange={(v) => setTweak('explorerSpeed', v)} />}
        {LA.auth
          ? <TweakButton secondary label={`Sign out of Lichess${LA.auth.name ? ' (' + LA.auth.name + ')' : ''}`} onClick={LA.signOut} />
          : <React.Fragment>
              <TweakButton label="Sign in with Lichess" onClick={LA.signIn} />
              <input id="tw-expl-token" className="twk-field" type="password" autoComplete="off" spellCheck={false} placeholder="or paste a Lichess token" aria-label="Lichess personal token" ref={field}
                onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
              <TweakButton secondary label="Use this token" onClick={save} />
            </React.Fragment>}
        {LA.note && <div className="twk-note" role="status" onClick={LA.clearNote}>{LA.note}</div>}
      </React.Fragment>}
    </React.Fragment>
  );
}
