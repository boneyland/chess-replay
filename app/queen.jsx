// ---------- Queen (chess LM on the boneyland/queen-pawn-8 Space, called through its Gradio API) ----------
const QUEEN_STORE = 'chess-video.queen.v1';
const QUEEN_SPACE = 'https://huggingface.co/spaces/boneyland/queen-pawn-8';
// The Space reserves 15 s + 0.03 s per token of ZeroGPU for each call: 1536 tokens reserves 61 s instead of 76 s.
// Typical answers are ~900-1300 tokens; a longer one is cut and the Space falls back to Queen's line or candidates.
const QUEEN_TOKENS = 1536;

const { queenPayload, queenEval, queenProse, readSse, capQueenCache, queenAnswer, queenFile } = window.QueenCore;

const fmtPawns = (v) => (v == null ? '—' : (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + Math.abs(v).toFixed(2));

function queenError(e) {
  const code = e && e.code;
  if (code === 'tool_error') return 'The Queen Space reported an error: ' + String((e && e.message) || '').slice(0, 300);
  if (code === 'server_unavailable' || code === 'upstream_error')
    return `No answer from the Queen Space${e.secs != null ? ` after ${e.secs} s` : ''}${e.retryable ? ', even after a retry' : ''}. It may be busy, waking up or out of ZeroGPU quota. Try again in a minute.`;
  if (code === 'cancelled') return 'Stopped.';
  if (code === 'direct_auth') return e.message;
  return (e && e.message) || 'Queen could not analyse this position.';
}

const plyLabel = (M, i) => window.ChessCore.moveNo(M.ply0 + i);
const sanOf = (M, i) => M.plies[i].san + (M.plies[i].mark || '');
// Stockfish's choice in the position before ply i, when the game data has it
const engineBest = (M, i) => { const P = M.plies[i]; if (!P) return null; return P.best ? P.best.uci : P.cls === 'best' ? P.uci : null; };
const uciToSan = (M, i, uci) => {
  if (!uci) return null;
  const P = M.plies[i];
  if (P && P.uci === uci) return P.san;
  if (P && P.best && P.best.uci === uci && P.best.line && P.best.line[0]) return P.best.line[0];
  return uci;
};

// ---------- direct connection to the Space ----------
// The page calls the Space's Gradio API itself, signed in with Hugging Face (the visitor's ZeroGPU quota) or anonymously.
const DIRECT_API = 'https://boneyland-queen-pawn-8.hf.space/gradio_api';
// Public OAuth app (no secret) registered at huggingface.co/settings/applications. Sign-in returns to the folder the
// page is served from (https://chess-replay.onrender.com/); each host's URL must be a redirect URL there. A static HF Space
// with `hf_oauth: true` in its README gets its own app, whose ID HF injects as window.huggingface.variables
const HF_OAUTH = { clientId: (window.huggingface && window.huggingface.variables || {}).OAUTH_CLIENT_ID || '5d94cba5-1c7f-49ec-9ea3-5419e82a3af5', scope: 'openid profile', redirect: location.origin + location.pathname.replace(/[^/]*$/, '') };
const AUTH_STORE = 'chess-video.hf-auth.v1', PKCE_STORE = 'chess-video.hf-pkce';
// a pull request's preview on Render (chess-replay-pr-64.onrender.com) is a host the OAuth app doesn't list, so Hugging
// Face would refuse its redirect: sign-in is offered on the live site only
const HF_PREVIEW = /-pr-\d+[\w-]*\.onrender\.com$/.test(location.hostname);

async function directCall(moves, token, signal, fen = '') {
  const auth = token ? { Authorization: 'Bearer ' + token } : {};
  const unreachable = () => (signal && signal.aborted ? { code: 'cancelled', message: 'Stopped.' } : { code: 'server_unavailable', retryable: true, message: 'Could not reach the Space.' });
  let r;
  try {
    r = await fetch(`${DIRECT_API}/call/analyse_position`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ data: [fen, moves, QUEEN_TOKENS, 0.6, 20260823] }), signal });
  } catch (e) { throw unreachable(); }
  if (r.status === 401 || r.status === 403) throw { code: 'direct_auth', message: 'The Space refused the sign-in. Sign out and try again.' };
  if (!r.ok) throw { code: 'server_unavailable', retryable: r.status >= 500 || r.status === 429, message: `The Space answered ${r.status}.` };
  const { event_id } = await r.json();
  let text;
  try { text = await (await fetch(`${DIRECT_API}/call/analyse_position/${event_id}`, { headers: auth, signal })).text(); } catch (e) { throw unreachable(); }
  const { result, error } = readSse(text);
  if (result) return { payload: Array.isArray(result) ? result[0] : result };
  // Gradio errors arrive as {error, title}, e.g. "You have exceeded your ZeroGPU runs limit. Authenticate with…"
  const msg = error && typeof error === 'object' ? error.error || error.title || JSON.stringify(error) : error;
  throw { code: 'tool_error', message: String(msg || 'The Space returned no answer.') };
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function readAuth() { try { const a = JSON.parse(localStorage.getItem(AUTH_STORE) || 'null'); return a && a.token && a.expires > Date.now() ? a : null; } catch (e) { return null; } }

