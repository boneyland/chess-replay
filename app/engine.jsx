// Continuous-composition animation engine, trimmed from Claude Design's animations-v3.jsx
// for a standalone page: no host timeline, no video export, no watercolor kit.
// The whole video is one element tree rendered as a pure function of authored time T.

const Easing = {
  linear: (t) => t,
  easeOutCubic: (t) => --t * t * t + 1,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeOutBack: (t) => {
    const c1 = 1.70158,
      c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
// How far a seek bar dragged d px past its end stretches: Apple's rubber band, (1 − 1 / (0.55 d / D + 1)) · D, which
// follows the pointer at about half its pace at first and never passes D (px): small, as the time beside the bar moves
// along (the bar sits --pgap from it)
const RUBBER_D = 10;
const rubberBand = (d) => (1 - 1 / ((0.55 * d) / RUBBER_D + 1)) * RUBBER_D;
// the longest glide of a paused playhead out of a move (Stage's settle), and the reduced-motion setting, which jumps instead
const GLIDE_MS = 300;
const REDUCED_MQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

const TimelineContext = React.createContext({ time: 0, duration: 10, playing: false });
const useTimeline = () => React.useContext(TimelineContext);
// what the stage gives its view: the area's size (w, h), the column count the page lays out in (1 or 2), whether it is
// a video (playing, or an export drawing) rather than a paused page, and the text size multiplier.
// A view calls setContentH(h) with the height its layout needs, so a paused one-column page can scroll when it is taller than the area.
// dock: a short two-column window, whose transport bar sits at the foot of the sidebar (LayoutCore's L.dock).
// pinned: a paused one-column page scrolled past its board (setPinAt(y) gives the scroll where that starts, or null).
const FrameContext = React.createContext({
  w: 1440,
  h: 900,
  cols: 2,
  video: false,
  text: 1,
  dock: false,
  pinned: false,
  setContentH: () => {},
  setPinAt: () => {},
});
const useFrame = () => React.useContext(FrameContext);

// ---------- keys ----------
// a key pressed in a text field, a drop-down or an editable box is that control's, not a shortcut
const isTypingTarget = (e) => {
  const t = e.target;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || !!t.isContentEditable);
};
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
    const listen = (e) => {
      if (!e.defaultPrevented && !e.isComposing && (fields || !isTypingTarget(e))) ref.current(e);
    };
    at.addEventListener('keydown', listen);
    return () => at.removeEventListener('keydown', listen);
  }, [on, fields, overlay]);
}

// A menu that closes, while open, on a press outside ref's element, on the focus leaving it (Tab) or on Esc (an
// overlay's, so Esc closes only the menu). Esc from inside the menu (or with the focus nowhere) puts the focus on the
// button that opens it, the first [aria-expanded] in ref's element, which stays when the menu goes
function useDismiss(open, ref, close) {
  const closeRef = React.useRef(close);
  closeRef.current = close;
  useKeydown(
    (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const a = document.activeElement,
          el = ref.current,
          btn = el && el.querySelector('[aria-expanded]');
        if (btn && (el.contains(a) || !a || a === document.body)) btn.focus();
        close();
      }
    },
    { on: open, fields: true, overlay: true },
  );
  React.useEffect(() => {
    if (!open) return;
    const el = ref.current;
    const away = (e) => {
      if (ref.current && !ref.current.contains(e.target)) closeRef.current();
    };
    // a press elsewhere moves the focus with no relatedTarget (Safari focuses no button), which pointerdown handles
    const out = (e) => {
      if (e.relatedTarget && !el.contains(e.relatedTarget)) closeRef.current();
    };
    document.addEventListener('pointerdown', away);
    if (el) el.addEventListener('focusout', out);
    return () => {
      document.removeEventListener('pointerdown', away);
      if (el) el.removeEventListener('focusout', out);
    };
  }, [open, ref]);
}

