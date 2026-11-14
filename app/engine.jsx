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
// what the stage gives its view: the area's size (w, h), the column count the page lays out in (1 or 2), whether it is
// a video (playing, or an export drawing) rather than a paused page, and the text size multiplier.
// A view calls setContentH(h) with the height its layout needs, so a paused one-column page can scroll when it is taller than the area.
// dock: a short two-column window, whose transport bar sits at the foot of the sidebar (LayoutCore's L.dock).
const FrameContext = React.createContext({ w: 1440, h: 900, cols: 2, video: false, text: 1, dock: false, setContentH: () => {} });
const useFrame = () => React.useContext(FrameContext);

// ---------- keys ----------
// a key pressed in a text field, a drop-down or an editable box is that control's, not a shortcut
const isTypingTarget = (e) => { const t = e.target; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || !!t.isContentEditable); };
// Ctrl, Cmd or Alt with a key belongs to the browser (Ctrl+0, Alt+←), never to a shortcut
const hasModifier = (e) => e.ctrlKey || e.metaKey || e.altKey;

// A page shortcut: onKey(e) on each keydown while on, always the latest onKey (it may read props and state as they are).
// A key another handler has already claimed (preventDefault) or one typed in a field never reaches it; fields: let the
// field's keys through (Esc, which closes things from a field too). A handler that acts on a key claims it with
// preventDefault, so no other shortcut acts on it as well. overlay: the Esc of something drawn over the board (Settings,
// Queen's panel, the menus) listens on the document, whose listeners run before the window's where the views' keys are,
// so Esc closes the overlay alone and not also a previewed line or the editor behind it. A dialog's keys stop in the
// dialog (DialogBox) and reach neither. The keys are listed for the viewer in SHORTCUTS (free-board.jsx)
function useKeydown(onKey, { on = true, fields = false, overlay = false } = {}) {
  const ref = React.useRef(onKey);
  ref.current = onKey;
  React.useEffect(() => {
    if (!on) return;
    const at = overlay ? document : window;
    const listen = (e) => { if (!e.defaultPrevented && !e.isComposing && (fields || !isTypingTarget(e))) ref.current(e); };
    at.addEventListener('keydown', listen);
    return () => at.removeEventListener('keydown', listen);
  }, [on, fields, overlay]);
}

// A menu that closes, while open, on a press outside ref's element or on Esc (an overlay's, so Esc closes only the menu)
function useDismiss(open, ref, close) {
  const closeRef = React.useRef(close);
  closeRef.current = close;
  useKeydown((e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }, { on: open, fields: true, overlay: true });
  React.useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) closeRef.current(); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
}


// still: a board without a timeline (the free board): no playing, no seeking keys, and a transport bar of moves only
// the page's own margins above and below the frame, which an export keeps (export.jsx): the stage's padding and, above,
// the area's (one column's); not the transport bar and its gap, nor an Offline tag. area: the .stage-area element
const stageMargins = (area) => {
  const s = getComputedStyle(area.parentElement), a = getComputedStyle(area), n = (v) => parseFloat(v) || 0;
  return { top: n(s.paddingTop) + n(a.paddingTop), bottom: n(s.paddingBottom) };
};

