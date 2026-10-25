// Stockfish analysis in the browser: the rating, accuracy and JSON rules of chess_game_analyzer.py, ported.
// Evals are centipawns from White's point of view; a mate in N is ±(10000 − 10·N), as in _eval_to_cp.
(function () {
  const C = {
    WIN_CHANCES_K: 0.00368208, BEST_MAX_LOSS_CP: 5,
    WIN_DROP_INACCURACY: 0.10, WIN_DROP_MISTAKE: 0.20, WIN_DROP_BLUNDER: 0.30,
    MAX_EVAL_LOSS_FOR_ACCURACY: 1500,
    MATE_SCORE_CP: 10000, MATE_STEP_CP: 10, MATE_BAND_CP: 1000,
    MATE_INACCURACY_CP: 999, MATE_MISTAKE_CP: 700,
    MATE_CREATED: 'Checkmate is now unavoidable', MATE_LOST: 'Lost forced checkmate sequence', MATE_DELAYED: 'Not the best checkmate sequence',
    MATE_LINE_MAX_PLIES: 9, BEST_LINE_MAX_PLIES: 12,
  };
  const winningChances = (cp) => 2 / (1 + Math.exp(-C.WIN_CHANCES_K * cp)) - 1;

  // A UCI info line with a score → { cp (White POV), depth, pv, multipv (the line's rank, 1 without MultiPV) } ; null for other lines and bound-only scores
  function infoToScore(line, sideToMove) {
    if (!/^info\b/.test(line) || !/\sscore\s/.test(line) || /\s(lowerbound|upperbound)\b/.test(line)) return null;
    const cp = line.match(/\sscore cp (-?\d+)/), mate = line.match(/\sscore mate (-?\d+)/);
    let v;
    if (cp) v = +cp[1];
    else if (mate) { const n = +mate[1]; v = n > 0 ? C.MATE_SCORE_CP - C.MATE_STEP_CP * n : -(C.MATE_SCORE_CP - C.MATE_STEP_CP * Math.abs(n)); }
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
    const zone = C.MATE_SCORE_CP - C.MATE_BAND_CP;
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
    if (sign * bestEval >= C.MATE_SCORE_CP - C.MATE_BAND_CP) bestAfter += sign * C.MATE_STEP_CP;
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
    const n = Math.round((C.MATE_SCORE_CP - Math.abs(beforeEval)) / C.MATE_STEP_CP);
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
  const MOVE_DEFAULTS = { is_capture: false, is_check: false, material_balance: 0, fen_after: '', pv_line: [], alternative_moves: [], mate_advice: '', mate_line: '', search_depth: 0, search_depth_after: 0, search_lines: 1, best_line: [] };

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

  // the least time between a game analysis's requests to the tablebase
  const TB_GAP_MS = 1000;

  // the browser engines (Settings › Engine): the vendored lite one, or the full one the viewer downloaded (sf-full.js)
  const ENGINE_NAMES = { lite: 'Stockfish 19 lite (browser)', full: 'Stockfish 19 (browser)' };
  const ENGINE = { name: ENGINE_NAMES.lite, depth: null, time_limit: 3, lines: 1, threads: 1, hash_mb: 64 };
  // The engine settings a viewer can change (Settings → Engine), from the saved tweaks, kept in range; anything
  // missing or out of range falls back to the default. game: as ENGINE (written into the analysis JSON); own: the
  // search of the viewer's own moves. kind: the engine that runs ('lite' or 'full'), whatever the setting asks for.
  // depth null: no depth limit, the search runs for its time limit (a capped depth ends an endgame search in no time,
  // long before it finds a deep mate)
  const SEARCH_LIMITS = { depth: [16, 30], seconds: [1, 20] }, HASH_MB = [16, 32, 64, 128, 256];
  // the depth slider's stops: 16 to 30, then no limit
  const DEPTHS = [...Array(SEARCH_LIMITS.depth[1] - SEARCH_LIMITS.depth[0] + 1).keys()].map((i) => SEARCH_LIMITS.depth[0] + i).concat([null]);
  // the time limit slider's stops: whole seconds to 10, then every 2 s
  const SECONDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20];
  // own.lines: the lines (MultiPV) the viewer's own searches show; a game's analysis always searches one
  const LINES = [1, 2, 3, 4, 5];
  const OWN = { depth: null, time_limit: 5, lines: 1 };
  function engineSettings(t = {}, kind = 'lite') {
    const pick = (v, [lo, hi], step, dflt) => { const x = +v; return Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x / step) * step : dflt; };
    const pickDepth = (v, dflt) => (v === null ? null : pick(v, SEARCH_LIMITS.depth, 1, dflt));
    // a time limit in range snaps to the nearest stop
    const pickTime = (v, dflt) => { const x = +v; return Number.isFinite(x) && x >= SECONDS[0] && x <= SECONDS[SECONDS.length - 1] ? SECONDS.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a)) : dflt; };
    const name = ENGINE_NAMES[kind] || ENGINE.name;
    return {
      game: { ...ENGINE, name, depth: pickDepth(t.sfDepth, ENGINE.depth), time_limit: pickTime(t.sfTime, ENGINE.time_limit), hash_mb: HASH_MB.includes(+t.sfHash) ? +t.sfHash : ENGINE.hash_mb },
      own: { name, depth: pickDepth(t.sfOwnDepth, OWN.depth), time_limit: pickTime(t.sfOwnTime, OWN.time_limit), lines: LINES.includes(+t.sfLines) ? +t.sfLines : OWN.lines },
    };
  }
  // Rough seconds a game position takes: 1.3 s measured on a laptop at depth 22 / 3 s, each depth about 1.45 times
  // the one before, never more than the time limit (all of it with no depth limit). factor: this device's pace against
  // that laptop's (paceFactor)
  const secondsPerPosition = (g, factor = 1) => (g.depth == null ? g.time_limit : Math.min(g.time_limit, factor * 1.3 * Math.pow(1.45, g.depth - 22)));
  // A finished run's seconds per position → its device's factor for secondsPerPosition, within reason
  const paceFactor = (g, sec) => Math.min(4, Math.max(0.25, sec / secondsPerPosition(g)));
  // A running analysis's seconds per position: the estimate before it started, giving way to the run's own pace as it
  // times more positions (sumSec over n of them); a run's first few searches alone are a poor guide to the rest
  const PACE_PRIOR_WEIGHT = 3;
  const blendPace = (priorSec, sumSec, n) => (priorSec * PACE_PRIOR_WEIGHT + sumSec) / (PACE_PRIOR_WEIGHT + n);

  // Go deeper on one position (the + by the eval): each press adds 4 to the depth (none stays none) and doubles the
  // time, up to the sliders' caps. own: engineSettings().own; level: presses so far
  function deeperSearch(own, level) {
    return { depth: own.depth == null ? null : Math.min(SEARCH_LIMITS.depth[1], own.depth + 4 * level), time_limit: Math.min(SEARCH_LIMITS.seconds[1], own.time_limit * Math.pow(2, level)) };
  }
  const canGoDeeper = (own, level) => { const a = deeperSearch(own, level), b = deeperSearch(own, level + 1); return a.depth !== b.depth || a.time_limit !== b.time_limit; };

  // A line of uci moves from pos → its SANs, stopping at the first illegal move
  function sansOf(pos, ucis, max) {
    const out = [];
    for (const u of ucis.slice(0, max)) { const r = window.ChessCore.applyUci(pos, u); if (!r) break; out.push(r.san); pos = r.pos; }
    return out;
  }

  // Analyse every position of a game (ucis/sans from the start, or from startFen; the JSON then records it as start_fen), as analyze_game does: the search after a
  // move is also the search before the next one. Returns the --analyze JSON, or null when signal.aborted.
  // earlier: searches of the first positions from a run that stopped, to resume from; onSearched gets every
  // search so far after each new one, so a run that stops can be resumed
  // settings: the engine settings to search with and to record (engineSettings().game)
  // tablebase: Lichess's tablebase client (LichessCore.create(), Settings › Online data › Endgame tablebase on), else
  // null: a position of 7 pieces or fewer takes its certain answer instead of a search (tablebaseResult); an uncertain
  // one is searched. Its requests go tbGapMs apart (Lichess publishes no limit; a burst of them was answered 429). While
  // the client backs off after a 429 the positions are searched, then it is asked again; after a request that fails
  // otherwise (offline, an error, the timeout) the run asks no more. now, sleep: the clock, for tests
  async function runAnalysis({ engine, ucis, sans, headers, signal, onProgress, earlier = [], onSearched, settings = ENGINE, startFen = window.ChessCore.START_FEN, tablebase = null, tbGapMs = TB_GAP_MS, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    const CC = window.ChessCore, LC = window.LichessCore;
    const N = ucis.length, R = earlier.slice(0, N + 1);
    const fens = tablebase && LC ? positionFens(startFen, ucis) : null;
    let tbFailed = false, lastAsk = -Infinity;
    const pace = async () => { const wait = lastAsk + tbGapMs - now(); if (wait > 0) await sleep(wait); lastAsk = now(); };
    const backedOff = () => !!(tablebase.backedOff && tablebase.backedOff('tablebase'));
    onProgress(Math.max(0, R.length - 1), N);
    for (let k = R.length; k <= N; k++) {
      if (signal.aborted) return null;
      let r = null;
      if (fens && !tbFailed && !backedOff() && LC.pieceCount(fens[k]) <= LC.TB_MAX_PIECES) {
        const got = await tablebaseResult(tablebase, fens[k], pace);
        if (signal.aborted) return null;
        if (got.failed && !backedOff()) tbFailed = true;
        r = got.result;
      }
      if (!r) r = await engine.search({ moves: ucis.slice(0, k), fen: startFen, depth: settings.depth, movetimeMs: settings.time_limit * 1000, priority: 'game' }).promise;
      if (signal.aborted) return null;
      if (!r || r.cp == null) throw new Error('Stockfish stopped before the analysis finished');
      R.push(r);
      if (onSearched) onSearched(R.slice());
      if (k > 0) onProgress(k, N);
    }
    const start = CC.parseFen(startFen);
    let pos = start.pos;
    const moves = ucis.map((uci, i) => {
      const before = R[i], after = R[i + 1], isWhite = pos.turn === 'w', best = bestOf(before);
      const played = CC.applyUci(pos, uci);
      const san = played ? played.san : sans[i];
      const bestLine = sansOf(pos, before.pv, C.BEST_LINE_MAX_PLIES);
      // between two tablebase positions the outcome rates the move; a capture into the tablebase is rated as ever
      const rated = (before.tb && after.tb && rateByOutcome({ bestEval: before.cp, currentEval: after.cp, isWhite, before: before.tb, after: after.tb }))
        || rateMove({ bestEval: before.cp, currentEval: after.cp, isWhite, playedIsBest: uci === best, isCheckmate: san.endsWith('#') });
      const m = {
        ply: start.ply0 + i + 1, move_san: san, move_uci: uci, is_white_move: isWhite,
        eval_before: before.cp, eval_after: after.cp,
        best_move_san: best ? sansOf(pos, [best], 1)[0] || '-' : '-', best_move_uci: best || '-',
        best_eval: before.cp, eval_loss: rated.evalLoss, classification: rated.classification,
        is_capture: san.includes('x'), is_check: /[+#]$/.test(san),
        pv_line: played ? sansOf(played.pos, after.pv, 3) : [],
        mate_advice: rated.mateAdvice,
        mate_line: rated.mateAdvice === C.MATE_LOST || rated.mateAdvice === C.MATE_DELAYED ? mateLine(before.cp, bestLine) : '',
        search_depth: before.depth, search_depth_after: after.depth, search_lines: 1, best_line: bestLine,
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
    const CC = window.ChessCore;
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
  // A position's tablebase answer as a search result: { result, failed }. result: { cp, depth 0, pv (the DTZ mainline,
  // else the best move), tb: { category, dtz, dtm } } for a certain answer, else null (search it); failed: a request
  // didn't answer (the mainline's failing keeps the answer, its line just the best move). The run's signal is a plain
  // { aborted } (not an AbortSignal), checked after: a stopped run lets its last request finish (10 s at most).
  // pace(): waits for the run's next turn to ask; an answer the client already has doesn't wait
  async function tablebaseResult(client, fen, pace) {
    const LC = window.LichessCore, turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    const fresh = (cached) => !cached || cached(fen) === undefined;
    if (fresh(client.tablebaseCached)) await pace();
    const t = await client.tablebase(fen);
    if (!t) return { result: null, failed: true };
    const cp = LC.evalCp(t, turn);
    if (cp == null) return { result: null, failed: false };
    const first = t.moves.length ? t.moves[0].uci : null;
    if (first && fresh(client.mainlineCached)) await pace();
    const line = first ? await client.mainline(fen) : [];
    const pv = line && line.length ? line : first ? [first] : [];
    return { result: { cp, depth: 0, pv, best: pv[0] || null, nodes: null, timeMs: null, tb: { category: t.category, dtz: t.dtz, dtm: t.dtm } }, failed: !line };
  }

  window.AnalysisCore = { C, TB_GAP_MS, ENGINE, ENGINE_NAMES, SEARCH_LIMITS, DEPTHS, SECONDS, HASH_MB, LINES, engineSettings, secondsPerPosition, paceFactor, blendPace, deeperSearch, canGoDeeper, bestOf, winningChances, infoToScore, infoStats, rateMove, rateByOutcome, mateLine, positionFens, playerStats, buildAnalysisJson, runAnalysis };
})();