// Rendered first inside the element of something that opens over the page (a dialog, Settings): it notes the control
// that had the focus as that opened (in render, before an effect inside moves it) and, as it closes (a layout effect's
// cleanup, which runs while that element is still in the page), gives the focus back there. Modal (a dialog), whenever
// the focus was inside or nowhere (Safari focuses no button on a click; a button disabled while it works drops it), as
// a native dialog does; else (Settings) only when a keyboard user's focus was inside, so after a click Space still
// plays. Where that control no longer shows (a menu item, gone with its menu), GameApp hears chess-video:focus-lost
// and puts the focus on Menu
function ReturnFocus({ modal = false }) {
  const [from] = React.useState(() => document.activeElement);
  const mark = React.useRef(null);
  React.useLayoutEffect(() => {
    const box = mark.current.parentElement;
    return () => {
      const a = document.activeElement;
      // not modal (Settings): only a keyboard user's focus (a clicked ✕ holds the focus too, without a ring)
      if (modal ? !box.contains(a) && a && a !== document.body : !box.contains(a) || !a.matches(':focus-visible'))
        return;
      if (from && from !== document.body && from.isConnected && !box.contains(from) && from.getClientRects().length)
        from.focus();
      else window.dispatchEvent(new CustomEvent('chess-video:focus-lost'));
    };
  }, [modal, from]);
  return <span ref={mark} hidden />;
}

// still: a board without a timeline (the free board): no playing, no seeking keys, and a transport bar of moves only
// the page's own margins above and below the frame, which an export keeps (export.jsx): the stage's padding and, above,
// the area's (one column's); not the transport bar and its gap, nor an Offline tag. area: the .stage-area element
const stageMargins = (area) => {
  const s = getComputedStyle(area.parentElement),
    a = getComputedStyle(area),
    n = (v) => parseFloat(v) || 0;
  return { top: n(s.paddingTop) + n(a.paddingTop), bottom: n(s.paddingBottom) };
};

