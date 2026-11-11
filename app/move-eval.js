// The evals of a move for the Analysis panel: the positions before and after it, searched by Stockfish and asked of
// Lichess's cloud, with the session's finished searches and its presses of Go deeper. No React: stockfish.jsx's
// useMoveEval subscribes to a watch; tests script the engine and the cloud.
//
// create({ cloud, debounceMs }): one per page (its caches are shared by the replay and the free board). cloud: a
// LichessCore client (cloudCached(fen, lines): undefined until asked; cloudEval(fen, lines, { signal })), or null.
//
// A request: { engine, before, after, settings, fen, stored, cloud, off, auto }
//   engine: get() resolves to an SFEngine (search(), failed()); null only with off
//   before, after: the UCI moves from the start (or from fen) to the positions before and after the move; before the
//     first move they are the same list. No after: nothing is asked
//   settings: the search settings (AnalysisCore.engineSettings().own: depth, time_limit, lines, name). lines are
//     searched for after only; name keys the results, so lite and full ones never mix
//   fen: the game's start FEN, omitted for the standard start
//   stored: a loaded analysis's result for after (with before the same moves), standing in for the first search, which
//     then never runs: only a press of Go deeper (or auto) searches. Results from it carry stored: true; its src names
//     the evals it comes from, so presses on one analysis's move don't carry over to another's (or the PGN's)
//   cloud: { on, prefer } (Settings › Online › Lichess cloud evaluation). With stored, only once Go deeper is pressed
//     or auto ran. Each position asks the cloud (after debounceMs, at once when cached) while the local
//     search runs; whichever comes first shows, and a finished local search replaces the cloud's only when deeper.
//     prefer: a position the cloud has as deep as the local depth limit (AnalysisCore.cloudEnough) isn't searched
//     locally. A miss falls back silently
//   off: no live Stockfish searches (the Analysis panel's switch off, or a game analysis running): nothing is searched
//     locally and Go deeper isn't offered, but the cloud is still asked and shown, and finished searches still show; a
//     stored result shows with the deepest Go deeper level whose local searches finished
//   auto: with stored, the position is searched at the settings without a press (the Stockfish switch searching every move
//     of a loaded analysis), and its search replaces the stored result from its first depth, as a search of the
//     viewer's own move shows, even where it ends shallower: depth, time and lines are the live settings' (decided
//     2026-11-11). Go deeper's presses go on from it. Off again, the stored result shows unless that search went deeper
//
// watch(request, onChange) starts the cloud asks and the searches; onChange() runs after each change (never during
// watch() itself). It returns { get, stop }:
//   get(): { before, after, cloud, pending, progress, deeper, deeperTo, failed, level }
//     before, after: the result to show for each position (a search's, partial: true while it runs; the cloud's, source
//       'cloud'; the stored one); null until there is one
//     pending: local searches are still to finish; progress: 0–1 through them (each one's depth or time limit,
//       whichever it nears first)
//     deeper(): searches both positions again, deeper (null when the search can't go further or hasn't finished); it
//       counts for that position only, and a deeper search shows the last result until it passes that result's depth.
//       deeperTo: the settings it would search at
//     failed: why a Go deeper search didn't run (the engine wouldn't start, or stopped); the press is then undone, so
//       deeper() comes back to try again
//     level: the Go deeper level shown (0: the first search, or the stored result; with off, the deepest finished)
//   stop(): cancels the searches, the timers and the cloud requests; nothing changes after it
// keyOf(request): '' for a request that asks nothing, else a string that changes when a new watch is needed
// positionKey(request): the key Go deeper's presses are counted under
(function () {
  const EMPTY = { before: null, after: null, cloud: {}, pending: false, progress: 0 };
  const WHICH = ['after', 'before'];

  function create({ cloud = null, debounceMs = 300 } = {}) {
    const A = window.AnalysisCore, START = window.ChessCore.START_FEN;
    const finishedSearches = new Map(); // by settings and move list, for the session
    const presses = new Map(); // of Go deeper, by position (positionKey), for the session
    const autoRan = new Set(); // the positions (positionKey) auto has searched, for the session

    // what a request's keys and cached results are worked out from
    function plan({ before, after, settings: own, fen, stored }) {
      // a search of several lines (Analysis › ☰ › Lines) is cached apart from one of one line
      const keyOf = (s, moves) => (own.name ? own.name + '|' : '') + (fen && fen !== START ? fen + '|' : '') + `${s.depth}/${s.movetimeMs}${s.lines > 1 ? '/' + s.lines : ''}:` + moves.join(' ');
      const toSearch = (o, lines = own.lines || 1) => ({ depth: o.depth, movetimeMs: o.time_limit * 1000, lines });
      const base = keyOf(toSearch(own), after) + (stored ? '|' + stored.src : '');
      // only after's lines are shown, so before (what the move is rated against) searches one line, as deep as it can;
      // the start position is both, and searches after's lines
      const linesOf = (which) => (which === 'after' || before.join(' ') === after.join(' ') ? own.lines || 1 : 1);
      const moves = { after, before };
      const keyAt = (lv, which) => keyOf(toSearch(A.deeperSearch(own, lv), linesOf(which)), moves[which]);
      // a finished search at level lv: its own, or for a position searched as one line (before), a search of several
      // lines of the same position (the move before's after, stepping on through a game), whose line 1 is the one
      // line's answer
      const cachedAt = (lv, which) => finishedSearches.get(keyAt(lv, which)) || (linesOf(which) === 1 && (own.lines || 1) > 1 && finishedSearches.get(keyOf(toSearch(A.deeperSearch(own, lv)), moves[which]))) || null;
      const finished = (lv) => WHICH.every((w) => cachedAt(lv, w));
      return { toSearch, base, linesOf, moves, keyAt, cachedAt, finished };
    }

    const positionKey = (req) => (req.after ? plan(req).base : '');
    const keyOf = (req) => (req.after ? plan(req).base + (req.cloud && req.cloud.on ? (req.cloud.prefer ? '|cloud+' : '|cloud') : '') + (req.off ? '|off' : '') + (req.auto ? '|auto' : '') : '');

    function watch(req, onChange) {
      if (!req.after) return { get: () => ({ ...EMPTY, deeper: null, deeperTo: null, failed: null }), stop() {} };
      const { settings: own, fen, stored, engine, off } = req, p = plan(req);
      // auto asks the cloud as a press does, and that stays (with the cloud's answers) once the switch goes off
      if (req.auto && stored) autoRan.add(p.base);
      // the Stockfish switch on: the live search is what shows, shallower than the stored result or not
      let liveFirst = !!(req.auto && stored && !off);
      let st = EMPTY, level = 0, search = null, failed = null, stopped = false, stopRun = () => {};

      // one level's cloud asks and searches; returns what cancels them
      function run() {
        const pressed = presses.get(p.base) || 0;
        // off: the deepest level pressed whose searches both finished (the stored result at 0)
        level = pressed;
        if (off) while (level > 0 && !p.finished(level)) level--;
        search = p.toSearch(A.deeperSearch(own, level));
        // a stored result asks the cloud once Go deeper is pressed (or auto ran), whatever the local searches got to (off keeps it asked)
        const cloudOn = !!(req.cloud && req.cloud.on && cloud && (!stored || pressed > 0 || autoRan.has(p.base))), prefer = cloudOn && !!req.cloud.prefer;
        const lv = level, lines = p.linesOf, moves = p.moves;
        let live = true;
        const change = (fn) => { if (!live) return; st = fn(st); onChange(); };
        // the cloud's answers, as promises (null: a miss); a cached one shows at once
        const ctl = new AbortController(), timers = [], asked = {};
        const fenOf = (m) => { const f = A.positionFens(fen || START, m); return f.length === m.length + 1 ? f[m.length] : null; };
        const cloudHit = {};
        if (cloudOn) for (const which of WHICH) {
          const f = fenOf(moves[which]), n = lines(which), hit = f ? cloud.cloudCached(f, n) : null;
          if (hit !== undefined) { cloudHit[which] = hit; asked[which] = Promise.resolve(hit); continue; }
          asked[which] = new Promise((res) => { timers.push(setTimeout(() => cloud.cloudEval(f, n, { signal: ctl.signal }).then(res), debounceMs)); })
            .then((r) => { if (r) change((s) => ({ ...s, cloud: { ...s.cloud, [which]: r } })); return r; });
        }
        const cloudLimit = A.cloudEnough(search.depth, own.name);
        // level 0 with stored: auto's search at the live settings (liveFirst), else the stored result, or that search
        // where one finished earlier (notPast then keeps the stored result over a shallower one)
        const at = (l, which) => (l === 0 && stored && !liveFirst ? p.cachedAt(0, which) || stored : p.cachedAt(l, which));
        const handles = [], cached = (which) => at(lv, which);
        // the result a press of Go deeper started from, shown until the deeper search passes its depth
        const prev = (which) => (lv > 0 ? at(lv - 1, which) : null);
        const shown = (which) => cached(which) || (prev(which) && { ...prev(which), partial: true, held: true });
        st = { before: shown('before'), after: shown('after'), cloud: { before: cloudHit.before || null, after: cloudHit.after || null }, pending: !off && (!cached('after') || !cached('before')), progress: 0 };
        const cancel = () => { live = false; handles.forEach((h) => h.cancel()); timers.forEach(clearTimeout); ctl.abort(); };
        // no local search: the cloud's answers (asked above) are all that can come
        if (off) return cancel;
        // the searches to run (the start position's two are one)
        const todo = [...new Set(WHICH.filter((w) => !cached(w)).map((w) => p.keyAt(lv, w)))].length;
        let ran = 0;
        // a failed Go deeper: the press is undone and the level before it runs again (its results are cached); a failed
        // auto search gives way to the stored result, with Go deeper to try again
        const fail = (msg) => { if (lv > 0) { presses.set(p.base, lv - 1); failed = msg; restart(); } else if (liveFirst) { liveFirst = false; failed = msg; restart(); } };
        (async () => {
          // nothing to search (the stored result, or every search cached): no engine is started, so a failed start isn't
          // retried by the run that gives way to the stored result
          if (!todo) { await null; change((s) => ({ ...s, before: cached('before'), after: cached('after'), pending: false })); return; }
          let eng;
          try { eng = await engine.get(); } catch (e) { if (live) { change((s) => ({ ...s, pending: false })); fail('Stockfish didn’t start' + (e && e.message ? ': ' + e.message : '')); } return; }
          for (const which of WHICH) {
            if (!live) return;
            // the start position is both before and after: its second search is the first one's, cached
            if (cached(which)) { const c = cached(which); change((s) => ({ ...s, [which]: c })); continue; }
            if (prefer) {
              const c = await asked[which];
              if (!live) return;
              if (c && c.depth >= cloudLimit) { ran++; continue; }
            }
            const floor = prev(which) ? prev(which).depth : 0;
            // a depth takes about 1.5 times the one before it, so depth d of D is about 1.5^(d − D) of the way
            const part = (sc) => Math.max(sc.timeMs ? sc.timeMs / search.movetimeMs : 0, search.depth ? Math.pow(1.5, sc.depth - search.depth) : 0);
            const i = ran++;
            const h = eng.search({ moves: moves[which], fen, ...search, lines: lines(which), priority: 'own', onInfo: (sc) => {
              const progress = (i + Math.min(1, part(sc))) / todo;
              change((s) => ({ ...s, progress: Math.max(s.progress, progress), ...(sc.depth > floor && { [which]: { ...sc, best: sc.pv[0] || null, partial: true } }) }));
            } });
            handles.push(h);
            const r = await h.promise;
            if (!live) return;
            if (!r) { const e = eng.failed && eng.failed(); change((s) => ({ ...s, pending: false })); fail('Stockfish stopped before it finished' + (e && e.message ? ': ' + e.message : '')); return; }
            if (r.cp != null) { const fin = { ...r, best: A.bestOf(r) }; finishedSearches.set(p.keyAt(lv, which), fin); change((s) => ({ ...s, [which]: fin })); }
          }
          change((s) => ({ ...s, pending: false }));
        })();
        return cancel;
      }
      // another level (a press, or a failed one undone): its state replaces the old one in the same change
      function restart() { if (stopped) return; stopRun(); stopRun = run(); onChange(); }

      function get() {
        // the cloud's answer stands until a finished local search goes deeper; it replaces the result a Go deeper
        // started from (the stored analysis's among them) only when deeper
        const pick = (loc, cl) => (cl && (!loc || cl.depth >= loc.depth || (loc.partial && !loc.held)) ? cl : loc);
        // a finished search that reached less deep than the stored result it set out to pass (its time ran out first,
        // as on fewer threads than the analysis had) leaves the stored result showing: a shallower eval isn't a better one
        const notPast = (r) => (stored && !liveFirst && r && !r.partial && !r.stored && r.source !== 'cloud' && stored.depth && r.depth < stored.depth ? stored : r);
        const out = { ...st, before: pick(notPast(st.before), st.cloud.before), after: pick(notPast(st.after), st.cloud.after) };
        const fromCloud = (r) => !!(r && r.source === 'cloud');
        const done = out.after && !out.after.partial && out.before && !out.before.partial && !out.pending;
        const lv = level, next = A.deeperSearch(own, lv + 1);
        // nothing to go deeper on where both positions show a cloud answer at least as deep as the next search would
        // reach (AnalysisCore.cloudEnough)
        const cloudDeep = (r) => fromCloud(r) && r.depth >= A.cloudEnough(next.depth, own.name);
        const deeper = !off && done && !(cloudDeep(out.after) && cloudDeep(out.before)) && A.canGoDeeper(own, lv) ? () => { presses.set(p.base, lv + 1); failed = null; restart(); } : null;
        return { ...out, deeper, deeperTo: deeper ? next : null, failed, level: lv };
      }

      stopRun = run();
      return { get, stop() { stopped = true; stopRun(); } };
    }

    return { watch, keyOf, positionKey };
  }

  window.MoveEval = { create, EMPTY };
})();
