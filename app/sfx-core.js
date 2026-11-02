// Move sounds: which sounds a move makes, when its piece lands, the built-in Wood set (synthesized here) and the
// player. The Lichess sets are Enigmahack's (AGPL-3.0-or-later) and EdinburghCollective's lisp (CC BY-NC-SA 4.0),
// MP3s that build.cjs serves next to the page (soundUrl) and the service worker keeps from the first visit.
(function () {
  // the first is the default
  const SETS = ['Lichess sfx', 'Lichess piano', 'Lichess NES', 'Lichess futuristic', 'Lichess lisp', 'Wood'];
  const SET_DIR = { 'Lichess sfx': 'sfx', 'Lichess piano': 'piano', 'Lichess NES': 'nes', 'Lichess futuristic': 'futuristic', 'Lichess lisp': 'lisp' };
  // non-commercial sets (lisp, CC BY-NC-SA): played on the page but kept out of exported videos, which viewers may post
  // anywhere, monetised channels included; an export uses the default set in their place
  const NON_COMMERCIAL = ['Lichess lisp'];
  const exportSet = (set) => (SETS.includes(set) && !NON_COMMERCIAL.includes(set) ? set : SETS[0]);
  const KINDS = ['move', 'capture', 'check', 'victory', 'draw'];
  // a Lichess sound's file, next to the page; null for Wood (made here) or a set that's gone
  const soundUrl = (set, kind) => (SET_DIR[set] ? `sounds/${SET_DIR[set]}/${kind[0].toUpperCase()}${kind.slice(1)}.mp3` : null);
  // a file's bytes, or null if it can't be had (offline before the service worker kept it)
  const fetchSound = (url) => fetch(url, { priority: 'high' }).then((r) => (r.ok ? r.arrayBuffer() : null), () => null);
  const END_DELAY = 0.6; // seconds between the last move's sound and the end of the game's

  // played together: the move or capture, and a check on top
  const kinds = (san) => [/x/.test(san || '') ? 'capture' : 'move'].concat(/[+#]/.test(san || '') ? ['check'] : []);
  const endKind = (result) => (result === '1-0' || result === '0-1' ? 'victory' : result === '1/2-1/2' ? 'draw' : null);
  // the last ply whose piece has reached its square (pieces move from S.tp[i] for S.md[i] seconds)
  const landed = (T, S) => { let k = -1; for (let i = 0; i < S.N; i++) { if (T >= S.tp[i] + S.md[i]) k = i; else break; } return k; };
  // what to play when the board's landed ply goes from `from` to `to`; the end sound only when playback reaches it
  function cue(M, from, to, playing) {
    if (to === from || to < 0 || to >= M.plies.length) return null;
    const end = playing && to > from && to === M.plies.length - 1 ? endKind(M.result) : null;
    return { kinds: kinds(M.plies[to].san), end };
  }

  // The move sounds between start and end seconds as playback plays them: each ply's when its piece lands, and the
  // end of the game's after the last. Times are from start (for the video export)
  function track(M, S, start, end) {
    const out = [];
    for (let i = 0; i < S.N; i++) {
      const at = S.tp[i] + S.md[i];
      if (at < start || at >= end) continue;
      out.push({ at: at - start, kinds: kinds(M.plies[i].san) });
      const e = i === S.N - 1 && endKind(M.result);
      if (e && at + END_DELAY < end) out.push({ at: at + END_DELAY - start, kinds: [e] });
    }
    return out;
  }

  // ---- Wood: knocks of a piece on a board, bells for check and the end ----
  // seeded noise, so the set sounds the same every time
  const noise = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1; };
  // a noise burst rung through a band-pass (RBJ biquad) at `freq`, over a low body tone
  function knock(out, rate, at, freq, decay, body, seed) {
    const rnd = noise(seed), w = (2 * Math.PI * freq) / rate, alpha = Math.sin(w) / (2 * 4), a0 = 1 + alpha;
    const b0 = alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = Math.round(at * rate); i < out.length; i++) {
      const t = i / rate - at, env = Math.exp(-t / decay) * Math.min(1, t / 0.0006);
      const x = rnd() * env, y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[i] += 3 * y + body * Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t / (decay * 2.5)) * Math.min(1, t / 0.002);
    }
  }
  // a soft bell: a sine and its fifth, fading out
  function bell(out, rate, at, freq, decay) {
    for (let i = Math.round(at * rate); i < out.length; i++) {
      const t = i / rate - at, env = Math.exp(-t / decay) * Math.min(1, t / 0.004);
      out[i] += env * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 1.5 * t));
    }
  }
  const WOOD = {
    move: [0.16, 0.55, (o, r) => knock(o, r, 0, 1500, 0.011, 0.25, 7)],
    capture: [0.22, 0.75, (o, r) => { knock(o, r, 0, 1300, 0.01, 0.2, 11); knock(o, r, 0.03, 1800, 0.013, 0.35, 13); }],
    check: [0.45, 0.35, (o, r) => bell(o, r, 0, 1320, 0.09)],
    victory: [1.4, 0.4, (o, r) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(o, r, i * 0.12, f, 0.25))],
    draw: [1.1, 0.35, (o, r) => [783.99, 523.25].forEach((f, i) => bell(o, r, i * 0.2, f, 0.3))],
  };
  // one Wood sound as samples at `rate`, scaled to its peak, with a short fade so it ends in silence
  function synth(kind, rate) {
    const w = WOOD[kind];
    if (!w) throw new Error('No Wood sound "' + kind + '"');
    const out = new Float32Array(Math.round(w[0] * rate));
    w[2](out, rate);
    let peak = 0; for (const v of out) peak = Math.max(peak, Math.abs(v));
    const fade = Math.round(0.01 * rate);
    for (let i = 0; i < out.length; i++) out[i] *= (w[1] / (peak || 1)) * Math.min(1, (out.length - 1 - i) / fade);
    return out;
  }

  // a sound as an AudioBuffer in ctx's sample rate, or a promise of one (null if it can't be had) while a Lichess file
  // downloads and decodes; null if the set has no such sound. get(url) fetches a file's bytes
  function decode(ctx, get, set, kind) {
    if (set === 'Wood') {
      const s = synth(kind, ctx.sampleRate), b = ctx.createBuffer(1, s.length, ctx.sampleRate);
      b.getChannelData(0).set(s);
      return b;
    }
    const url = soundUrl(set, kind);
    if (!url) return null;
    return get(url).then((bytes) => (bytes ? ctx.decodeAudioData(bytes) : null));
  }
  const gainOf = (volume) => Math.max(0, Math.min(1, (volume == null ? 70 : volume) / 100));

  // Mixes a track() into a stereo AudioBuffer dur seconds long, offline, for the video export
  async function renderTrack(get, set, events, volume, dur, rate = 48000) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return null;
    set = exportSet(set);
    const ctx = new OAC(2, Math.max(1, Math.ceil(dur * rate)), rate), bufs = {};
    for (const k of new Set(events.flatMap((e) => e.kinds))) { try { bufs[k] = await decode(ctx, get, set, k); } catch (e) { bufs[k] = null; } }
    const gain = ctx.createGain();
    gain.gain.value = gainOf(volume);
    gain.connect(ctx.destination);
    events.forEach((e) => e.kinds.forEach((k) => {
      if (!bufs[k]) return;
      const src = ctx.createBufferSource(); src.buffer = bufs[k]; src.connect(gain); src.start(e.at);
    }));
    return ctx.startRendering();
  }

  // ---- the player: Web Audio, started by the viewer's first tap or key (browsers keep it silent until then) ----
  function createPlayer(get) {
    let ctx = null, wanted = SETS[0], waking = null; // waking: a gesture's resume() while it settles
    const cache = new Map(); // `${set}/${kind}` → AudioBuffer, or a promise while it downloads and decodes
    // url → a file's bytes (a promise), fetched as soon as its set is chosen, before the first gesture makes an AudioContext:
    // on a first visit, fetched only then, the first moves' files queued behind Stockfish and the service worker's install
    const files = new Map();
    function file(url) {
      if (!files.has(url)) files.set(url, Promise.resolve(get(url)).catch(() => null).then((b) => { if (!b) files.delete(url); return b; }));
      return files.get(url).then((b) => b && b.slice(0)); // decodeAudioData detaches what it's given
    }
    function load(set, kind) {
      const key = set + '/' + kind;
      if (cache.has(key)) return cache.get(key);
      let v = decode(ctx, file, set, kind);
      if (!v) return null;
      // a file that couldn't be had is asked for again next time (offline before it was kept); one that won't decode isn't
      if (typeof v.then === 'function') v = v.then((buf) => { if (buf) cache.set(key, buf); else cache.delete(key); return buf; }, () => { cache.set(key, null); return null; });
      cache.set(key, v);
      return v;
    }
    const prepare = (set) => {
      wanted = SETS.includes(set) ? set : SETS[0];
      KINDS.forEach((k) => { const url = soundUrl(wanted, k); if (url) file(url); if (ctx) load(wanted, k); });
    };
    function unlock() {
      try {
        if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); prepare(wanted); }
        if (ctx.state === 'suspended' && !waking) { const w = (waking = Promise.resolve(ctx.resume()).catch(() => {})); w.then(() => { if (waking === w) waking = null; }); }
      } catch (e) {}
    }
    if (typeof window.addEventListener === 'function') ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, true));
    function start(set, kind, delay, gain) {
      const buf = load(set, kind);
      const go = (b) => { if (!b) return; const src = ctx.createBufferSource(); src.buffer = b; src.connect(gain); src.start(ctx.currentTime + delay); };
      // still downloading or decoding (the first sound of a newly picked set): play it if it's ready soon, else let it go
      if (buf && typeof buf.then === 'function') { const asked = Date.now(); buf.then((b) => { if (Date.now() - asked < 300) go(b); }); } else go(buf);
    }
    function play(set, kindList, volume, end) {
      if (!ctx) return; // before the first gesture: nothing queues up to burst out later
      // Firefox starts the audio suspended in the gesture that makes it, running a moment later: the move that gesture
      // made (the first Next) plays then, if soon
      if (ctx.state !== 'running') {
        if (waking) { const asked = Date.now(); waking.then(() => { if (ctx.state === 'running' && Date.now() - asked < 300) play(set, kindList, volume, end); }); }
        return;
      }
      set = SETS.includes(set) ? set : SETS[0];
      if (set !== wanted) prepare(set);
      // a gain per sound, so moving the volume slider doesn't change one still ringing
      const gain = ctx.createGain();
      gain.gain.value = gainOf(volume);
      gain.connect(ctx.destination);
      kindList.forEach((k) => start(set, k, 0, gain));
      if (end) start(set, end, END_DELAY, gain);
    }
    return { play, prepare, unlock };
  }

  window.Sfx = { SETS, SET_DIR, NON_COMMERCIAL, exportSet, KINDS, soundUrl, fetchSound, kinds, endKind, landed, cue, track, synth, renderTrack, createPlayer };
})();