// top: an optional line above the frame (the page's Offline tag); the page lays out at the size of the room left
// fps: the export's frame rate, the step of the , and . keys
// dockExtra: the width of the buttons GameApp adds to the docked bar (menu), which it takes from the room the first and
// last move buttons need
function Stage({
  menu,
  dockExtra = 0,
  top,
  onLayout,
  duration,
  background,
  playback,
  nav,
  still,
  forceVideo,
  text = 1,
  clock,
  fps = 8,
  children,
}) {
  const playTimes = playback && playback.mode === 'times' ? playback.count : null;
  const loop = !playback || playback.mode === 'loop';
  // The page opens paused on the composition's start frame (setStart); the first Play from that untouched frame
  // starts the video from 0:00, the title card
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const timeRef = React.useRef(0),
    playingRef = React.useRef(false),
    freshRef = React.useRef(null);
  timeRef.current = time;
  playingRef.current = playing;
  if (clock) clock.current = { time };
  // A glide of the paused playhead to a settled frame (settle), cancelled by anything else that moves it: seek is the
  // setTime for those (the timeline's own, as views see it)
  const glideRef = React.useRef(null);
  const stopGlide = () => {
    if (glideRef.current) cancelAnimationFrame(glideRef.current);
    glideRef.current = null;
  };
  React.useEffect(() => stopGlide, []);
  const seek = React.useCallback((t) => {
    stopGlide();
    setTime(t);
  }, []);
  // the views' play/pause (a tap on the board, a line picked): it stops a glide too, which would otherwise carry the
  // playhead on past a move's start and undo what the view just opened there
  const play = React.useCallback((p) => {
    stopGlide();
    setPlaying(p);
  }, []);
  const setStart = React.useCallback(
    (t) => {
      seek(t);
      freshRef.current = t;
    },
    [seek],
  );
  // the view's snap(T, dir): the settled time a paused playhead at T should glide to, or null (settleTo in chess-core.js)
  const snapRef = React.useRef(null);
  // after the viewer lets go of the seek bar, seeks by keys or pauses: a playhead left inside a move glides out of it,
  // eased over at most GLIDE_MS; reduced motion jumps. Never in an export or while playing
  const settle = (t, dir) => {
    const to = !playingRef.current && !forceVideo && snapRef.current ? snapRef.current(t, dir) : null;
    if (to == null) return;
    stopGlide();
    const d = to - t;
    if (REDUCED_MQ && REDUCED_MQ.matches) {
      setTime(to);
      return;
    }
    const ms = clamp(Math.abs(d) * 500, 120, GLIDE_MS);
    let t0 = null;
    const tick = (ts) => {
      if (t0 == null) t0 = ts;
      const k = Math.min(1, (ts - t0) / ms);
      setTime(k >= 1 ? to : t + d * Easing.easeOutCubic(k));
      glideRef.current = k >= 1 ? null : requestAnimationFrame(tick);
    };
    glideRef.current = requestAnimationFrame(tick);
  };
  const togglePlay = () => {
    stopGlide();
    if (!playingRef.current && freshRef.current != null && Math.abs(timeRef.current - freshRef.current) < 1e-6)
      setTime(0);
    freshRef.current = null;
    // paused mid-move, the piece finishes its move
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      settle(timeRef.current, 1);
    } else setPlaying(true);
  };
  const [area, setArea] = React.useState({ w: 1440, h: 900, cols: 2, sh: 900, vw: 1440, vh: 900 });
  const [contentH, setContentHRaw] = React.useState(0);
  const areaRef = React.useRef(null);
  // the scrolled page's floor (keep): the bottom of the window (in the frame: the area runs on under the transport bar,
  // past the frame's h) as the content was last measured, so content that gets
  // shorter (the Analysis panel while a picked line loads) doesn't pull the page up under the viewer and unpin the
  // board; scrolling up gives the room back (the scroll listener below)
  const [keep, setKeep] = React.useState(0);
  const keepRef = React.useRef(0);
  const holdKeep = React.useCallback((k) => {
    if (keepRef.current === k) return;
    keepRef.current = k;
    setKeep(k);
  }, []);
  const setContentH = React.useCallback(
    (v) => {
      const el = areaRef.current;
      if (el && el.scrollTop > 0) holdKeep(Math.ceil(el.scrollTop + hRef.current));
      setContentHRaw(v);
    },
    [holdKeep],
  );
  const colsRef = React.useRef(null); // the last column count, for the switch's hysteresis
  React.useEffect(() => {
    if (still) setPlaying(false);
  }, [still]);
  // a schedule that got shorter (a setting, commentary turned off) while the playhead was near the end: back onto it
  React.useEffect(() => {
    setTime((t) => (t > duration ? duration : t));
  }, [duration]);
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
      const cs = getComputedStyle(el),
        px = (k) => parseFloat(cs[k]) || 0;
      const w = el.clientWidth - px('paddingLeft') - px('paddingRight'),
        h = el.clientHeight - px('paddingTop') - px('paddingBottom');
      const sh = el.parentElement.clientHeight,
        sw = el.parentElement.clientWidth,
        ox = el.offsetLeft,
        oy = el.offsetTop,
        m = stageMargins(el),
        my = m.top + m.bottom;
      // the viewport, which caps the board's size (LayoutCore)
      const vw = document.documentElement.clientWidth,
        vh = document.documentElement.clientHeight;
      const cols = LayoutCore.pickColumns({ w, h, vw, vh, text, video, was: colsRef.current, off });
      colsRef.current = cols;
      setArea((a) =>
        a.w === w &&
        a.h === h &&
        a.cols === cols &&
        a.sh === sh &&
        a.sw === sw &&
        a.vw === vw &&
        a.vh === vh &&
        a.ox === ox &&
        a.oy === oy &&
        a.my === my
          ? a
          : { w, h, cols, sh, sw, vw, vh, ox, oy, my },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, video]);
  const { w, h, cols, sh } = area;
  const hRef = React.useRef(h);
  hRef.current = h;
  // a short two-column window (a phone held sideways): the transport bar goes in the sidebar, under the panels, so the
  // board gets the whole height; it is placed over the area at the box the layout keeps for it. There it always folds
  // its buttons into the menu, however wide the window (a large phone is 932 px wide on its side)
  const short = cols === 2 && sh < 500;
  const narrow = w < 900,
    phone = cols === 1 || narrow || short;
  const dock = short
    ? LayoutCore.compute({ w, h, text, video, cols, dock: true, vw: area.vw, vh: area.vh }).dock
    : null;
  // tiny: a short window under the full-screen height (LayoutCore.DOCK_FULL_H), its browser's bars showing
  const tiny = short && h < LayoutCore.DOCK_FULL_H;
  // the export's pixel width: the viewport's width at the device's pixel ratio, held to 1920 on its longer side (the
  // frame's height and the page's margins above and below it, export.jsx)
  const exportW = LayoutCore.exportPx(
    area.vw,
    LayoutCore.exportScale(area.vw, h + (area.my || 0), window.devicePixelRatio),
  );
  // onLayout(true, w, short, tiny): a phone layout (one column, under 900 px wide, or the bar in the sidebar), where the page folds its buttons into a
  // menu; w is the export's width; short: the transport bar is in the sidebar; tiny: and the stage is under DOCK_FULL_H
  React.useLayoutEffect(() => {
    if (onLayout) onLayout(phone, exportW, short, tiny);
  }, [onLayout, phone, exportW, short, tiny]);

  React.useEffect(() => {
    if (!playing) {
      lastTsRef.current = null;
      return;
    }
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
            if (passesRef.current >= playTimes) {
              next = duration;
              setPlaying(false);
            } else next = next % duration;
          } else if (loop) next = next % duration;
          else {
            next = duration;
            setPlaying(false);
          }
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      lastTsRef.current = null;
    };
  }, [playing, duration, loop, playTimes]);

  // Keyboard: space = play/pause, shift+arrows = seek 1 s (plain arrows are claimed by the views, which step moves), 0/Home = start,
  // , and . = pause and step one export frame (the times an export from 0:00 draws; from between two, to the one on that side)
  useKeydown(
    (e) => {
      if (hasModifier(e)) return;
      // Space on a focused button, switch or link presses it rather than playing
      if (
        e.code === 'Space' &&
        e.target.closest &&
        e.target.closest(
          'button, a[href], summary, [role="button"], [role="switch"], [role="radio"], [role="checkbox"]',
        )
      )
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && e.shiftKey) {
        const d = e.code === 'ArrowRight' ? 1 : -1,
          t = clamp(timeRef.current + d, 0, duration);
        seek(t);
        settle(t, d);
      } else if (e.key === '0' || e.code === 'Home') seek(0);
      else if (e.key === ',' || e.key === '.') {
        e.preventDefault();
        const d = e.key === '.' ? 1 : -1;
        setPlaying(false);
        stopGlide();
        setTime((t) =>
          clamp((d > 0 ? Math.floor(t * fps + 1e-6) + 1 : Math.ceil(t * fps - 1e-6) - 1) / fps, 0, duration),
        );
      }
    },
    { on: !still && !forceVideo },
  ); // not during an export, which seeks the stage itself: a key would put the wrong moment in the file

  // Page controls outside the stage (Queen panel, video export) pause and seek through this event;
  // `sync` renders the new frame before dispatchEvent returns, so the export can draw it straight away
  React.useEffect(() => {
    const onSeek = (e) => {
      const go = () => {
        play(false);
        if (e.detail && isFinite(e.detail.time)) seek(clamp(e.detail.time, 0, duration));
      };
      if (e.detail && e.detail.sync) ReactDOM.flushSync(go);
      else go();
    };
    window.addEventListener('chess-video:seek', onSeek);
    return () => window.removeEventListener('chess-video:seek', onSeek);
  }, [duration, seek, play]);

  // the paused one-column page pins a smaller board at the top once scrolled past pinAt (LayoutCore's L.flow.pinAt, which
  // the view reports through setPinAt); only the crossing re-renders
  const [pinAt, setPinAt] = React.useState(null);
  const [past, setPast] = React.useState(false),
    [moved, setMoved] = React.useState(false);
  const pinnable = !video && cols === 1 && pinAt != null;
  React.useEffect(() => {
    const el = areaRef.current;
    if (!pinnable || !el) return;
    const check = () => {
      setPast(el.scrollTop > pinAt);
      setMoved(el.scrollTop > 0);
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    return () => el.removeEventListener('scroll', check);
  }, [pinnable, pinAt]);
  const pinned = pinnable && past,
    scrolled = pinnable && moved;
  const frame = React.useMemo(
    () => ({ w, h, cols, video, text, dock: short, vw: area.vw, vh: area.vh, pinned, scrolled, setContentH, setPinAt }),
    [w, h, cols, video, text, short, area.vw, area.vh, pinned, scrolled, setContentH],
  );
  const ctx = React.useMemo(
    () => ({ time, duration, playing, setTime: seek, setPlaying: play, setStart, snap: snapRef }),
    [time, duration, playing, seek, play, setStart],
  );
  // a video fills the area; so does a two-column page; a paused one-column page is as tall as its content (the area scrolls)
  const scrolls = !video && cols === 1;
  // one column keeps room for a classic scrollbar whether or not it shows: the page's height depends on its width, so a
  // width that changed when the bar came and went flipped the bar on and off near the edge (and a video, which has no bar,
  // is as wide as the paused page, which the export's widths assume)
  // a page that scrolls at all can scroll on to where the board pins (pinAt, with a pixel or two to spare for the settle's
  // pinAt + 1), even if its content ends sooner: the blank under the last panel is the price of never being left
  // part-way through the shrink with nowhere to settle (BoardGroup)
  const base = !scrolls
    ? h
    : pinnable && contentH > h + 1
      ? Math.max(contentH, h + Math.ceil(pinAt) + 3)
      : Math.max(h, contentH);
  const fh = scrolls ? Math.max(base, keep) : h;
  const baseRef = React.useRef(base);
  baseRef.current = base;
  // the floor goes as the viewer scrolls up past it, and with a new window size or a video (playing, exporting)
  React.useEffect(() => {
    const el = areaRef.current;
    if (!scrolls || !el) return;
    const up = () => {
      const k = keepRef.current,
        bottom = Math.ceil(el.scrollTop + h);
      if (k > baseRef.current && bottom < k) holdKeep(bottom > baseRef.current ? bottom : 0);
    };
    el.addEventListener('scroll', up, { passive: true });
    return () => {
      el.removeEventListener('scroll', up);
      holdKeep(0);
    };
  }, [scrolls, w, h, holdKeep]);

  return (
    <div
      className={
        'stage' + (cols === 1 ? ' stage-one' : '') + (short ? ' stage-short' : '') + (scrolls ? ' stage-under' : '')
      }
    >
      {top}
      <div
        ref={areaRef}
        role="main"
        className="stage-area"
        style={{ overflowY: scrolls ? 'auto' : 'hidden', scrollbarGutter: cols === 1 ? 'stable' : undefined }}
      >
        <div className="stage-frame" style={{ width: w, height: fh, background, position: 'relative' }}>
          <FrameContext.Provider value={frame}>
            <TimelineContext.Provider value={ctx}>{children}</TimelineContext.Provider>
          </FrameContext.Provider>
        </div>
      </div>
      <PlaybackBar
        time={time}
        duration={duration}
        playing={playing}
        nav={nav}
        menu={menu}
        still={still}
        dock={dock && dockBox(dock, area, dockExtra)}
        onPlayPause={togglePlay}
        onReset={() => seek(0)}
        onSeek={seek}
        onSettle={settle}
      />
    </div>
  );
}