// "Sign in with Hugging Face" (OAuth code flow with PKCE, no secret). Inside an iframe (the notes site embeds the
// page) it opens the page in a new tab, which signs in there: the embedding site is another site, so the browser
// keeps the iframe's storage separate and the token can't reach it.
function useHfAuth() {
  const [auth, setAuth] = React.useState(readAuth);
  const [note, setNote] = React.useState('');
  const enabled = !!HF_OAUTH.clientId && !HF_PREVIEW;
  const start = async () => {
    if (!enabled) return;
    if (window.top !== window) { window.open(HF_OAUTH.redirect + '#hf-signin', '_blank'); return; }
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    try { sessionStorage.setItem(PKCE_STORE, JSON.stringify({ verifier, state })); } catch (e) {}
    location.href = 'https://huggingface.co/oauth/authorize?' + new URLSearchParams({ client_id: HF_OAUTH.clientId, redirect_uri: HF_OAUTH.redirect, response_type: 'code', scope: HF_OAUTH.scope, state, code_challenge: challenge, code_challenge_method: 'S256' });
  };
  const finish = async (q) => {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(PKCE_STORE) || 'null'); sessionStorage.removeItem(PKCE_STORE); } catch (e) {}
    history.replaceState(null, '', location.pathname);
    if (!saved || saved.state !== q.get('state')) { setNote('Sign-in didn’t complete (it was started in another tab or expired). Try again.'); return; }
    try {
      const r = await fetch('https://huggingface.co/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: HF_OAUTH.redirect, client_id: HF_OAUTH.clientId, code_verifier: saved.verifier }) });
      const t = await r.json();
      if (!t.access_token) throw new Error(t.error_description || t.error || 'no token');
      const u = await fetch('https://huggingface.co/oauth/userinfo', { headers: { Authorization: 'Bearer ' + t.access_token } }).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
      const a = { token: t.access_token, expires: Date.now() + (t.expires_in || 28800) * 1000 - 60000, name: u.preferred_username || u.name || '' };
      try { localStorage.setItem(AUTH_STORE, JSON.stringify(a)); } catch (e) {}
      setAuth(a);
      setNote(`Signed in to Hugging Face${a.name ? ' as ' + a.name : ''}.` + (window.opener ? ' Ask Queen from this tab: the embedded copy can’t use this sign-in.' : ''));
    } catch (e) { setNote('Sign-in failed: ' + ((e && e.message) || e)); }
  };
  const signOut = () => { try { localStorage.removeItem(AUTH_STORE); } catch (e) {} setAuth(null); };
  React.useEffect(() => {
    const onStorage = (e) => { if (e.key === AUTH_STORE) setAuth(readAuth()); };
    window.addEventListener('storage', onStorage);
    const q = new URLSearchParams(location.search);
    if ((q.get('state') || '').startsWith('lichess.')) return () => window.removeEventListener('storage', onStorage); // Lichess's sign-in (explorer.jsx)
    if (q.get('code') && q.get('state')) finish(q);
    else if (q.get('error')) { history.replaceState(null, '', location.pathname); setNote('Hugging Face sign-in was cancelled.'); }
    else if (location.hash === '#hf-signin') { history.replaceState(null, '', location.pathname); start(); }
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return { auth, enabled, preview: HF_PREVIEW, start, signOut, note, clearNote: () => setNote('') };
}

function readQueenCache() { try { return window.QueenCore.readQueenCache(JSON.parse(localStorage.getItem(QUEEN_STORE) || '{}')); } catch (e) { return {}; } }
// false when the storage is full (the answers stay for this visit), null with no storage at all
function writeQueenCache(c) {
  try { localStorage.setItem(QUEEN_STORE, JSON.stringify(c)); return true; }
  catch (e) { return e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') ? false : null; }
}

// at = number of plies played; the position is the one before ply index `at`
function useQueen(M, hf) {
  const [cache, setCache] = React.useState(readQueenCache);
  const cacheRef = React.useRef(cache);
  const [busy, setBusy] = React.useState(null); // {at, started}
  const [err, setErr] = React.useState('');
  const [, tick] = React.useState(0);
  const stopRef = React.useRef(false);
  const ctrlRef = React.useRef(null);
  React.useEffect(() => { if (!busy) return; const id = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(id); }, [busy]);
  const startFen = M.start.fen === window.ChessCore.START_FEN ? '' : M.start.fen; // the Space takes '' for the standard start
  const movesAt = (at) => M.plies.slice(0, at).map((p) => p.uci).join(' ');
  const keyAt = (at) => window.QueenCore.queenKey(M.start.fen, movesAt(at));

  const [log, setLog] = React.useState([]);
  const note = (entry) => setLog((l) => [{ ...entry, when: new Date().toLocaleTimeString() }, ...l].slice(0, 30));
  const wait = (ms, signal) => new Promise((res, rej) => {
    const id = setTimeout(res, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(id); rej({ code: 'cancelled', message: 'Stopped.' }); }, { once: true });
  });

  const analyse = async (at) => {
    const key = keyAt(at);
    if (cacheRef.current[key]) return cacheRef.current[key];
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    try {
      for (let attempt = 1; ; attempt++) {
        const started = Date.now();
        setBusy({ at, started, attempt });
        try {
          const res = await directCall(movesAt(at), hf && hf.auth ? hf.auth.token : null, ctrl.signal, startFen);
          const p = queenPayload(res);
          const str = (v) => (typeof v === 'string' ? v : '');
          const r = queenAnswer({
            best: p.best_move_uci, bestSan: p.best_move_san, line: p.critical_line_san,
            evalText: p.evaluation, evalPawns: queenEval(str(p.evaluation)), prose: queenProse(str(p.analysis) || str(p.raw_text)),
            seconds: p.seconds, source: p.move_source,
          }, at);
          note({ at, ok: true, secs: Math.round((Date.now() - started) / 1000), gpu: p.seconds ? Math.round(p.seconds) : null, tokens: p.generated_tokens || null });
          const next = capQueenCache({ ...cacheRef.current, [key]: r });
          cacheRef.current = next;
          if (writeQueenCache(next) === false) setErr('The browser’s storage is full: this answer is kept until you leave the page, not after a reload.');
          setCache(next);
          return r;
        } catch (e) {
          const secs = Math.round((Date.now() - started) / 1000);
          note({ at, ok: false, code: (e && e.code) || '?', secs, msg: e && e.message ? String(e.message).slice(0, 200) : '' });
          if (e && typeof e === 'object') e.secs = secs;
          // A temporary failure gets one more try after the wait the runtime suggests
          if (attempt === 1 && e && e.retryable && !ctrl.signal.aborted) {
            const ms = Math.min(60000, e.retryAfterMs || 4000 + Math.random() * 4000);
            setBusy({ at, started: Date.now(), attempt, retryAt: Date.now() + ms });
            await wait(ms, ctrl.signal);
            continue;
          }
          throw e;
        }
      }
    } finally { setBusy(null); ctrlRef.current = null; }
  };
  const resultAt = (at) => cache[keyAt(at)] || null;
  const has = (at) => !!cacheRef.current[keyAt(at)];
  const stop = () => { stopRef.current = true; if (ctrlRef.current) ctrlRef.current.abort(); };
  const forget = () => { cacheRef.current = {}; setCache({}); writeQueenCache({}); };
  // answers from a saved file join the cache as its newest entries; returns how many are for this game
  const [msg, setMsg] = React.useState('');
  const merge = (answers) => {
    const next = capQueenCache({ ...cacheRef.current, ...answers });
    cacheRef.current = next; setCache(next);
    const n = Object.keys(queenFile(answers, M.plies.map((p) => p.uci), M.start.fen).answers).length, all = Object.keys(answers).length;
    const kept = writeQueenCache(next) === false ? ' The browser’s storage is full: they are kept until you leave the page, not after a reload.' : '';
    setErr(''); setMsg(`Loaded ${all} Queen answer${all === 1 ? '' : 's'}${n < all ? `, ${n} for this game` : ''}.` + kept);
    return n;
  };
  const saved = () => queenFile(cacheRef.current, M.plies.map((p) => p.uci), M.start.fen);
  const forGame = Object.keys(queenFile(cache, M.plies.map((p) => p.uci), M.start.fen).answers).length;
  return { cache, analyse, resultAt, has, busy, err, setErr, msg, setMsg, stopRef, stop, forget, merge, saved, forGame, log, cached: Object.keys(cache).length };
}

// an answer the page can't read is shown as it came, to copy
const queenDiagnose = (e) => ['error: ' + ((e && e.code) || '?') + (e && e.message ? ' — ' + String(e.message).slice(0, 300) : ''), e && e.raw ? 'answer: ' + String(e.raw).slice(0, 400) : ''].filter(Boolean).join('\n');

const posLabel = (M, at) => (at === 0 ? 'the starting position' : `after ${plyLabel(M, at - 1)}${sanOf(M, at - 1)}`);
const sfAt = (M, at) => (M.hasEval && (at > 0 || M.evalStartKnown) ? (at === 0 ? M.evalStart : cpOf(M, at - 1)) / 100 : null);
// Change from the mover's side, negative when the move lost ground (the Analysis panel's "−73 cp" convention)
const moverChange = (before, after, white) => (before == null || after == null ? null : (after - before) * (white ? 1 : -1));

function QueenResult({ M, at, r, after, afterState, onScoreAfter }) {
  if (!r) return null;
  const i = at, next = M.plies[i], white = (M.ply0 + i) % 2 === 0;
  const sf = engineBest(M, i), sfSan = uciToSan(M, i, sf);
  const agree = sf && r.best === sf;
  const qBefore = queenEval(r.evalText), sfBefore = sfAt(M, at);
  const qAfter = after ? queenEval(after.evalText) : null, sfAfter = next ? sfAt(M, at + 1) : null;
  const num = (v) => (v == null ? 'n/a' : fmtPawns(v));
  const afterCell = after ? num(qAfter)
    : afterState === 'busy' ? '…'
    : afterState === 'none' ? 'n/a'
    : <button type="button" className="q-mini" onClick={onScoreAfter}>{afterState === 'failed' ? 'Retry' : 'Score it'}</button>;
  return (
    <div className="q-result">
      <div className="q-pos">{plyLabel(M, i)} {white ? 'White' : 'Black'} to move</div>
      <dl className="q-grid">
        <dt>Queen</dt><dd><b className="q-queen">{r.bestSan || r.best || '—'}</b>{sf && <span className={agree ? 'q-tag q-ok' : 'q-tag q-no'}>{agree ? 'matches Stockfish' : 'differs'}</span>}</dd>
        {sf && <><dt>Stockfish</dt><dd>{sfSan}</dd></>}
        {next && <><dt>Played</dt><dd style={{ color: next.cls === 'none' || next.cls === 'best' ? undefined : clsColor(next.cls) }}>{sanOf(M, i)}</dd></>}
        {r.line && <><dt>Line</dt><dd className="q-line">{r.line}</dd></>}
      </dl>
      <div className="q-evalbox">
        <table className="q-evals">
          <thead><tr><th scope="col"><span className="q-sr">Position</span></th><th scope="col">Queen</th>{M.hasEval && <th scope="col">Stockfish</th>}</tr></thead>
          <tbody>
            <tr><th scope="row">Before {plyLabel(M, i)}</th><td className="q-evalv">{num(qBefore)}</td>{M.hasEval && <td>{num(sfBefore)}</td>}</tr>
            {next && <tr><th scope="row">After {sanOf(M, i)}</th><td className="q-evalv">{afterCell}</td>{M.hasEval && <td>{num(sfAfter)}</td>}</tr>}
            {next && after && <tr className="q-change"><th scope="row">Change for {white ? 'White' : 'Black'}</th><td>{num(moverChange(qBefore, qAfter, white))}</td>{M.hasEval && <td>{num(moverChange(sfBefore, sfAfter, white))}</td>}</tr>}
          </tbody>
        </table>
        <div className="q-evalnote">Pawns from White’s side (+ favours White, − Black). The change is from the mover’s side: negative means the move lost ground.</div>
        {r.evalText ? <p className="q-evaltext"><span>Before:</span> {r.evalText}</p> : <p className="q-evaltext q-dim">Queen gave no evaluation before the move.</p>}
        {after && (after.evalText ? <p className="q-evaltext"><span>After {sanOf(M, i)}:</span> {after.evalText}</p> : <p className="q-evaltext q-dim">Queen gave no evaluation after the move.</p>)}
      </div>
      {r.source && r.source !== 'best_move' && <div className="twk-note">Queen’s answer was cut short or had no usable best move, so the Space took this move from {r.source === 'critical_line' ? 'its line' : 'its candidates'}.</div>}
      {r.prose.length > 0 && (
        <details className="q-why">
          <summary>Queen’s reasoning{r.seconds ? ` · ${Math.round(r.seconds)} s` : ''}</summary>
          {r.prose.map((p, k) => <p key={k}>{p}</p>)}
        </details>
      )}
    </div>
  );
}

// Queen's answers for the video: before = the position before move i, after = the position after it
function withQueen(M, resultAt) {
  let any = false;
  const plies = M.plies.map((p, i) => {
    const before = resultAt(i), after = resultAt(i + 1);
    if (!before && !after) return p;
    any = true;
    return { ...p, queen: { before, after }, queenText: after && after.evalText ? after.evalText : '' };
  });
  return any ? { ...M, plies } : M;
}
const fmtQ = (v) => fmtPawns(v);

function QueenPanel({ M, Q, hf, probe, onClose, onOverlay, onSave, left }) {
  const [sel, setSel] = React.useState(null); // at: the position before the selected move
  const [running, setRunning] = React.useState(false);
  const [diag, setDiag] = React.useState('');
  const [failed, setFailed] = React.useState([]); // positions (at) whose last try failed
  // Esc closes the panel, as it does Settings
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const fail = (e) => {
    Q.setErr(queenError(e));
    setDiag(e && e.code === 'bad_answer' ? queenDiagnose(e) : '');
  };
  const N = M.plies.length;
  const marked = React.useMemo(() => M.plies.map((p, i) => i).filter((i) => ['inaccuracy', 'mistake', 'blunder'].includes(M.plies[i].cls)), [M]);
  // The position after move i can be scored unless the move ended the game
  const canAfter = (i) => i < N && !M.plies[i].checkmate;
  const seek = (t) => window.dispatchEvent(new CustomEvent('chess-video:seek', { detail: { time: t } }));
  // Show the board just after move i is played (its highlight and badge settled, before the next move starts)
  const seekAfter = (i) => {
    const S = probe.current && probe.current.S;
    if (!S || i >= S.N) return seek(undefined);
    seek(i + 1 < S.N ? S.tp[i + 1] - 0.12 : S.tp[i] + S.md[i] + 3);
  };
  const show = (at) => { setSel(at); const r = Q.resultAt(at); onOverlay(r ? { at, best: r.best } : null); };
  const markFailed = (at, bad) => setFailed((f) => (bad ? (f.includes(at) ? f : [...f, at]) : f.filter((x) => x !== at)));

  // Score one position; returns the result, or throws after recording the failure
  const score = async (at) => {
    try { const r = await Q.analyse(at); markFailed(at, false); return r; }
    catch (e) { markFailed(at, true); throw e; }
  };
  // The position before move `at`, then the position after it
  const scorePair = async (at) => {
    const r = await score(at);
    onOverlay({ at, best: r.best });
    if (canAfter(at) && !Q.has(at + 1) && !Q.stopRef.current) await score(at + 1);
  };

  // The move on the board: the position before it, then the one after it (the board); before move 1, the start
  const askHere = async () => {
    const pr = probe.current;
    if (!pr) return;
    seek(undefined); // pause where it is
    const at = Math.max(0, pr.c);
    Q.setErr(''); setDiag(''); setSel(at); Q.stopRef.current = false;
    try { if (pr.c < 0) onOverlay({ at, best: (await score(at)).best }); else await scorePair(at); } catch (e) { fail(e); }
  };
  const scoreAfter = async (at) => {
    Q.setErr(''); setDiag(''); Q.stopRef.current = false;
    try { await score(at + 1); } catch (e) { fail(e); }
  };
  const runTest = async () => {
    Q.setErr(''); setDiag(''); Q.stopRef.current = false; setRunning(true);
    let failsInRow = 0;
    for (const i of marked) {
      if (Q.stopRef.current) break;
      const todo = [i, canAfter(i) ? i + 1 : null].filter((at) => at != null && !Q.has(at));
      if (!todo.length) continue;
      setSel(i); seekAfter(i);
      let stop = false;
      for (const at of todo) {
        if (Q.stopRef.current) break;
        try { const r = await score(at); if (at === i) onOverlay({ at: i, best: r.best }); failsInRow = 0; }
        catch (e) {
          const transient = e && (e.code === 'server_unavailable' || e.code === 'upstream_error');
          if (!transient || ++failsInRow >= 2) { fail(e); stop = true; break; }
        }
      }
      if (stop) break;
    }
    setRunning(false);
  };

  const rows = marked.map((i) => ({ i, r: Q.resultAt(i), after: canAfter(i) ? Q.resultAt(i + 1) : null, sf: engineBest(M, i) }));
  const done = rows.filter((x) => x.r);
  const matchSf = done.filter((x) => x.sf && x.r.best === x.sf).length;
  const repeated = done.filter((x) => x.r.best === M.plies[x.i].uci).length;
  const missing = rows.reduce((n, x) => n + (x.r ? 0 : 1) + (canAfter(x.i) && !x.after ? 1 : 0), 0);
  const total = rows.reduce((n, x) => n + 1 + (canAfter(x.i) ? 1 : 0), 0);
  const selR = sel != null ? Q.resultAt(sel) : null;
  const selNext = sel != null && sel < N;
  const selAfter = selNext && canAfter(sel) ? Q.resultAt(sel + 1) : null;
  const selAfterState = !selNext ? null : !canAfter(sel) ? 'none' : selAfter ? 'done'
    : Q.busy && Q.busy.at === sel + 1 ? 'busy' : failed.includes(sel + 1) ? 'failed' : Q.busy || running ? 'busy' : 'idle';
  const busySecs = Q.busy ? Math.round((Date.now() - Q.busy.started) / 1000) : 0;
  const rowCell = (at, r, sf) => (r ? <span className={sf && r.best === sf ? 'q-ok' : 'q-no'}>{r.bestSan || r.best}</span>
    : Q.busy && Q.busy.at === at ? '…' : failed.includes(at) ? <span className="q-fail">failed</span> : <span className="q-dim">—</span>);
  const pick = (i) => { seekAfter(i); show(i); };

  return (
    <aside className="twk-panel q-panel" aria-label="Queen" style={left == null ? undefined : { left }}>
      <div className="twk-hd"><span className="q-hd"><b>Queen</b><span className="q-exp">Experimental</span></span><button type="button" className="twk-x" aria-label="Close Queen" onClick={onClose}>✕</button></div>
      <div className="twk-body">
        <div className="twk-note">A chess language model on the <a href={QUEEN_SPACE} target="_blank" rel="noopener">boneyland/queen-pawn-8 Space</a>. It is not an engine: its evaluations are estimates and it can get tactics wrong. Each new position uses about 20–35 s of your daily Hugging Face ZeroGPU quota (5 min free, 40 min PRO); positions it has already answered are free.</div>
        <div className="q-via-box">
          <div className="twk-note q-via">
            {hf.auth ? <>Signed in{hf.auth.name ? <> as <b className="q-strong">{hf.auth.name}</b></> : null}: calls use your ZeroGPU quota.</>
              : <>Not signed in: calls use Hugging Face’s anonymous allowance (about 2 min of GPU a day, shared across your network).</>}
          </div>
          {hf.enabled && (hf.auth
            ? <TweakButton secondary label="Sign out of Hugging Face" onClick={hf.signOut} />
            : <TweakButton label="Sign in with Hugging Face" onClick={hf.start} />)}
          {hf.preview && !hf.auth && <div className="twk-note">Sign-in works on the <a href="https://chess-replay.onrender.com/" target="_blank" rel="noopener">live site</a>, not on a pull request’s preview.</div>}
        </div>
        <TweakButton disabled={!!Q.busy || running} label="Analyse the position on the board" onClick={askHere} />
        {Q.busy && (
          <div className="q-busy"><span className="q-dot" aria-hidden="true" />
            {Q.busy.retryAt
              ? `No answer for the position ${posLabel(M, Q.busy.at)}; retrying in ${Math.max(0, Math.ceil((Q.busy.retryAt - Date.now()) / 1000))} s`
              : `Queen is thinking about the position ${posLabel(M, Q.busy.at)} … ${busySecs} s${Q.busy.attempt > 1 ? ' (retry)' : ''}`}
            <button type="button" className="q-stop" onClick={Q.stop}>Stop</button>
          </div>
        )}
        {Q.err && <div className="twk-note twk-err" role="alert">{Q.err}</div>}
        {Q.msg && !Q.err && <div className="twk-note" role="status">{Q.msg}</div>}
        {diag && (
          <div className="q-diag">
            <div className="twk-note">The answer as it came:</div>
            <pre>{diag}</pre>
            <TweakButton secondary label="Copy details" onClick={(ev) => {
              const pre = ev.currentTarget.previousSibling;
              const sel = () => { const r = document.createRange(); r.selectNodeContents(pre); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); };
              try { navigator.clipboard.writeText(diag).catch(sel); } catch (e) { sel(); }
            }} />
          </div>
        )}
        {selR && <QueenResult M={M} at={sel} r={selR} after={selAfter} afterState={selAfterState} onScoreAfter={() => scoreAfter(sel)} />}

        <div className="twk-sect q-sect">Marked moves</div>
        {marked.length === 0 ? <div className="twk-note">This game has no inaccuracies or worse, so there’s nothing to test.</div> : (
          <React.Fragment>
            <div className="twk-note">
              {done.length ? <>Queen found Stockfish’s move in <b className="q-strong">{matchSf} of {done.length}</b> positions{repeated ? <>, and chose the move actually played (the mistake) in {repeated}</> : null}.</> : `For each move rated a mistake, Queen picks its own move beforehand and scores the positions before and after, to compare with Stockfish.`}
            </div>
            {missing > 0 && (running
              ? <TweakButton secondary label="Stop after this position" onClick={() => { Q.stopRef.current = true; }} />
              : <TweakButton disabled={!!Q.busy} label={`Test Queen on ${missing === total ? `the ${rows.length} marked moves` : 'the rest'} (${missing} position${missing > 1 ? 's' : ''}, ~${Math.ceil(missing * 40 / 60)} min)`} onClick={runTest} />)}
            <table className="q-table">
              <thead><tr><th>Move</th><th>Played</th><th>Stockfish</th><th>Queen</th></tr></thead>
              <tbody>
                {rows.map(({ i, r, sf }) => (
                  <tr key={i} className={sel === i ? 'q-sel' : ''} tabIndex={0} onClick={() => pick(i)} onKeyDown={(e) => { if (e.key === 'Enter') pick(i); }}>
                    <td className="q-dim">{plyLabel(M, i)}</td>
                    <td style={{ color: clsColor(M.plies[i].cls) }}>{sanOf(M, i)}</td>
                    <td>{sf ? uciToSan(M, i, sf) : '—'}</td>
                    <td>{rowCell(i, r, sf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </React.Fragment>
        )}
        {Q.log.length > 0 && (
          <details className="q-why q-log">
            <summary>Call log ({Q.log.filter((x) => x.ok).length} answered, {Q.log.filter((x) => !x.ok).length} failed)</summary>
            <pre>{Q.log.map((x) => `${x.when}  ${posLabel(M, x.at)}  ${x.ok ? `ok in ${x.secs} s${x.gpu != null ? ` (GPU ${x.gpu} s, ${x.tokens} tokens)` : ''}` : `${x.code} after ${x.secs} s${x.msg ? ': ' + x.msg : ''}`}`).join('\n')}</pre>
          </details>
        )}
        {onSave && Q.forGame > 0 && <TweakButton secondary label={`Save Queen answers (${Q.forGame})`} onClick={onSave} />}
        {onSave && Q.forGame > 0 && <div className="twk-note">Saves this game’s answers as a file. Load it like a game file to skip asking Queen again.</div>}
        {Q.cached > 0 && !Q.busy && !running && <TweakButton secondary label="Forget saved Queen answers" onClick={() => { Q.forget(); setSel(null); onOverlay(null); setFailed([]); }} />}
      </div>
    </aside>
  );
}