// top: an optional line above the frame (the page's Offline tag); the page lays out at the size of the room left
// fps: the export's frame rate, the step of the , and . keys
function Stage({ menu, top, onLayout, duration, background, playback, nav, still, forceVideo, text = 1, clock, fps = 8, children }) {
  const playTimes = playback && playback.mode === 'times' ? playback.count : null;
  const loop = !playback || playback.mode === 'loop';
  // The page opens paused on the composition's start frame (setStart); the first Play from that untouched frame
  // starts the video from 0:00, the title card
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const timeRef = React.useRef(0), playingRef = React.useRef(false), freshRef = React.useRef(null);
  timeRef.current = time; playingRef.current = playing;
  if (clock) clock.current = { time };
  const setStart = React.useCallback((t) => { setTime(t); freshRef.current = t; }, []);
  const togglePlay = () => {
    if (!playingRef.current && freshRef.current != null && Math.abs(timeRef.current - freshRef.current) < 1e-6) setTime(0);
    freshRef.current = null;
    setPlaying((p) => !p);
  };
  const [area, setArea] = React.useState({ w: 1440, h: 900, cols: 2, sh: 900, vw: 1440, vh: 900 });
  const [contentH, setContentH] = React.useState(0);
  const colsRef = React.useRef(null); // the last column count, for the switch's hysteresis
  React.useEffect(() => { if (still) setPlaying(false); }, [still]);
  // a schedule that got shorter (a setting, commentary turned off) while the playhead was near the end: back onto it
  React.useEffect(() => { setTime((t) => (t > duration ? duration : t)); }, [duration]);
  const areaRef = React.useRef(null);
  const video = playing || !!forceVideo;
  const lastTsRef = React.useRef(null);
  const passesRef = React.useRef(0);


  // measured before the first paint, so a phone's first frame is already laid out as a phone (after it, the dock's
  // buttons showed unfolded for a frame or two, wider than the screen)
  React.useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const off = {}; // what each column count leaves of the viewport for the area, as last seen (LayoutCore.pickColumns)
    const measure = () => {
      // sh: the whole stage's height, which the slim bar doesn't change (the area's does), so it can decide the bar
      // the area's own padding (one column's, shell.html) is outside the page
      const cs = getComputedStyle(el), px = (k) => parseFloat(cs[k]) || 0;
      const w = el.clientWidth - px('paddingLeft') - px('paddingRight'), h = el.clientHeight - px('paddingTop') - px('paddingBottom');
      const sh = el.parentElement.clientHeight, ox = el.offsetLeft, oy = el.offsetTop, m = stageMargins(el), my = m.top + m.bottom;
      // the viewport, which caps the board's size (LayoutCore)
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const cols = LayoutCore.pickColumns({ w, h, vw, vh, text, video, was: colsRef.current, off });
      colsRef.current = cols;
      setArea((a) => (a.w === w && a.h === h && a.cols === cols && a.sh === sh && a.vw === vw && a.vh === vh && a.ox === ox && a.oy === oy && a.my === my ? a : { w, h, cols, sh, vw, vh, ox, oy, my }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, video]);
  const { w, h, cols, sh } = area;
  // a short two-column window (a phone held sideways): the transport bar goes in the sidebar, under the panels, so the
  // board gets the whole height; it is placed over the area at the box the layout keeps for it. There it always folds
  // its buttons into the menu, however wide the window (a large phone is 932 px wide on its side)
  const short = cols === 2 && sh < 500;
  const narrow = w < 900, phone = cols === 1 || narrow || short;
  const dock = short ? LayoutCore.compute({ w, h, text, video, cols, dock: true, vw: area.vw, vh: area.vh }).dock : null;
  // the export's pixel width: the viewport's width at the device's pixel ratio, held to 1920 on its longer side (the
  // frame's height and the page's margins above and below it, export.jsx)
  const exportW = LayoutCore.exportPx(area.vw, LayoutCore.exportScale(area.vw, h + (area.my || 0), window.devicePixelRatio));
  // onLayout(true, w, short): a phone layout (one column, under 900 px wide, or the bar in the sidebar), where the page folds its buttons into a
  // menu; w is the export's width; short: the transport bar is in the sidebar
  React.useLayoutEffect(() => { if (onLayout) onLayout(phone, exportW, short); }, [phone, exportW, short]);

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

  // Keyboard: space = play/pause, shift+arrows = seek 1 s (plain arrows are claimed by the views, which step moves), 0/Home = start,
  // , and . = pause and step one export frame (the times an export from 0:00 draws; from between two, to the one on that side)
  useKeydown((e) => {
    if (hasModifier(e)) return;
    // Space on a focused button, switch or link presses it rather than playing
    if (e.code === 'Space' && e.target.closest && e.target.closest('button, a[href], summary, [role="button"], [role="switch"], [role="radio"], [role="checkbox"]')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowLeft' && e.shiftKey) setTime((t) => clamp(t - 1, 0, duration));
    else if (e.code === 'ArrowRight' && e.shiftKey) setTime((t) => clamp(t + 1, 0, duration));
    else if (e.key === '0' || e.code === 'Home') setTime(0);
    else if (e.key === ',' || e.key === '.') {
      e.preventDefault();
      const d = e.key === '.' ? 1 : -1;
      setPlaying(false);
      setTime((t) => clamp((d > 0 ? Math.floor(t * fps + 1e-6) + 1 : Math.ceil(t * fps - 1e-6) - 1) / fps, 0, duration));
    }
  }, { on: !still && !forceVideo }); // not during an export, which seeks the stage itself: a key would put the wrong moment in the file

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

  const frame = React.useMemo(() => ({ w, h, cols, video, text, dock: short, vw: area.vw, vh: area.vh, setContentH }), [w, h, cols, video, text, short, area.vw, area.vh]);
  const ctx = React.useMemo(() => ({ time, duration, playing, setTime, setPlaying, setStart }), [time, duration, playing]);
  // a video fills the area; so does a two-column page; a paused one-column page is as tall as its content (the area scrolls)
  const scrolls = !video && cols === 1;
  // one column keeps room for a classic scrollbar whether or not it shows: the page's height depends on its width, so a
  // width that changed when the bar came and went flipped the bar on and off near the edge (and a video, which has no bar,
  // is as wide as the paused page, which the export's widths assume)
  const fh = scrolls ? Math.max(h, contentH) : h;

  return (
    <div className={'stage' + (cols === 1 ? ' stage-one' : '') + (short ? ' stage-short' : '')}>
      {top}
      <div ref={areaRef} className="stage-area" style={{ overflowY: scrolls ? 'auto' : 'hidden', scrollbarGutter: cols === 1 ? 'stable' : undefined }}>
        <div className="stage-frame" style={{ width: w, height: fh, background, position: 'relative' }}>
          <FrameContext.Provider value={frame}>
            <TimelineContext.Provider value={ctx}>{children}</TimelineContext.Provider>
          </FrameContext.Provider>
        </div>
      </div>
      <PlaybackBar time={time} duration={duration} playing={playing} nav={nav} menu={menu} still={still}
        dock={dock && { left: (area.ox || 0) + dock.x, top: (area.oy || 0) + dock.y, width: dock.w, height: dock.h }}
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

// dock: where the bar sits in the stage when it is in the sidebar (else it runs under the page)
function PlaybackBar({ time, duration, playing, nav, menu, still, dock, onPlayPause, onReset, onSeek }) {
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
    <div className={'pbar part-transport-bar' + (dock ? ' pbar-dock' + (dock.width < 340 ? ' pbar-narrow' : '') : '')} style={dock || undefined}>
      <button type="button" className="pbtn pbtn-end" disabled={nav && nav.current ? !(nav.current.hasFirst != null ? nav.current.hasFirst : nav.current.hasPrev) : still || time <= 0} onClick={still ? () => nav.current.first() : onReset} aria-label="Back to start (Home)" title="Back to start (Home)">
        <svg width="20" height="20" viewBox="0 0 14 14" fill="none"><path d="M3 2v10M12 2L5 7l7 5V2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
      </button>
      {nav && nav.current && (
        <NavButton nav={nav} dir="prev" label="Previous move (←)">
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </NavButton>
      )}
      {!still && (
        <button type="button" className="pbtn" onClick={onPlayPause} aria-label={playing ? 'Pause (space)' : 'Play (space)'} title={playing ? 'Pause (space)' : 'Play (space)'}>
          {playing
            ? <svg width="20" height="20" viewBox="0 0 14 14"><rect x="3" y="2" width="3" height="10" fill="currentColor" /><rect x="8" y="2" width="3" height="10" fill="currentColor" /></svg>
            : <svg width="20" height="20" viewBox="0 0 14 14"><path d="M3 2l9 5-9 5V2z" fill="currentColor" /></svg>}
        </button>
      )}
      {nav && nav.current && (
        <NavButton nav={nav} dir="next" label="Next move (→)">
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </NavButton>
      )}
      {nav && nav.current && (
        <button type="button" className="pbtn pbtn-end" disabled={!nav.current.hasLast} onClick={() => nav.current.last()} aria-label="Last move (End)" title="Last move (End)">
          <svg width="20" height="20" viewBox="0 0 14 14" fill="none"><path d="M11 2v10M2 2l7 5-7 5V2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
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

function CompositionStage({ menu, top, onLayout, scenes, playback, bg, nav, still, forceVideo, text, clock, fps, children }) {
  const parsed = React.useMemo(() => parseScenes(scenes), [scenes]);
  const derived = React.useMemo(() => (parsed ? deriveCues(parsed) : null), [parsed]);
  const pb = React.useMemo(() => { try { return JSON.parse(playback); } catch (e) { return null; } }, [playback]);
  if (!derived) return <div className="stage-error">This game produced an invalid scene list.</div>;
  return (
    <Stage menu={menu} top={top} onLayout={onLayout} duration={derived.total} background={bg} playback={pb} nav={nav} still={still} forceVideo={forceVideo} text={text} clock={clock} fps={fps}>
      <CompositionClock derived={derived}>{children}</CompositionClock>
    </Stage>
  );
}

Object.assign(window, { Easing, clamp, CompositionStage, useComposition, useTimeline, useFrame, isTypingTarget, hasModifier, useKeydown, useDismiss, stageMargins });
