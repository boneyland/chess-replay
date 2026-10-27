// ---------- move sounds ----------
const sfxPlayer = window.Sfx.createPlayer(window.SFX_DATA || {});

// A sound when a piece lands: in playback, stepping through the game, and on the moves of a line shown on the board.
// Silent while exporting (the export steps through the player) and when a new game loads.
function useMoveSounds(M, T, S, tw, playing, vline) {
  const on = tw.sound !== false && !tw.exporting;
  const ply = window.Sfx.landed(T, S);
  const step = vline && vline.upto >= 0 ? vline.moves[vline.upto] : null;
  const lineKey = step ? `${vline.at}:${vline.upto}:${step.uci}` : null;
  const prev = React.useRef({ M, ply, lineKey });
  React.useEffect(() => { sfxPlayer.prepare(tw.soundSet); }, [tw.soundSet]);
  React.useEffect(() => {
    const p = prev.current;
    prev.current = { M, ply, lineKey };
    if (!on || p.M !== M) return;
    if (lineKey) { if (lineKey !== p.lineKey) sfxPlayer.play(tw.soundSet, window.Sfx.kinds(step.san), tw.soundVolume); return; }
    const c = window.Sfx.cue(M, p.ply, ply, playing);
    if (c) sfxPlayer.play(tw.soundSet, c.kinds, tw.soundVolume, c.end);
  }, [M, ply, lineKey]);
}

// the speaker in the transport bar (in the folded menu when the bar is in the sidebar): move sounds on or off
function SoundButton({ on, onChange, className = 'pbtn' }) {
  const label = on ? 'Mute move sounds' : 'Turn move sounds on';
  return (
    <button type="button" className={className} onClick={() => onChange(!on)} aria-label={label} title={label} aria-pressed={!on}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 6h3l4-3v10l-4-3H2V6z" fill="currentColor" />
        {on
          ? <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          : <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
      </svg>
    </button>
  );
}