// Holding a move button steps like holding its arrow key: one step, then after a pause a quick repeat
const HOLD_DELAY_MS = 500,
  HOLD_REPEAT_MS = 35;
function NavButton({ nav, dir, label, children }) {
  const timer = React.useRef(null);
  const has = dir === 'prev' ? 'hasPrev' : 'hasNext';
  const stop = () => {
    clearTimeout(timer.current);
    timer.current = null;
  };
  React.useEffect(() => stop, []);
  const step = () => {
    const n = nav.current;
    if (!n || !n[has]) {
      stop();
      return false;
    }
    n[dir]();
    return true;
  };
  const repeat = () => {
    if (step()) timer.current = setTimeout(repeat, HOLD_REPEAT_MS);
  };
  return (
    <button
      type="button"
      className="pbtn pnav"
      disabled={!nav.current[has]}
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        stop();
        step();
        timer.current = setTimeout(repeat, HOLD_DELAY_MS);
        // it can turn disabled under the pointer (the first or last move), and a disabled button gets no pointerup
        const end = () => {
          stop();
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
        };
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
      }}
      onPointerLeave={stop}
      onContextMenu={(e) => e.preventDefault()} // a long press on a phone
      onClick={(e) => {
        if (e.detail === 0) step();
      }}
    >
      {/* Enter or Space; a pointer already stepped on its press */}
      {children}
    </button>
  );
}

