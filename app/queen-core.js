// Parsing Queen's answers (the boneyland/queen-pawn-8 Space), kept free of React so the tests can load it.
(function () {
  // The tool's text answer can come back as a Python dict repr ({'key': 'value', 'x': None}), not JSON
  function pyParse(src) {
    let i = 0;
    const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
    const val = () => {
      ws();
      const ch = src[i];
      if (ch === '{' || ch === '[' || ch === '(') { // a tuple reads as an array
        const close = { '{': '}', '[': ']', '(': ')' }[ch], out = ch === '{' ? {} : [];
        i++; ws();
        while (src[i] !== close) {
          if (ch === '{') { const k = val(); ws(); if (src[i++] !== ':') throw new Error('bad dict'); out[k] = val(); }
          else out.push(val());
          ws(); if (src[i] === ',') { i++; ws(); }
          if (i >= src.length) throw new Error('unterminated');
        }
        i++; return out;
      }
      if (ch === "'" || ch === '"') {
        let s = ''; i++;
        while (src[i] !== ch) {
          if (i >= src.length) throw new Error('unterminated string');
          if (src[i] === '\\') {
            const e = src[++i];
            if (e === 'n') s += '\n'; else if (e === 't') s += '\t'; else if (e === 'r') s += '\r';
            else if (e === 'u') { s += String.fromCharCode(parseInt(src.slice(i + 1, i + 5), 16)); i += 4; }
            else if (e === 'U') { s += String.fromCodePoint(parseInt(src.slice(i + 1, i + 9), 16)); i += 8; }
            else if (e === 'x') { s += String.fromCharCode(parseInt(src.slice(i + 1, i + 3), 16)); i += 2; }
            else s += e;
            i++;
          } else s += src[i++];
        }
        i++; return s;
      }
      const m = /^(None|True|False|null|true|false|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/i.exec(src.slice(i));
      if (!m) throw new Error('unexpected ' + ch);
      i += m[0].length;
      const LIT = { None: null, null: null, True: true, true: true, False: false, false: false };
      return Object.prototype.hasOwnProperty.call(LIT, m[0]) ? LIT[m[0]] : Number(m[0]);
    };
    return val();
  }

  function queenPayload(res) {
    let p = res && res.payload !== undefined ? res.payload : res;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { try { p = pyParse(p.trim()); } catch (e2) {} } }
    if (!p || typeof p !== 'object' || !('best_move_uci' in p || 'analysis' in p)) throw { code: 'bad_answer', message: 'Queen answered in a shape this page does not recognise.', raw: JSON.stringify(res && res.payload !== undefined ? res.payload : res) };
    return p;
  }

  // "White is better by approximately 1.37 pawns" -> +1.37, "White is losing by 5.24 pawns" -> -5.24 (White's point of view)
  function queenEval(text) {
    if (!text) return null;
    text = text.replace(/\b(approx|ca|est)\.\s*/gi, '$1 '); // "approx. 0.9" is not the end of a sentence
    const num = (x) => parseFloat(x.replace('−', '-'));
    // "+0.26 pawns from Black's perspective" -> -0.26
    const v = /([+\-−]?\d+(?:\.\d+)?)\s*pawns?\s+(?:from|in)\s+(White|Black)['’]s\s+(?:perspective|point of view|view)/i.exec(text);
    if (v) return (v[2].toLowerCase() === 'white' ? 1 : -1) * num(v[1]);
    // A side, then within the same sentence a number of pawns: "White is better by approximately 1.37 pawns",
    // "Black is down about 0.5 pawns", "White is winning by approximatedly 3 pawns", "Black has an edge of 0.8 pawns"
    const m = /\b(White|Black)\b((?:[^.;!?\n]|\.(?=\d)){0,90}?)([+\-−]?\d+(?:\.\d+)?)\s*pawns?\b/i.exec(text);
    if (m) {
      const behind = /\b(losing|lost|worse|behind|down|trails?|trailing|disadvantage|deficit|short)\b/i.test(m[2]);
      const n = num(m[3]);
      return (m[1].toLowerCase() === 'white' ? 1 : -1) * (behind ? -Math.abs(n) : n);
    }
    if (/\b(equal|balanced|level|even|equality)\b/i.test(text)) return 0;
    return null;
  }
  function queenProse(text) {
    if (!text) return [];
    const body = text.replace(/^\s*ANALYSIS:\s*/i, '').split(/\n(?=BEST_MOVE:|CRITICAL_LINE:|PROMISING_MOVES:|EVALUATION:)/)[0];
    return body.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }


  // Gradio's server-sent events: blocks of "event: <name>" and "data: <json>"; the last complete and error win
  function readSse(text) {
    let result = null, error = null;
    for (const block of text.split(/\n\n+/)) {
      const ev = (block.match(/^event:\s*(.+)$/m) || [])[1], data = (block.match(/^data:\s*(.*)$/m) || [])[1];
      if (ev === 'complete') { try { result = JSON.parse(data); } catch (e) {} }
      else if (ev === 'error') { try { error = JSON.parse(data); } catch (e) { error = data; } }
    }
    return { result, error };
  }

  // The answers cache is kept oldest first and under about a megabyte of JSON (some 150-200 answers), dropping the
  // oldest answers past that, so it never fills the browser's storage and leaves room for the saved game
  const QUEEN_CHARS = 1000000;
  function capQueenCache(c, limit = QUEEN_CHARS) {
    const keys = Object.keys(c);
    const size = keys.map((k) => JSON.stringify(k).length + JSON.stringify(c[k]).length + 2);
    let total = 2 + size.reduce((x, y) => x + y, 0), from = 0;
    while (total > limit && from < keys.length - 1) total -= size[from++];
    return from ? Object.fromEntries(keys.slice(from).map((k) => [k, c[k]])) : c;
  }

  // An answer as the page draws it, from the Space, a saved file or the browser's cache: every field its expected type,
  // so one odd answer can't break the page (it is saved, so it would break every visit). null when it isn't an answer.
  const UCI = /^([a-h][1-8]){2}[qrbn]?$/;
  function queenAnswer(r, at) {
    if (!r || typeof r !== 'object' || !(Array.isArray(r.prose) || typeof r.prose === 'string')) return null;
    const str = (v) => (typeof v === 'string' ? v : '');
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
    return {
      best: typeof r.best === 'string' && UCI.test(r.best) ? r.best : null, bestSan: str(r.bestSan) || null, line: str(r.line),
      evalText: str(r.evalText), evalPawns: num(r.evalPawns),
      prose: Array.isArray(r.prose) ? r.prose.filter((x) => typeof x === 'string' && x) : r.prose ? [r.prose] : [],
      seconds: num(r.seconds), source: str(r.source) || 'best_move', at,
    };
  }

  // A saved answers file holds the answers for one game's positions, keyed like the cache by the moves played to reach
  // each position (UCI, space-separated), so loading it back skips those Queen calls on any device
  const QUEEN_FILE = 'queen-answers';
  // The cache key of the position after `moves` (a space-separated UCI string): the moves alone from the standard
  // start (as always), the start FEN in front of them otherwise, so games from different starts never share answers
  const queenKey = (fen, moves) => (fen && fen !== window.ChessCore.START_FEN ? fen + '|' + moves : moves);
  function queenFile(cache, ucis, fen) {
    // every position from the start to the one after the last move (Queen also scores the positions after moves)
    const keys = new Set([...ucis, null].map((_, i) => queenKey(fen, ucis.slice(0, i).join(' '))));
    const answers = Object.fromEntries(Object.keys(cache).filter((k) => keys.has(k)).map((k) => [k, cache[k]]));
    return { format: QUEEN_FILE, version: 1, moves: ucis.join(' '), ...(queenKey(fen, '') !== '' ? { start_fen: fen } : {}), answers };
  }
  // the answers in a saved file, or null when the text isn't one; entries that don't look like answers are dropped
  function readQueenFile(text) {
    let j;
    try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return null; }
    if (!j || j.format !== QUEEN_FILE || !j.answers || typeof j.answers !== 'object') return null;
    return readQueenCache(j.answers);
  }
  // the answers in a cache or file object, keyed by the moves played to reach each position; the rest are dropped
  function readQueenCache(c) {
    const out = {};
    if (!c || typeof c !== 'object') return out;
    for (const [k, r] of Object.entries(c)) {
      const m = /^(?:[^|]+\|)?((?:([a-h][1-8]){2}[qrbn]?( |$))*)$/.exec(k);
      if (!m) continue;
      const a = queenAnswer(r, m[1] ? m[1].split(' ').length : 0);
      if (a) out[k] = a;
    }
    return out;
  }

  window.QueenCore = { pyParse, queenPayload, queenEval, queenProse, readSse, capQueenCache, queenAnswer, queenKey, queenFile, readQueenFile, readQueenCache };
})();
