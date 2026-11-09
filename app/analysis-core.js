// Stockfish analysis in the browser: the rating, accuracy and JSON rules of chess_game_analyzer.py, ported.
// Evals are centipawns from White's point of view; a mate in N is a mate score (ChessCore.mateCp), as in _eval_to_cp.
// The mate-score encoding and the win-chance curve and its thresholds are ChessCore's (it loads first), named here too.
(function () {
  const CC = window.ChessCore;
  const C = {
    WIN_CHANCES_K: CC.WIN_K, BEST_MAX_LOSS_CP: 5,
    WIN_DROP_INACCURACY: CC.WIN_DROP.inaccuracy, WIN_DROP_MISTAKE: CC.WIN_DROP.mistake, WIN_DROP_BLUNDER: CC.WIN_DROP.blunder,
    MAX_EVAL_LOSS_FOR_ACCURACY: 1500,
    MATE_SCORE_CP: CC.MATE_CP, MATE_STEP_CP: CC.MATE_STEP, MATE_BAND_CP: CC.MATE_CP - CC.MATE_MIN, // Python's: the width of the band of mate scores below MATE_SCORE_CP
    MATE_INACCURACY_CP: 999, MATE_MISTAKE_CP: 700,
    MATE_CREATED: 'Checkmate is now unavoidable', MATE_LOST: 'Lost forced checkmate sequence', MATE_DELAYED: 'Not the best checkmate sequence',
    MATE_LINE_MAX_PLIES: 9, BEST_LINE_MAX_PLIES: 12,
  };
  const winningChances = CC.winChance;

  // A UCI info line with a score → { cp (White POV), depth, pv, multipv (the line's rank, 1 without MultiPV) } ; null for other lines and bound-only scores
  function infoToScore(line, sideToMove) {
    if (!/^info\b/.test(line) || !/\sscore\s/.test(line) || /\s(lowerbound|upperbound)\b/.test(line)) return null;
    const cp = line.match(/\sscore cp (-?\d+)/), mate = line.match(/\sscore mate (-?\d+)/);
    let v;
    if (cp) v = +cp[1];
    else if (mate) v = CC.mateCp(+mate[1]);
    else return null;
    const depth = line.match(/\sdepth (\d+)/), pv = line.match(/\spv (.+)$/), nodes = line.match(/\snodes (\d+)/), time = line.match(/\stime (\d+)/), k = line.match(/\smultipv (\d+)/);
    return { cp: sideToMove === 'w' ? v : -v, depth: depth ? +depth[1] : 0, pv: pv ? pv[1].trim().split(/\s+/) : [], nodes: nodes ? +nodes[1] : null, timeMs: time ? +time[1] : null, multipv: k ? +k[1] : 1 };
  }

  // How far a search has got, from any info line with a depth (bound-only lines included): depth, nodes, time
  function infoStats(line) {
    const depth = /^info\b/.test(line) && line.match(/\sdepth (\d+)/);
    if (!depth) return null;
    const nodes = line.match(/\snodes (\d+)/), time = line.match(/\stime (\d+)/);
    return { depth: +depth[1], nodes: nodes ? +nodes[1] : null, timeMs: time ? +time[1] : null };
  }

  function classifyMove(evalLoss, winDrop) {
    if (evalLoss < C.BEST_MAX_LOSS_CP) return 'best';
    if (winDrop < C.WIN_DROP_INACCURACY) return '';
    if (winDrop < C.WIN_DROP_MISTAKE) return 'inaccuracy';
    if (winDrop < C.WIN_DROP_BLUNDER) return 'mistake';
    return 'blunder';
  }

  // Lichess's mate rules from the mover's point of view → [classification or null, advice]
  function mateAdvice(bestEval, currentEval, isWhite) {
    const sign = isWhite ? 1 : -1, before = sign * bestEval, after = sign * currentEval;
    const zone = CC.MATE_MIN;
    const hadMate = before >= zone, hasMate = after >= zone, wasMated = before <= -zone, isMated = after <= -zone;
    if (hadMate && !hasMate) return [after > C.MATE_INACCURACY_CP ? 'inaccuracy' : after > C.MATE_MISTAKE_CP ? 'mistake' : 'blunder', C.MATE_LOST];
    if (isMated && !(hadMate || wasMated)) return [before < -C.MATE_INACCURACY_CP ? 'inaccuracy' : before < -C.MATE_MISTAKE_CP ? 'mistake' : 'blunder', C.MATE_CREATED];
    if (hadMate && hasMate && after < before + C.MATE_STEP_CP) return ['', C.MATE_DELAYED];
    return [null, ''];
  }

  // One move: bestEval is the search before it, currentEval the search after it (analyze_game, steps D–E)
  function rateMove({ bestEval, currentEval, isWhite, playedIsBest, isCheckmate }) {
    const sign = isWhite ? 1 : -1;
    let bestAfter = bestEval;
    if (sign * bestEval >= CC.MATE_MIN) bestAfter += sign * C.MATE_STEP_CP;
    let raw = Math.max(0, isWhite ? bestAfter - currentEval : currentEval - bestAfter);
    if (playedIsBest) raw = 0;
    const evalLoss = Math.min(raw, C.MAX_EVAL_LOSS_FOR_ACCURACY);
    const winDrop = sign * (winningChances(bestEval) - winningChances(currentEval));
    let classification = classifyMove(evalLoss, Math.max(0, winDrop)), advice = '';
    if (!playedIsBest && !isCheckmate) {
      const [cls, adv] = mateAdvice(bestEval, currentEval, isWhite);
      if (cls !== null) classification = cls;
      advice = adv;
    }
    return { evalLoss, classification, mateAdvice: advice };
  }

  // One move between two tablebase positions (before, after: their { category }, each for its side to move), rated by
  // what it does to the outcome for the mover: keeping a win, a draw or a loss loses nothing, however slow the win (as on
  // Lichess); win → draw (a cursed win is a draw), draw → loss or win → loss is a blunder, its eval loss as rateMove's
  const OUTCOME_RANK = { win: 2, draw: 1, loss: 0 };
  function rateByOutcome({ bestEval, currentEval, isWhite, before, after }) {
    const LC = window.LichessCore;
    const had = OUTCOME_RANK[LC.outcome(before.category)], has = OUTCOME_RANK[LC.outcome(LC.flip(after.category))];
    if (had == null || has == null) return null;
    if (has >= had) return { evalLoss: 0, classification: 'best', mateAdvice: '' };
    const raw = Math.max(0, isWhite ? bestEval - currentEval : currentEval - bestEval);
    return { evalLoss: Math.min(raw, C.MAX_EVAL_LOSS_FOR_ACCURACY), classification: 'blunder', mateAdvice: '' };
  }

  // "Mate in N: …" for a lost or delayed mate, from the line the mover had (pvSans starts with the mover's move)
  function mateLine(beforeEval, pvSans) {
    const n = CC.mateIn(beforeEval);
    let s = `Mate in ${n}: ${pvSans.slice(0, Math.min(2 * n - 1, C.MATE_LINE_MAX_PLIES)).join(' ')}`;
    if (2 * n - 1 > C.MATE_LINE_MAX_PLIES) s += ' ...';
    return s;
  }

  // _calculate_player_stats
  function playerStats(moves) {
    if (!moves.length) return { total_moves: 0, accuracy: 0, avg_centipawn_loss: 0, best_moves: 0, inaccuracies: 0, mistakes: 0, blunders: 0 };
    const avg = moves.reduce((s, m) => s + m.eval_loss, 0) / moves.length;
    const n = (c) => moves.filter((m) => m.classification === c).length;
    return {
      total_moves: moves.length, avg_centipawn_loss: avg,
      accuracy: avg > 0 ? Math.max(0, 100 * Math.exp(-0.005 * avg)) : 100,
      best_moves: n('best'), inaccuracies: n('inaccuracy'), mistakes: n('mistake'), blunders: n('blunder'),
    };
  }

  const MISSING_OPENING = ['', '?', 'Unknown'];
  const MOVE_DEFAULTS = { is_capture: false, is_check: false, material_balance: 0, fen_after: '', pv_line: [], alternative_moves: [], engine_lines: [], mate_advice: '', mate_line: '', search_depth: 0, search_depth_after: 0, search_lines: 1, best_line: [] };

  // The JSON run_animator.py --analyze writes. opening: the book's {eco, name}, used when the PGN names none.
  function buildAnalysisJson({ headers, moves, opening, engine, startFen }) {
    const H = headers || {};
    const hasOpening = !MISSING_OPENING.includes(H.Opening || '');
    const elo = (v) => (/^\d+$/.test(v || '') ? v : '');
    const full = moves.map((m) => ({ ...MOVE_DEFAULTS, ...m }));
    return {
      white: H.White || 'Unknown', black: H.Black || 'Unknown',
      white_elo: elo(H.WhiteElo), black_elo: elo(H.BlackElo),
      event: H.Event || 'Unknown', site: H.Site || 'Unknown', date: H.Date || '????.??.??', round_num: H.Round || '?', result: H.Result || '*',
      opening_name: hasOpening ? H.Opening : opening ? opening.name : '',
      opening_eco: hasOpening ? H.ECO || '' : opening ? opening.eco : '',
      moves: full,
      white_stats: { accuracy: playerStats(full.filter((m) => m.is_white_move)).accuracy },
      black_stats: { accuracy: playerStats(full.filter((m) => !m.is_white_move)).accuracy },
      engine,
      ...(startFen && startFen !== window.ChessCore.START_FEN ? { start_fen: startFen } : {}),
    };
  }

  // A search's best move: the first move of the line it reports (as Python's pv[0]); a search cut short can
  // end on a bestmove token that isn't the start of its last complete line
  const bestOf = (r) => (r && r.pv && r.pv[0]) || (r && r.best) || null;

  // A tablebase win or loss with no distance to mate (6 and 7 pieces): its ±9990 says won, not mate in 1, so it is never
  // weighed against a search's eval
  const tbWonOnly = (r) => !!(r && r.tb && !r.tb.dtm && r.cp !== 0 && Math.abs(r.cp) < C.MATE_SCORE_CP);
  // the eval a move's rating takes for a position: a search of it where one was made beside the tablebase's answer
  const rateCp = (r) => (r.sf ? r.sf.cp : r.cp);

  // the least time between a game analysis's requests to the tablebase: Lichess publishes no limit for it, only one
  // request at a time and a minute's wait after a 429 (lichess.org/api, rate limiting); 120 requests 4, 2 and 1 s apart
  // and 80 back to back all answered (2026-11-01)
  const TB_GAP_MS = 1000;

  // the browser engines (the Analysis panel's engine drop-down): the vendored lite one, or the full one the viewer downloaded (sf-full.js);
  // asm: the vendored asm.js build, the only one a browser without WebAssembly SIMD runs
  const ENGINE_NAMES = { lite: 'Stockfish 19 lite (browser)', full: 'Stockfish 19 (browser)', asm: 'Stockfish 19 asm.js (browser)' };
  const ENGINE = { name: ENGINE_NAMES.lite, depth: null, time_limit: 3, lines: 1, threads: 1, hash_mb: 64 };
  // The engine settings a viewer can change (Settings → Engine), from the saved tweaks, kept in range; anything
  // missing or out of range falls back to the default. game: as ENGINE (written into the analysis JSON); own: the
  // search of the viewer's own moves. kind: the engine that runs ('lite', 'full' or 'asm'), whatever the setting asks for.
  // depth null: no depth limit, the search runs for its time limit (a capped depth ends an endgame search in no time,
  // long before it finds a deep mate)
  const SEARCH_LIMITS = { depth: [16, 30], seconds: [1, 60] }, HASH_MB = [16, 32, 64, 128, 256, 512];
  // the depth slider's stops: 16 to 30, then no limit
  const DEPTHS = [...Array(SEARCH_LIMITS.depth[1] - SEARCH_LIMITS.depth[0] + 1).keys()].map((i) => SEARCH_LIMITS.depth[0] + i).concat([null]);
  // the time limit slider's stops: whole seconds to 10, every 2 s to 20, then 25, 30 and 60
  const SECONDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 25, 30, 60];
  // own.lines: the lines (MultiPV) the viewer's own searches show; a game's analysis always searches one
  const LINES = [1, 2, 3, 4, 5];
  const OWN = { depth: null, time_limit: 5, lines: 1 };
  // Threads (one setting for the game analysis, one for the live searches): 1 to one less than the browser's cores, at most 8; by default half of
  // them, at most 4, so a search leaves the computer room (decided 2026-10-28)
  const threadChoices = (cores) => [...Array(Math.max(1, Math.min((cores | 0) - 1, 8))).keys()].map((i) => i + 1);
  const defaultThreads = (cores) => Math.max(1, Math.min(4, Math.floor((cores | 0) / 2)));
  // threading: { on, cores } (SFEngine.threadSupport): off, every search runs one thread
  // The hash sizes this device is offered: above BIG_HASH_MB only where it isn't touch only (a phone or tablet: a coarse
  // pointer and no fine one, and a tab there gets little memory; a touchscreen PC has a touchpad or mouse too, and
  // headless Firefox reports no pointer at all) and, where the browser says (Chromium's navigator.deviceMemory, rounded,
  // at most 8), with 4 GB of memory or more. A size the engine still can't get falls back to 64 MB (SFEngine's onHashFail)
  const BIG_HASH_MB = 128;
  const hashChoices = ({ touchOnly = false, memoryGB } = {}) => (!touchOnly && !(memoryGB < 4) ? HASH_MB : HASH_MB.filter((mb) => mb <= BIG_HASH_MB));
  // hashes: hashChoices() here; a stored size not among them gets the default
  function engineSettings(t = {}, kind = 'lite', threading = { on: false, cores: 1 }, hashes = HASH_MB) {
    const pick = (v, [lo, hi], step, dflt) => { const x = +v; return Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x / step) * step : dflt; };
    const pickDepth = (v, dflt) => (v === null ? null : pick(v, SEARCH_LIMITS.depth, 1, dflt));
    // a time limit in range snaps to the nearest stop
    const pickTime = (v, dflt) => { const x = +v; return Number.isFinite(x) && x >= SECONDS[0] && x <= SECONDS[SECONDS.length - 1] ? SECONDS.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a)) : dflt; };
    const name = ENGINE_NAMES[kind] || ENGINE.name;
    const threadsOf = (v) => (!threading || !threading.on ? 1 : threadChoices(threading.cores).includes(+v) ? +v : defaultThreads(threading.cores));
    const hashOf = (v) => (hashes.includes(+v) ? +v : ENGINE.hash_mb);
    // the game analysis (its dialog: sfDepth, sfTime, sfGameThreads, sfGameHash) and the live searches (the Analysis
    // panel's ☰: your moves, the free board, Go deeper) each have their own threads and hash table
    return {
      game: { ...ENGINE, name, lines: LINES.includes(+t.sfGameLines) ? +t.sfGameLines : ENGINE.lines, threads: threadsOf(t.sfGameThreads), depth: pickDepth(t.sfDepth, ENGINE.depth), time_limit: pickTime(t.sfTime, ENGINE.time_limit), hash_mb: hashOf(t.sfGameHash) },
      own: { name, depth: pickDepth(t.sfOwnDepth, OWN.depth), time_limit: pickTime(t.sfOwnTime, OWN.time_limit), lines: LINES.includes(+t.sfLines) ? +t.sfLines : OWN.lines, threads: threadsOf(t.sfThreads), hash_mb: hashOf(t.sfHash) },
    };
  }
  // Rough seconds a game position takes: 1.3 s measured on a laptop at depth 22 / 3 s, each depth about 1.45 times
  // the one before, never more than the time limit (all of it with no depth limit). factor: this device's pace against
  // that laptop's (paceFactor)
  // (at a set depth, 3 lines took about 4.5 times as long as 1 in chess-animator's analyzer: lines ^ 1.37)
  const secondsPerPosition = (g, factor = 1) => (g.depth == null ? g.time_limit : Math.min(g.time_limit, factor * 1.3 * Math.pow(g.lines || 1, 1.37) * Math.pow(1.45, g.depth - 22)));
  // Each engine's factor before this device has timed a run with it, against the lite engine's model: the asm.js build
  // took 8.3 times as long as lite-single to depth 16 on three positions, Full's single-thread build 1.3 times
  // (Chromium on a laptop, 2026-11-09)
  const PACE_START = { [ENGINE_NAMES.asm]: 8, [ENGINE_NAMES.full]: 1.3 };
  const paceStart = (name) => PACE_START[name] || 1;
  // A finished run's seconds per position → its device's factor for secondsPerPosition, within reason (around the
  // engine's starting factor: g.name)
  const paceFactor = (g, sec) => { const k = paceStart(g.name); return Math.min(4 * k, Math.max(0.25 * k, sec / secondsPerPosition(g))); };
  // A running analysis's seconds per position: the estimate before it started, giving way to the run's own pace as it
  // times more positions (sumSec over n of them); a run's first few searches alone are a poor guide to the rest
  const PACE_PRIOR_WEIGHT = 3;
  const blendPace = (priorSec, sumSec, n) => (priorSec * PACE_PRIOR_WEIGHT + sumSec) / (PACE_PRIOR_WEIGHT + n);

  // Go deeper on one position (the + by the eval): each press adds 4 to the depth (none stays none) and doubles the
  // time, up to the sliders' caps. own: engineSettings().own; level: presses so far
  function deeperSearch(own, level) {
    return { depth: own.depth == null ? null : Math.min(SEARCH_LIMITS.depth[1], own.depth + 4 * level), time_limit: Math.min(SEARCH_LIMITS.seconds[1], own.time_limit * Math.pow(2, level)) };
  }
  // The cloud depth that counts as deep enough for a search of this depth limit (null: none) by this engine (its name,
  // engineSettings().own.name): Prefer cloud doesn't search a position the cloud has this deep, and Go deeper isn't
  // offered over cloud answers this deep. With no limit, past what the engine reaches in the browser: 35 for lite and full,
  // 22 for asm.js (also its cap), which reached 22 in a minute on a fast laptop and 19 on a Samsung SM-T510 (2026-11-01)
  const CLOUD_ENOUGH = 35, CLOUD_ENOUGH_ASM = 22;
  const cloudEnough = (depth, name) => (name === ENGINE_NAMES.asm ? Math.min(depth == null ? CLOUD_ENOUGH_ASM : depth, CLOUD_ENOUGH_ASM) : depth == null ? CLOUD_ENOUGH : depth);
  const canGoDeeper = (own, level) => { const a = deeperSearch(own, level), b = deeperSearch(own, level + 1); return a.depth !== b.depth || a.time_limit !== b.time_limit; };

  // chess-animator's PLAYABLE_THRESHOLD: a line after the first is an alternative when within this many cp of the best
  const PLAYABLE_CP = 50;
  // Every line a search returned (line 1 alone for a search of one line or a tablebase's answer) from pos, best first, as
  // chess_game_analyzer.py's engine_lines: { move (SAN), eval (cp, White's side), depth, line (SANs from move on, 12 plies at most) }
  function engineLines(pos, r) {
    const ls = r.lines && r.lines.length ? r.lines : [{ cp: r.cp, depth: r.depth, pv: r.pv }];
    return ls.map((l) => ({ l, line: sansOf(pos, l.pv || [], C.BEST_LINE_MAX_PLIES) })).filter((x) => x.line.length)
      .map(({ l, line }) => ({ move: line[0], eval: l.cp, depth: l.depth, line }));
  }
  // The playable alternatives to the move played: [[SAN, cp]] of the lines after the first, within PLAYABLE_CP of the best
  const alternativesOf = (lines, played, bestCp) => lines.slice(1).filter((l) => l.move !== played && Math.abs(bestCp - l.eval) <= PLAYABLE_CP).map((l) => [l.move, l.eval]);

  // A line of uci moves from pos → its SANs, stopping at the first illegal move
  function sansOf(pos, ucis, max) {
    const out = [];
    for (const u of ucis.slice(0, max)) { const r = window.ChessCore.applyUci(pos, u); if (!r) break; out.push(r.san); pos = r.pos; }
    return out;
  }

  // Analyse every position of a game (ucis/sans from the start, or from startFen; the JSON then records it as start_fen), as analyze_game does: the search after a
  // move is also the search before the next one. Returns the --analyze JSON, or null when signal.aborted.
  // signal: an AbortSignal (or any { aborted }); an abort through its 'abort' event also cancels the running search
  // earlier: searches of the first positions from a run that stopped, to resume from; onSearched gets every
  // search so far after each new one, so a run that stops can be resumed
  // settings: the engine settings to search with and to record (engineSettings().game)
  // tablebase: Lichess's tablebase client (LichessCore.create(), Settings › Online data › Endgame tablebase on), else
  // null: a position of 7 pieces or fewer takes its certain answer instead of a search (tablebaseResult); an uncertain
  // one is searched. Its requests go tbGapMs apart (TB_GAP_MS). While the client backs off after a 429 the positions
  // are searched, then it is asked again; after a request that fails otherwise (offline, an error, the timeout) the run
  // asks no more. tablebaseOn(): whether the setting is still on (turned off, the run asks no more). A position the
  // tablebase calls won without a distance to mate (tbWonOnly) next to a searched one is searched too (kept as its sf),
  // so the move between them is rated on two searches. onSearched(R, { searches, tbMs, tbAsks }): the engine searches made,
  // and the time spent on the tablebase and its requests since the last call, for the run's pace. now, sleep: the clock, for tests
  async function runAnalysis({ engine, ucis, sans, headers, signal, onProgress, onTablebaseLost, earlier = [], onSearched, settings = ENGINE, startFen = window.ChessCore.START_FEN, tablebase = null, tablebaseOn = () => true, tbGapMs = TB_GAP_MS, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    const LC = window.LichessCore;
    const N = ucis.length, R = earlier.slice(0, N + 1);
    const fens = tablebase && LC ? positionFens(startFen, ucis) : null;
    let tbFailed = false, lastAsk = -Infinity;
    const pace = async () => { const wait = lastAsk + tbGapMs - now(); if (wait > 0) await sleep(wait); lastAsk = now(); };
    const backedOff = () => !!(tablebase.backedOff && tablebase.backedOff('tablebase'));
    let searches = 0, tbMs = 0, tbAsks = 0;
    const search = async (k) => {
      const h = engine.search({ moves: ucis.slice(0, k), fen: startFen, depth: settings.depth, movetimeMs: settings.time_limit * 1000, threads: settings.threads, lines: settings.lines || 1, priority: 'game' });
      // an abort (Stop, a files change) cancels the running search: SFEngine never interrupts one, so every later
      // search (the live one, Stockfish's reply in a game) would wait out its time limit behind it
      const off = () => h.cancel();
      if (signal.addEventListener) signal.addEventListener('abort', off);
      let r;
      try { r = await h.promise; } finally { if (signal.removeEventListener) signal.removeEventListener('abort', off); }
      searches++;
      if (!signal.aborted && (!r || r.cp == null)) throw new Error('Stockfish stopped before the analysis finished');
      return r;
    };
    onProgress(Math.max(0, R.length - 1), N);
    for (let k = R.length; k <= N; k++) {
      if (signal.aborted) return null;
      let r = null;
      if (fens && !tbFailed && tablebaseOn() && !backedOff() && LC.pieceCount(fens[k]) <= LC.TB_MAX_PIECES) {
        const t0 = now();
        const got = await tablebaseResult(tablebase, fens[k], pace, tablebaseOn);
        tbMs += now() - t0; tbAsks++;
        if (signal.aborted) return null;
        // a failed request (not a back-off, which ends): the rest is searched, and the page is told (onTablebaseLost), as
        // only the Analysis panel's header would otherwise tell the searched positions from the tablebase's
        if (got.failed && !backedOff()) { tbFailed = true; if (onTablebaseLost) onTablebaseLost(); }
        r = got.result;
      }
      if (!r) r = await search(k);
      if (signal.aborted) return null;
      // a move between a searched position and a tablebase win with no distance to mate: that one searched too
      if (k > 0 && !r.tb !== !R[k - 1].tb) {
        const j = tbWonOnly(r) ? k : tbWonOnly(R[k - 1]) && !R[k - 1].sf ? k - 1 : -1;
        if (j >= 0) {
          const s = await search(j);
          if (signal.aborted) return null;
          const sf = { cp: s.cp, depth: s.depth };
          if (j === k) r = { ...r, sf }; else R[k - 1] = { ...R[k - 1], sf };
        }
      }
      R.push(r);
      if (onSearched) onSearched(R.slice(), { searches, tbMs, tbAsks });
      searches = 0; tbMs = 0; tbAsks = 0;
      if (k > 0) onProgress(k, N);
    }
    const start = CC.parseFen(startFen);
    let pos = start.pos;
    const moves = ucis.map((uci, i) => {
      const before = R[i], after = R[i + 1], isWhite = pos.turn === 'w', best = bestOf(before);
      const played = CC.applyUci(pos, uci);
      const san = played ? played.san : sans[i];
      const bestLine = sansOf(pos, before.pv, C.BEST_LINE_MAX_PLIES);
      const engLines = engineLines(pos, before);
      // between two tablebase positions the outcome rates the move; a capture into the tablebase is rated as ever, on
      // searches of both where the tablebase only says won
      const rated = (before.tb && after.tb && rateByOutcome({ bestEval: before.cp, currentEval: after.cp, isWhite, before: before.tb, after: after.tb }))
        || rateMove({ bestEval: rateCp(before), currentEval: rateCp(after), isWhite, playedIsBest: uci === best, isCheckmate: san.endsWith('#') });
      const m = {
        ply: start.ply0 + i + 1, move_san: san, move_uci: uci, is_white_move: isWhite,
        eval_before: before.cp, eval_after: after.cp,
        best_move_san: best ? sansOf(pos, [best], 1)[0] || '-' : '-', best_move_uci: best || '-',
        best_eval: before.cp, eval_loss: rated.evalLoss, classification: rated.classification,
        is_capture: san.includes('x'), is_check: /[+#]$/.test(san),
        pv_line: played ? sansOf(played.pos, after.pv, 3) : [],
        mate_advice: rated.mateAdvice,
        mate_line: rated.mateAdvice === C.MATE_LOST || rated.mateAdvice === C.MATE_DELAYED ? mateLine(rateCp(before), bestLine) : '',
        search_depth: before.depth, search_depth_after: after.depth, search_lines: engLines.length || 1, best_line: bestLine,
        engine_lines: engLines, alternative_moves: alternativesOf(engLines, san, before.cp),
        // what the search of the position after the move actually did (the Python video ignores these)
        search_maxdepth_after: after.maxDepth == null ? after.depth : after.maxDepth, search_time_after_ms: after.timeMs, search_nodes_after: after.nodes,
        // the positions the tablebase answered (each for its side to move), their search depths 0
        ...(before.tb ? { tb_before: before.tb } : {}), ...(after.tb ? { tb_after: after.tb } : {}),
      };
      if (played) pos = played.pos;
      return m;
    });
    const engineBlock = { ...settings, ...(R.some((r) => r.tb) ? { tablebase: true } : {}) };
    return buildAnalysisJson({ headers, moves, opening: window.Openings ? window.Openings.book().identify(ucis, startFen) : null, engine: engineBlock, startFen });
  }

  // The full FEN of each position of a game (castling, en passant and the fifty-move count, which the tablebase needs)
  function positionFens(startFen, ucis) {
    let pos = CC.parseFen(startFen).pos;
    const sans = [], out = [CC.fenAfter(startFen, [], pos)];
    for (const u of ucis) {
      const r = CC.applyUci(pos, u);
      if (!r) break;
      sans.push(r.san); pos = r.pos;
      out.push(CC.fenAfter(startFen, sans, pos));
    }
    return out;
  }
  // A position's tablebase answer as a search result: { result, failed }. result: { cp, depth 0, pv (the best move:
  // one request a position, so no line), tb: { category, dtz, dtm } } for a certain answer, else null (search it);
  // failed: the request didn't answer. The run's signal is a plain { aborted } (not an AbortSignal), checked after: a
  // stopped run lets its last request finish (10 s at most). pace(): waits for the run's next turn to ask; an answer
  // the client already has doesn't wait. on(): the setting, checked again after the wait (off: searched, not asked)
  async function tablebaseResult(client, fen, pace, on = () => true) {
    const LC = window.LichessCore, turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    if (!client.tablebaseCached || client.tablebaseCached(fen) === undefined) await pace();
    if (!on()) return { result: null, failed: false };
    const t = await client.tablebase(fen);
    if (!t) return { result: null, failed: true };
    const cp = LC.evalCp(t, turn);
    if (cp == null) return { result: null, failed: false };
    const best = t.moves.length ? t.moves[0].uci : null;
    return { result: { cp, depth: 0, pv: best ? [best] : [], best, nodes: null, timeMs: null, tb: { category: t.category, dtz: t.dtz, dtm: t.dtm } }, failed: false };
  }

  window.AnalysisCore = { C, paceStart, TB_GAP_MS, ENGINE, ENGINE_NAMES, SEARCH_LIMITS, DEPTHS, SECONDS, HASH_MB, hashChoices, LINES, threadChoices, defaultThreads, engineSettings, secondsPerPosition, paceFactor, blendPace, deeperSearch, canGoDeeper, cloudEnough, bestOf, winningChances, infoToScore, infoStats, rateMove, rateByOutcome, tbWonOnly, mateLine, positionFens, playerStats, engineLines, alternativesOf, buildAnalysisJson, runAnalysis };
})();
