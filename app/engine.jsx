// Continuous-composition animation engine, trimmed from Claude Design's animations-v3.jsx
// for a standalone page: no host timeline, no video export, no watercolor kit.
// The whole video is one element tree rendered as a pure function of authored time T.

const Easing = {
  linear: (t) => t,
  easeOutCubic: (t) => (--t) * t * t + 1,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeOutBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const TimelineContext = React.createContext({ time: 0, duration: 10, playing: false });
const useTimeline = () => React.useContext(TimelineContext);
// which frame the stage shows: { tall: false } for landscape, { tall: true, height } for the portrait one,
// { short: true, width } for the wide, short one on a phone held sideways, { square: true, height } for the square one
const FrameContext = React.createContext({ tall: false });
// Where the landscape frame is ruled out, the square one beats the sideways one unless that shows over 1/0.9 as large
// (a page near 1050 × 800 gets square, which fills its height; a short one stays sideways)
const SQUARE_OVER_SHORT = 0.9;
const useFrame = () => React.useContext(FrameContext);


// still: a board without a timeline (the free board): no playing, no seeking keys, and a transport bar of moves only
// top: an optional line above the frame (the page's Offline tag); the frame scales to the room left
function Stage({ width, height, portrait, square, short, menu, top, onLayout, duration, background, playback, nav, still, children }) {
  const playTimes = playback && playback.mode === 'times' ? playback.count : null;
  const loop = !playback || playback.mode === 'loop';
  // The page opens paused on the composition's start frame (setStart); the first Play from that untouched frame
  // starts the video from 0:00, the title card
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const timeRef = React.useRef(0), playingRef = React.useRef(false), freshRef = React.useRef(null);
  timeRef.current = time; playingRef.current = playing;
  const setStart = React.useCallback((t) => { setTime(t); freshRef.current = t; }, []);
  const togglePlay = () => {
    if (!playingRef.current && freshRef.current != null && Math.abs(timeRef.current - freshRef.current) < 1e-6) setTime(0);
    freshRef.current = null;
    setPlaying((p) => !p);
  };
  const [scale, setScale] = React.useState(0.2);
  const [frame, setFrame] = React.useState({ tall: false });
  const tallRef = React.useRef(false), shortRef = React.useRef(false), squareRef = React.useRef(false);
  const tall = frame.tall;
  React.useEffect(() => { if (still) setPlaying(false); }, [still]);
  const areaRef = React.useRef(null);
  const lastTsRef = React.useRef(null);
  const passesRef = React.useRef(0);


  // measured before the first paint, so a phone's first frame is already laid out as a phone (after it, the dock's
  // buttons showed unfolded for a frame or two, wider than the screen)
  React.useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    // Each frame is judged by the room it would get: the stage less that frame's own transport bar and padding (the
    // portrait and sideways ones are slimmer), as last measured while it showed. Judged by the room the current one
    // leaves, a window at a boundary flips back and forth: the switch itself changes the room.
    const chrome = { wide: [32, 82], tall: [16, 49], short: [32, 44] };
    const measure = () => {
      const st = el.parentElement, cur = st.classList.contains('stage-tall') ? 'tall' : st.classList.contains('stage-short') ? 'short' : 'wide';
      chrome[cur] = [st.clientWidth - el.clientWidth, st.clientHeight - el.clientHeight];
      const room = (k) => [Math.max(1, st.clientWidth - chrome[k][0]), Math.max(1, st.clientHeight - chrome[k][1])];
      const [w, h] = room('wide'), [tw, th] = room('tall'), [kw, kh] = room('short');
      // The portrait frame takes over when it would show noticeably larger than the landscape one;
      // the 1.1–1.15 band keeps a window at the boundary from flipping back and forth.
      // It is as tall as the area allows (between its min and max height), so it fills a phone screen.
      // A page under 1050 × 650 never gets the landscape frame: it takes the largest of the others
      const noWide = (portrait || square || short) && (st.clientWidth < 1050 || st.clientHeight < 650);
      const sl = noWide ? 0 : Math.min(w / width, h / height);
      const sp = portrait ? Math.min(tw / portrait.width, th / portrait.minHeight) : 0;
      // A short landscape area (a phone held sideways) gets a wider frame whose board fills the height, as wide as
      // the area allows (between its min and max width); a desktop window keeps the 16:9 video
      const ss = short && (noWide || h < short.maxArea) ? Math.min(kw / short.minWidth, kh / short.height) : 0;
      // A square-ish area big enough not to be a phone gets the square frame when it shows noticeably larger than the
      // landscape one and at least as large as the portrait one (judged by the room the landscape frame leaves: same bar)
      const sq = square && (noWide || Math.min(w, h) >= 600) ? Math.min(w / square.width, h / square.minHeight) : 0;
      const nextSq = sq > sl * (squareRef.current ? 1.05 : 1.1) && sq > sp * (squareRef.current ? 1 : 1.02) && !(noWide && ss * SQUARE_OVER_SHORT > sq);
      squareRef.current = nextSq;
      const qh = nextSq ? clamp(Math.floor(h / sq), square.minHeight, square.maxHeight) : 0;
      const next = !nextSq && sp > sl * (tallRef.current ? 1.1 : 1.15) && !(noWide && ss > sp);
      tallRef.current = next;
      const ph = next ? clamp(Math.floor(th / sp), portrait.minHeight, portrait.maxHeight) : 0;
      const nextShort = !next && !nextSq && ss > sl * (shortRef.current ? 1.05 : 1.1);
      shortRef.current = nextShort;
      const sw = nextShort ? clamp(Math.floor(kw / ss), short.minWidth, short.maxWidth) : 0;
      // narrow: a landscape or square frame under 900 px wide, too little room beside the track for the page's buttons,
      // which fold into a menu (the portrait frame always has it)
      const narrow = !next && st.clientWidth < 900;
      setFrame((f) => (f.tall === next && !!f.square === nextSq && !!f.short === nextShort && !!f.narrow === narrow && (f.height || 0) === (ph || qh) && (f.width || 0) === sw ? f
        : next ? { tall: true, height: ph } : nextSq ? { tall: false, square: true, narrow, height: qh } : nextShort ? { tall: false, short: true, narrow, width: sw } : { tall: false, narrow }));
      setScale(Math.max(0.05, next ? sp : nextSq ? Math.min(w / square.width, h / qh) : nextShort ? Math.min(kw / sw, kh / short.height) : sl));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height, portrait && portrait.width, portrait && portrait.minHeight, portrait && portrait.maxHeight, square && square.minHeight, short && short.height]);
  // onLayout(true, w): a phone frame (portrait, or any other under 900 px wide), where the page folds its buttons into a menu; w is the frame's width
  const phone = tall || !!frame.narrow, fw = tall ? portrait.width : frame.square ? square.width : frame.short ? frame.width : width;
  React.useLayoutEffect(() => { if (onLayout) onLayout(phone, fw); }, [phone, fw]);

  React.useEffect(() => {
    if (!playing) { lastTsRef.current = null; return; }
    passesRef.current = 0;
    let raf;
    const step = (ts) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setTime((t) => {
        let next = t + dt;
        if (next >= duration) {
          if (playTimes !== null) {
            passesRef.current += 1;
            if (passesRef.current >= playTimes) { next = duration; setPlaying(false); } else next = next % duration;
          } else if (loop) next = next % duration;
          else { next = duration; setPlaying(false); }
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); lastTsRef.current = null; };
  }, [playing, duration, loop, playTimes]);

  // Keyboard: space = play/pause, arrows = seek (shift for 1 s), 0/Home = start
  React.useEffect(() => {
    if (still) return;
    const onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (e.defaultPrevented || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Space on a focused button, switch or link presses it rather than playing
      if (e.code === 'Space' && e.target.closest && e.target.closest('button, a[href], summary, [role="button"], [role="switch"], [role="radio"], [role="checkbox"]')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.code === 'ArrowLeft') setTime((t) => clamp(t - (e.shiftKey ? 1 : 0.1), 0, duration));
      else if (e.code === 'ArrowRight') setTime((t) => clamp(t + (e.shiftKey ? 1 : 0.1), 0, duration));
      else if (e.key === '0' || e.code === 'Home') setTime(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duration, still]);

  // Page controls outside the stage (Queen panel, video export) pause and seek through this event;
  // `sync` renders the new frame before dispatchEvent returns, so the export can draw it straight away
  React.useEffect(() => {
    const onSeek = (e) => {
      const go = () => { setPlaying(false); if (e.detail && isFinite(e.detail.time)) setTime(clamp(e.detail.time, 0, duration)); };
      if (e.detail && e.detail.sync) ReactDOM.flushSync(go); else go();
    };
    window.addEventListener('chess-video:seek', onSeek);
    return () => window.removeEventListener('chess-video:seek', onSeek);
  }, [duration]);

  const fh = tall || frame.square ? frame.height : frame.short ? short.height : height;
  const ctx = React.useMemo(() => ({ time, duration, playing, setTime, setPlaying, setStart }), [time, duration, playing]);

  return (
    <div className={'stage' + (tall ? ' stage-tall' : frame.short ? ' stage-short' : '')}>
      {top}
      <div ref={areaRef} className="stage-area">
        <div className="stage-frame" style={{ width: fw * scale, height: fh * scale }}>
          <div style={{ width: fw, height: fh, background, position: 'relative', overflow: 'hidden', transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            <FrameContext.Provider value={frame}>
              <TimelineContext.Provider value={ctx}>{children}</TimelineContext.Provider>
            </FrameContext.Provider>
          </div>
        </div>
      </div>
      <PlaybackBar time={time} duration={duration} playing={playing} nav={nav} menu={menu} still={still}
        onPlayPause={togglePlay} onReset={() => setTime(0)}
        onSeek={(t) => setTime(t)} />
    </div>
  );
}

// Holding a move button steps like holding its arrow key: one step, then after a pause a quick repeat
const HOLD_DELAY_MS = 500, HOLD_REPEAT_MS = 35;
function NavButton({ nav, dir, label, children }) {
  const timer = React.useRef(null);
  const has = dir === 'prev' ? 'hasPrev' : 'hasNext';
  const stop = () => { clearTimeout(timer.current); timer.current = null; };
  React.useEffect(() => stop, []);
  const step = () => { const n = nav.current; if (!n || !n[has]) { stop(); return false; } n[dir](); return true; };
  const repeat = () => { if (step()) timer.current = setTimeout(repeat, HOLD_REPEAT_MS); };
  return (
    <button type="button" className="pbtn pnav" disabled={!nav.current[has]} aria-label={label} title={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        stop(); step(); timer.current = setTimeout(repeat, HOLD_DELAY_MS);
        // it can turn disabled under the pointer (the first or last move), and a disabled button gets no pointerup
        const end = () => { stop(); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
        window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
      }}
      onPointerLeave={stop}
      onContextMenu={(e) => e.preventDefault()} // a long press on a phone
      onClick={(e) => { if (e.detail === 0) step(); }}>{/* Enter or Space; a pointer already stepped on its press */}
      {children}
    </button>
  );
}

function PlaybackBar({ time, duration, playing, nav, menu, still, onPlayPause, onReset, onSeek }) {
  const trackRef = React.useRef(null);
  const dragging = React.useRef(false);
  // the video calls nav.listen when its move label changes while the playhead is still (stepping through a line)
  const [, redraw] = React.useState(0);
  React.useEffect(() => {
    if (!nav) return;
    nav.listen = () => redraw((x) => x + 1);
    return () => { nav.listen = null; };
  }, [nav]);
  const timeAt = (e) => { const r = trackRef.current.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * duration; };
  const pct = duration > 0 ? (time / duration) * 100 : 0;
  // spoken: "1 minute 5 seconds"
  const say = (t) => { const m = Math.floor(Math.max(0, t) / 60), x = Math.floor(Math.max(0, t) % 60); return (m ? `${m} minute${m === 1 ? '' : 's'} ` : '') + `${x} second${x === 1 ? '' : 's'}`; };
  const fmt = (t) => { const x = Math.max(0, t); return `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}.${String(Math.floor((x * 100) % 100)).padStart(2, '0')}`; };
  return (
    <div className="pbar">
      <button type="button" className="pbtn pbtn-end" disabled={nav && nav.current ? !(nav.current.hasFirst != null ? nav.current.hasFirst : nav.current.hasPrev) : still || time <= 0} onClick={still ? () => nav.current.first() : onReset} aria-label="Back to start (Home)" title="Back to start (Home)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2v10M12 2L5 7l7 5V2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
      </button>
      {nav && nav.current && (
        <NavButton nav={nav} dir="prev" label="Previous move (←)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </NavButton>
      )}
      {!still && (
        <button type="button" className="pbtn" onClick={onPlayPause} aria-label={playing ? 'Pause (space)' : 'Play (space)'} title={playing ? 'Pause (space)' : 'Play (space)'}>
          {playing
            ? <svg width="14" height="14" viewBox="0 0 14 14"><rect x="3" y="2" width="3" height="10" fill="currentColor" /><rect x="8" y="2" width="3" height="10" fill="currentColor" /></svg>
            : <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 2l9 5-9 5V2z" fill="currentColor" /></svg>}
        </button>
      )}
      {nav && nav.current && (
        <NavButton nav={nav} dir="next" label="Next move (→)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </NavButton>
      )}
      {nav && nav.current && (
        <button type="button" className="pbtn pbtn-end" disabled={!nav.current.hasLast} onClick={() => nav.current.last()} aria-label="Last move (End)" title="Last move (End)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11 2v10M2 2l7 5-7 5V2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
        </button>
      )}
      {nav && nav.current && <span className="plabel" style={{ color: nav.current.color }} aria-live="polite">{nav.current.label}</span>}
      {still ? <span className="pspacer" /> : <React.Fragment>
        <span className="ptime">{fmt(time)}</span>
        <div ref={trackRef} className="ptrack" role="slider" tabIndex={0} aria-label="Playhead" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}
          aria-valuetext={`${say(time)} of ${say(duration)}`}
          onKeyDown={(e) => {
            // focused, the arrows move the playhead by seconds rather than stepping through the moves
            const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
            const to = step != null ? time + step * (e.shiftKey ? 5 : 1) : e.key === 'Home' ? 0 : e.key === 'End' ? duration : null;
            if (to == null || e.altKey || e.metaKey || e.ctrlKey) return;
            e.preventDefault(); e.stopPropagation();
            onSeek(clamp(to, 0, duration));
          }}
          onPointerDown={(e) => { dragging.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {} onSeek(timeAt(e)); }}
          onPointerMove={(e) => { if (dragging.current) onSeek(timeAt(e)); }}
          onPointerUp={() => { dragging.current = false; }}
          onPointerCancel={() => { dragging.current = false; }}>
          <div className="ptrack-bg" />
          <div className="ptrack-fill" style={{ width: `${pct}%` }} />
          <div className="ptrack-knob" style={{ left: `${pct}%` }} />
        </div>
        <span className="ptime ptime-total">{fmt(duration)}</span>
      </React.Fragment>}
      {menu}
    </div>
  );
}

// ── Continuous composition: scene list → cue table; T is the authored clock ──
function parseScenes(raw) {
  try {
    const s = JSON.parse(raw);
    if (!Array.isArray(s) || !s.length) return null;
    return s.every((x) => x && typeof x.name === 'string' && isFinite(x.dur) && x.dur > 0) ? s : null;
  } catch (e) { return null; }
}
function deriveCues(scenes) {
  let start = 0; const table = {}, sections = [];
  scenes.forEach((s) => { sections.push({ name: s.name, start, dur: s.dur }); if (!(s.name in table)) table[s.name] = Math.round(start * 1000) / 1000; start += s.dur; });
  return { table, sections, total: Math.round(start * 1000) / 1000 };
}

const CompositionContext = React.createContext(null);
function useComposition() {
  const c = React.useContext(CompositionContext);
  if (!c) throw new Error('useComposition() must be called inside <CompositionStage>');
  return c;
}
function CompositionClock({ derived, children }) {
  const tl = useTimeline();
  const T = Math.min(tl.time, derived.total);
  const value = React.useMemo(() => ({ T, CUES: derived.table, time: tl.time, duration: tl.duration, authoredTotal: derived.total, playing: tl.playing }), [T, derived, tl.time, tl.duration, tl.playing]);
  return <CompositionContext.Provider value={value}>{children}</CompositionContext.Provider>;
}

function CompositionStage({ width, height, portrait, square, short, menu, top, onLayout, scenes, playback, bg, nav, still, children }) {
  const parsed = React.useMemo(() => parseScenes(scenes), [scenes]);
  const derived = React.useMemo(() => (parsed ? deriveCues(parsed) : null), [parsed]);
  const pb = React.useMemo(() => { try { return JSON.parse(playback); } catch (e) { return null; } }, [playback]);
  if (!derived) return <div className="stage-error">This game produced an invalid scene list.</div>;
  return (
    <Stage width={width} height={height} portrait={portrait} square={square} short={short} menu={menu} top={top} onLayout={onLayout} duration={derived.total} background={bg} playback={pb} nav={nav} still={still}>
      <CompositionClock derived={derived}>{children}</CompositionClock>
    </Stage>
  );
}

Object.assign(window, { Easing, clamp, CompositionStage, useComposition, useTimeline, useFrame });
