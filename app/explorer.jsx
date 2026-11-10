// ---------- the Lichess opening explorer (Settings › Online) ----------
// Game counts per move from Lichess's explorer (explorer.lichess.ovh), in the free board's Commentary box in place of the
// local opening book while the setting is on. Lichess answers only with a token (401 without), so this file also holds the
// sign-in: OAuth2 code flow with PKCE (no secret, no registration: any client id), or a personal token pasted by the viewer.
const EXPL = window.LichessCore ? window.LichessCore.create() : null;
const EXPL_DEBOUNCE_MS = 300; // after the last position change
const LI_AUTH_STORE = 'chess-video.lichess-auth.v1', LI_PKCE_STORE = 'chess-video.lichess-pkce';
const LI_CLIENT_ID = 'chess-replay';
const LI_REDIRECT = window.Pkce.redirect();
// the Lichess rating groups and speeds the Settings choices stand for (empty: all)
// "Lichess default" is the website's own: every speed but ultrabullet, every rating group but the lowest (400)
const EXPL_RATINGS = { 'Lichess default': [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500], All: [], '1600+': [1600, 1800, 2000, 2200, 2500], '2000+': [2000, 2200, 2500], '2200+': [2200, 2500] };
const EXPL_SPEEDS = { 'Lichess default': ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'], All: [], 'Rapid and slower': ['rapid', 'classical'], 'Blitz and slower': ['blitz', 'rapid', 'classical'] };
const explorerFilters = (tw) => ({ db: tw && tw.explorerDb === 'Masters' ? 'masters' : 'lichess', ratings: EXPL_RATINGS[tw && tw.explorerRating] || EXPL_RATINGS['Lichess default'], speeds: EXPL_SPEEDS[tw && tw.explorerSpeed] || EXPL_SPEEDS['Lichess default'] });

function readLiAuth() { try { const a = JSON.parse(localStorage.getItem(LI_AUTH_STORE) || 'null'); return a && a.token && (!a.expires || a.expires > Date.now()) ? a : null; } catch (e) { return null; } }
// the signed-in state is shared by the panel and the settings
let liAuth = readLiAuth(), liNote = '';
const liSubs = new Set();
const liSet = (auth, note = liNote) => { liAuth = auth; liNote = note; liSubs.forEach((f) => f({ auth: liAuth, note: liNote })); };
function liStore(a) { try { if (a) localStorage.setItem(LI_AUTH_STORE, JSON.stringify(a)); else localStorage.removeItem(LI_AUTH_STORE); } catch (e) {} }
const LI_OAUTH = { store: LI_PKCE_STORE, clientId: LI_CLIENT_ID, redirect: LI_REDIRECT };
async function liSignIn() { location.href = await window.Pkce.authorizeUrl({ ...LI_OAUTH, url: 'https://lichess.org/oauth', prefix: 'lichess.' }); }
async function liFinish(q) {
  const P = window.Pkce, got = await P.finish({ ...LI_OAUTH, q, url: 'https://lichess.org/api/token' });
  if (!got.token) { liSet(liAuth, got.note); return; }
  const u = await P.account('https://lichess.org/api/account', got.token);
  const a = { token: got.token, expires: got.expiresIn ? P.expires(got.expiresIn) : 0, name: u.username || '' };
  liStore(a);
  liSet(a, `Signed in to Lichess${a.name ? ' as ' + a.name : ''}.`);
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
// the page was opened by Lichess's redirect: finish the sign-in once
function liResume() {
  const q = new URLSearchParams(location.search), st = q.get('state') || '';
  if (st.startsWith('lichess.') && q.get('code')) liFinish(q);
  else if (st.startsWith('lichess.') && q.get('error')) { history.replaceState(null, '', location.pathname); liSet(liAuth, 'Lichess sign-in was cancelled.'); }
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

const nf = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
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

// A move row played from the keyboard (Enter or Space) is replaced by the next position's list, which would drop the focus
// to the page: the new list's first row takes it once it shows (an answer still loading waits), unless the focus has
// gone somewhere else meanwhile. top: the list's container; returns the row's onKeyDown, given play(event, uci)
function useRowFocus(top) {
  const want = React.useRef(false);
  React.useLayoutEffect(() => {
    if (!want.current || !top.current) return;
    const act = document.activeElement;
    if (act && act !== document.body && !top.current.contains(act)) { want.current = false; return; }
    const row = top.current.querySelector('.expl-row');
    if (row) { want.current = false; row.focus(); }
  });
  return (play, uci) => (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { want.current = true; play(ev, uci); } };
}

// The Commentary box on the free board while the explorer is on: the opening's name, then the moves with their game
// counts and results, each a button that plays the move as a drag would. x: useExplorer's answer; fallback: the local book's
// panel, for an answer that can't come (offline, a back-off)
function LichessExplorer({ x, tw, setTweak, onGame, posKey, onPlay, onHover, white, fallback }) {
  const LA = useLichessAuth();
  const top = useScrollTop(posKey), loading = x.state === 'loading', rowKey = useRowFocus(top);
  // the progress line under the title, as the Analysis panel's: the answer's time isn't known, so it creeps towards the end
  const [pr, setPr] = React.useState(0);
  React.useEffect(() => {
    if (!loading) { setPr(0); return; }
    setPr(0.05);
    const id = setInterval(() => setPr((v) => v + (0.9 - v) * 0.12), 250);
    return () => clearInterval(id);
  }, [loading, posKey]);
  if (x.state === 'none' && fallback) return fallback;
  const heading = (txt, dim) => commentHead('book-head', txt, dim), note = commentNote;
  const play = (e, uci) => { e.preventDefault(); e.stopPropagation(); onPlay(uci); };
  const masters = explorerFilters(tw).db === 'masters';
  // Open games: Here (Import game fetches the game) or On Lichess (a new tab); a middle or Ctrl click is always Lichess
  const here = !!onGame && !(tw && tw.explorerOpen === 'lichess');
  let body, right = null;
  if (x.state === 'auth') {
    body = (
      <React.Fragment>
        {heading(x.signedIn ? 'Lichess refused the token' : 'Sign in to use the explorer', true)}
        {note('Lichess’s explorer answers only signed-in requests. Your positions go to explorer.lichess.ovh; the token stays in this browser.')}
        <button type="button" className="twk-btn" style={{ marginTop: tx(12) }} onClick={LA.signIn}>Sign in with Lichess</button>
      </React.Fragment>
    );
  } else if (loading) body = null;
  else if (x.state === 'none') body = <React.Fragment>{heading('Not available', true)}{note('Lichess can’t be reached: offline, or busy for a minute.')}</React.Fragment>;
  else {
    const e = x.x;
    right = e.opening ? `${e.opening.eco} ${e.opening.name}` : null;
    body = (
      <React.Fragment>
        {note(`${nf(e.total)} games · ${masters ? 'masters' : 'Lichess'}`)}
        <div className="expl-moves" style={{ display: 'flex', flexDirection: 'column', gap: tx(2), marginTop: tx(10) }}>
          {e.moves.map((m) => {
            const tip = `Play ${m.san}: ${nf(m.total)} games${m.averageRating ? `, average rating ${m.averageRating}` : ''}`;
            return (
              <div key={m.uci} className="mv expl-row" role="button" tabIndex={0} title={tip} aria-label={tip} onClick={(ev) => play(ev, m.uci)}
                onMouseEnter={() => onHover(m.uci)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(m.uci)} onBlur={() => onHover(null)}
                onKeyDown={rowKey(play, m.uci)}
                style={{ display: 'flex', alignItems: 'center', gap: tx(10), minWidth: 0, padding: `${tx(3)}px ${tx(6)}px`, borderRadius: 2, cursor: 'pointer' }}>
                <span style={rowChip(white)}>{m.san}</span>
                <span style={{ flex: 'none', minWidth: tx(44), textAlign: 'right', font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{nf(m.total)}</span>
                <ResultBar w={m.white} d={m.draws} b={m.black} height={tx(20)} />
              </div>
            );
          })}
          {!e.moves.length && note('No games from here.')}
        </div>
        {e.games.length > 0 && onGame && <div className="expl-open" role="radiogroup" aria-label="Open games" style={{ display: 'flex', alignItems: 'center', gap: tx(6), marginTop: tx(12), font: `500 ${tx(14)}px ${MONO}`, color: C.dim }}>
          <span>Open games</span>
          {[['here', 'Here'], ['lichess', 'On Lichess']].map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={here === (v === 'here')} className={'expl-open-btn' + (here === (v === 'here') ? ' on' : '')}
              onClick={(ev) => { ev.stopPropagation(); setTweak('explorerOpen', v); }}>{label}</button>
          ))}
        </div>}
        {e.games.length > 0 && <div style={{ marginTop: tx(onGame ? 6 : 12) }}>{e.games.map((g) => (
          <a key={g.id} href={`https://lichess.org/${g.id}`} target="_blank" rel="noopener noreferrer" title={here ? 'Open the game here' : 'Open the game on Lichess'}
            onClick={(ev) => { ev.stopPropagation(); if (here && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) { ev.preventDefault(); onGame(`https://lichess.org/${g.id}`); } }}
            style={{ display: 'block', font: `400 ${tx(15)}px ${SANS}`, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {g.white} {g.winner === 'white' ? '1–0' : g.winner === 'black' ? '0–1' : '½–½'} {g.black}{g.year ? ` · ${g.year}` : ''}
          </a>
        ))}</div>}
      </React.Fragment>
    );
  }
  return (
    <Panel box={{ ...L.comment, scroll: !L.comment.flow }} a={1} part="opening-explorer" title="Opening explorer" right={right} progress={loading ? pr : null}>
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
      <TweakToggle id="tw-explorer" label="Lichess opening explorer" info="With this on, the free board’s Opening explorer box lists the moves played from the position with their game counts (explorer.lichess.ovh), in place of the local book. Lichess answers only signed-in requests: sign in, or paste a personal token (lichess.org/account/oauth/token, no scopes). The position goes to Lichess; the token stays in this browser and goes only to Lichess. Off by default." value={on} onChange={(v) => setTweak('explorer', v)} />
      {on && <React.Fragment>
        <TweakSelect id="tw-expl-db" label="Database" value={db} options={['Lichess', 'Masters']} onChange={(v) => setTweak('explorerDb', v)} />
        {db === 'Lichess' && <TweakSelect id="tw-expl-rating" label="Rating" value={EXPL_RATINGS[t.explorerRating] ? t.explorerRating : 'Lichess default'} options={Object.keys(EXPL_RATINGS)} onChange={(v) => setTweak('explorerRating', v)} />}
        {db === 'Lichess' && <TweakSelect id="tw-expl-speed" label="Time control" value={EXPL_SPEEDS[t.explorerSpeed] ? t.explorerSpeed : 'Lichess default'} options={Object.keys(EXPL_SPEEDS)} onChange={(v) => setTweak('explorerSpeed', v)} />}
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