const markPointer = (e) => {
  const d = e.currentTarget.dataset;
  if (e.pointerType === 'mouse') d.mouse = '1';
  else delete d.mouse;
  // data-press while a pointer holds a button down (its press tint): not CSS :active, which Firefox for Android leaves on
  // a button tapped twice quickly. On the window, as a button turned disabled under the pointer gets no pointerup
  const btn = e.type === 'pointerdown' && e.target.closest('button');
  if (!btn || btn.disabled) return;
  btn.dataset.press = '1';
  const end = () => {
    delete btn.dataset.press;
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
};

// the bar's box in the sidebar (the stage's coordinates): from the layout's L.dock out to the stage's right and bottom
// edges, the screen's, its glass running under the stage's padding and the safe area there; --dock-er (shell.html) pads
// its items in from the right, clear of a cut-out. narrow: L.dock's own width under what the bar's buttons need, extra
// (px) more where GameApp adds buttons to it
function dockBox(dock, area, extra = 0) {
  const left = (area.ox || 0) + dock.x,
    top = (area.oy || 0) + dock.y;
  const width = Math.max(dock.w, (area.sw || 0) - left),
    height = Math.max(dock.h, (area.sh || 0) - top);
  return { left, top, width, height, '--dock-er': `${width - dock.w}px`, narrow: dock.w < 340 + extra };
}
// dock: where the bar sits in the stage when it is in the sidebar (else it runs under the page)
function PlaybackBar({ time, duration, playing, nav, menu, still, dock, onPlayPause, onReset, onSeek, onSettle }) {
  const trackRef = React.useRef(null);
  const dragging = React.useRef(false);
  // the time last dragged to: a pointerup can come before the render of the last pointermove, so the prop may lag
  const dragT = React.useRef(0);
  // the video calls nav.listen when its move label changes while the playhead is still (stepping through a line)
  const [, redraw] = React.useState(0);
  React.useEffect(() => {
    if (!nav) return;
    nav.listen = () => redraw((x) => x + 1);
    return () => {
      nav.listen = null;
    };
  }, [nav]);
  // a drag past either end stretches the bar that way with less and less give, the time on that side moving with it
  // (over: px, < 0 past the start; w: the track's width), and it springs back on letting go
  const [over, setOver] = React.useState({ px: 0, w: 1, side: 1 });
  const timeAt = (e) => {
    const r = trackRef.current.getBoundingClientRect(),
      f = (e.clientX - r.left) / r.width;
    let past = f < 0 ? f * r.width : f > 1 ? (f - 1) * r.width : 0;
    const side = past < 0 ? trackRef.current.previousElementSibling : trackRef.current.nextElementSibling;
    // only where the time sits beside the bar to move along: elsewhere (a phone) a button does, which the knob would cover
    if (!(side && side.classList.contains('ptime') && side.getClientRects().length)) past = 0;
    const px = Math.sign(past) * rubberBand(Math.abs(past));
    setOver((o) => (o.px === px && o.w === r.width ? o : { px, w: r.width, side: px ? Math.sign(px) : o.side }));
    return clamp(f, 0, 1) * duration;
  };
  const letGo = () => setOver((o) => (o.px ? { ...o, px: 0 } : o));
  const stretch = over.px ? { transform: `scaleX(${(over.w + Math.abs(over.px)) / over.w})` } : { transform: 'none' };
  stretch.transformOrigin = over.side < 0 ? 'right' : 'left';
  const pct = duration > 0 ? (time / duration) * 100 : 0;
  // spoken: "1 minute 5 seconds"
  const say = (t) => {
    const m = Math.floor(Math.max(0, t) / 60),
      x = Math.floor(Math.max(0, t) % 60);
    return (m ? `${m} minute${m === 1 ? '' : 's'} ` : '') + `${x} second${x === 1 ? '' : 's'}`;
  };
  const fmt = (t) => {
    const x = Math.max(0, t);
    return `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}.${String(Math.floor((x * 100) % 100)).padStart(2, '0')}`;
  };
  return (
    // data-mouse while the last pointer over the bar is a mouse: the buttons' hover tint keys on it, not on CSS's hover media,
    // as a tapped button keeps :hover and some touch browsers (and touch laptops) report a hover-capable pointer
    <div
      className={'pbar part-transport-bar' + (dock ? ' pbar-dock' + (dock.narrow ? ' pbar-narrow' : '') : '')}
      role="region"
      aria-label="Playback"
      style={dock ? { ...dock, narrow: undefined } : undefined}
      onPointerOver={markPointer}
      onPointerDown={markPointer}
    >
      <button
        type="button"
        className="pbtn pbtn-end"
        disabled={
          nav && nav.current
            ? !(nav.current.hasFirst != null ? nav.current.hasFirst : nav.current.hasPrev)
            : still || time <= 0
        }
        onClick={still ? () => nav.current.first() : onReset}
        aria-label="Back to start (Home)"
        title="Back to start (Home)"
      >
        <svg width="24" height="24" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 2v10M12 2L5 7l7 5V2z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {nav && nav.current && (
        <NavButton nav={nav} dir="prev" label="Previous move (←)">
          <svg width="28" height="28" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 3L5 8l5 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </NavButton>
      )}
      {!still && (
        <button
          type="button"
          className="pbtn pbtn-play"
          onClick={onPlayPause}
          aria-label={playing ? 'Pause (space)' : 'Play (space)'}
          title={playing ? 'Pause (space)' : 'Play (space)'}
        >
          {playing ? (
            <svg width="24" height="24" viewBox="0 0 14 14">
              <rect x="3" y="2" width="3" height="10" fill="currentColor" />
              <rect x="8" y="2" width="3" height="10" fill="currentColor" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 14 14">
              <path d="M3.7 2l9 5-9 5V2z" fill="currentColor" />
            </svg>
          )}
        </button>
      )}
      {nav && nav.current && (
        <NavButton nav={nav} dir="next" label="Next move (→)">
          <svg width="28" height="28" viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </NavButton>
      )}
      {nav && nav.current && (
        <button
          type="button"
          className="pbtn pbtn-end"
          disabled={!nav.current.hasLast}
          onClick={() => nav.current.last()}
          aria-label="Last move (End)"
          title="Last move (End)"
        >
          <svg width="24" height="24" viewBox="0 0 14 14" fill="none">
            <path
              d="M11 2v10M2 2l7 5-7 5V2z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
      {nav && nav.current && (
        <span className="plabel" style={{ color: nav.current.color }} aria-live="polite">
          {nav.current.label}
        </span>
      )}
      {still ? (
        <span className="pspacer" />
      ) : (
        <React.Fragment>
          <span className="ptime" style={{ translate: `${Math.min(0, over.px)}px 0` }}>
            {fmt(time)}
          </span>
          <div
            ref={trackRef}
            className="ptrack"
            role="slider"
            tabIndex={0}
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${say(time)} of ${say(duration)}`}
            onKeyDown={(e) => {
              // focused, the arrows move the playhead by seconds rather than stepping through the moves
              const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[
                e.key
              ];
              const to =
                step != null
                  ? time + step * (e.shiftKey ? 5 : 1)
                  : e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? duration
                      : null;
              if (to == null || e.altKey || e.metaKey || e.ctrlKey) return;
              e.preventDefault();
              e.stopPropagation();
              onSeek(clamp(to, 0, duration));
              if (step != null) onSettle(clamp(to, 0, duration), Math.sign(step));
            }}
            onPointerDown={(e) => {
              dragging.current = true;
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch (err) {}
              dragT.current = timeAt(e);
              onSeek(dragT.current);
            }}
            onPointerMove={(e) => {
              if (!dragging.current) return;
              dragT.current = timeAt(e);
              onSeek(dragT.current);
            }}
            onPointerUp={() => {
              // let go inside a move: on or back, whichever side of its slide's middle the piece is. From the time last
              // dragged to, not the pointerup's place (iOS has given a touch's at 0,0)
              if (dragging.current) onSettle(dragT.current, 0);
              dragging.current = false;
              letGo();
            }}
            onPointerCancel={() => {
              // the browser took the touch over (a scroll): settle as a let-go would
              if (dragging.current) onSettle(dragT.current, 0);
              dragging.current = false;
              letGo();
            }}
            data-stretch={over.px ? '1' : undefined}
          >
            <div className="ptrack-bg" style={stretch} />
            <div className="ptrack-fill" style={{ width: `${pct}%`, ...stretch }} />
            <div className="ptrack-knob" style={{ left: `${pct}%`, translate: `${over.px}px 0` }} />
          </div>
          <span className="ptime ptime-total" style={{ translate: `${Math.max(0, over.px)}px 0` }}>
            {fmt(duration)}
          </span>
        </React.Fragment>
      )}
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
  } catch (e) {
    return null;
  }
}
function deriveCues(scenes) {
  let start = 0;
  const table = {},
    sections = [];
  scenes.forEach((s) => {
    sections.push({ name: s.name, start, dur: s.dur });
    if (!(s.name in table)) table[s.name] = Math.round(start * 1000) / 1000;
    start += s.dur;
  });
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
  const value = React.useMemo(
    () => ({
      T,
      CUES: derived.table,
      time: tl.time,
      duration: tl.duration,
      authoredTotal: derived.total,
      playing: tl.playing,
    }),
    [T, derived, tl.time, tl.duration, tl.playing],
  );
  return <CompositionContext.Provider value={value}>{children}</CompositionContext.Provider>;
}

function CompositionStage({
  menu,
  dockExtra,
  top,
  onLayout,
  scenes,
  playback,
  bg,
  nav,
  still,
  forceVideo,
  text,
  clock,
  fps,
  children,
}) {
  const parsed = React.useMemo(() => parseScenes(scenes), [scenes]);
  const derived = React.useMemo(() => (parsed ? deriveCues(parsed) : null), [parsed]);
  const pb = React.useMemo(() => {
    try {
      return JSON.parse(playback);
    } catch (e) {
      return null;
    }
  }, [playback]);
  if (!derived) return <div className="stage-error">This game produced an invalid scene list.</div>;
  return (
    <Stage
      menu={menu}
      dockExtra={dockExtra}
      top={top}
      onLayout={onLayout}
      duration={derived.total}
      background={bg}
      playback={pb}
      nav={nav}
      still={still}
      forceVideo={forceVideo}
      text={text}
      clock={clock}
      fps={fps}
    >
      <CompositionClock derived={derived}>{children}</CompositionClock>
    </Stage>
  );
}

Object.assign(window, {
  Easing,
  clamp,
  CompositionStage,
  useComposition,
  useTimeline,
  useFrame,
  isTypingTarget,
  hasModifier,
  useKeydown,
  useDismiss,
  ReturnFocus,
  stageMargins,
});
