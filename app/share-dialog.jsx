// ---------- Share and export ----------
// The Share and export dialog: the position's FEN, the game's PGN, a browser analysis to download, and the video export
// with its settings (useExportSettings)

// Share and export's copy button: an icon that turns to a tick for 1.5 s once the clipboard has taken text();
// onFail(text) where the clipboard is refused
function CopyButton({ label, text, onFail }) {
  const [done, setDone] = React.useState(false);
  React.useEffect(() => { if (done) { const id = setTimeout(() => setDone(false), 1500); return () => clearTimeout(id); } }, [done]);
  const run = () => {
    const v = text();
    try { navigator.clipboard.writeText(v).then(() => setDone(true), () => onFail(v)); } catch (e) { onFail(v); }
  };
  return (
    <button type="button" className={'twk-btn secondary xfer-copy' + (done ? ' done' : '')} aria-label={label} title={done ? 'Copied' : label} onClick={run}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d={done ? TICK : COPY} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

// The video export's settings, read from the stored ones (a value no longer offered gets the default), the stretch of
// the game to export (clip: plies from -1, the title card, to N, after the end card), and run() to export it: the
// picture board drawn through the sliders first, as an export paints that picture rather than the page's CSS filter.
// M: the game (a new one starts the clip over); MV, TM: the game as the video shows it and its timing; frameW the page's width, for the WebP widths; stem the files' name
function useExportSettings({ t, setTweak, M, MV, TM, frameW, stem, saveFile, pieceSet, boardTheme, boardAdj, soundSet, soundVolume }) {
  const fmtLen = window.ChessCore.fmtLen;
  const exportFps = EXPORT_FPS_OPTIONS.includes(+t.exportFps) ? +t.exportFps : 8;
  // the formats this browser can export (no MP4 or WebM without a video encoder, no WebM without VP9); the stored
  // choice is kept for another browser
  const [webmOk, setWebmOk] = React.useState(WEBM_OK);
  React.useEffect(() => { let on = true; WEBM_EXPORT.then((ok) => on && setWebmOk(ok)); return () => { on = false; }; }, []);
  const formats = VIDEO_EXPORT ? EXPORT_FORMATS.filter((f) => f !== 'WebM' || webmOk) : ['WebP'];
  const exportFormat = formats.includes(t.exportFormat) ? t.exportFormat : formats[0], webp = exportFormat === 'WebP';
  // WebP widths, largest first: the page's own (0, the default), half of it ('Half') and fixed ones below the frame's
  const halfW = Math.round(frameW / 2), wPx = (x) => (x === 'Half' ? halfW : x || frameW), webpPx = (x) => (x === 'Half' ? `${halfW} px (half)` : x ? x + ' px' : `${frameW} px (full)`);
  const webpWidths = [0].concat(WEBP_WIDTHS.filter((x) => x < frameW && x !== halfW), 'Half').sort((a, b) => wPx(b) - wPx(a));
  const webpWidth = webpWidths.includes(t.webpWidth) ? t.webpWidth : webpWidths.includes(+t.webpWidth) ? +t.webpWidth : 0;
  // the old setting was a ratio, 'Full' or 'Half': carry it over once
  React.useEffect(() => { if (t.webpSize !== undefined) { setTweak('webpWidth', t.webpSize === 'Full' ? 0 : 'Half'); setTweak('webpSize', undefined); } }, []);
  const webpQuality = Math.min(WEBP_QUALITY.max, Math.max(WEBP_QUALITY.min, +t.webpQuality || 75));
  const mp4Quality = MP4_QUALITIES.includes(t.mp4Quality) ? t.mp4Quality : 'High';
  const mp4Vfr = t.mp4Vfr === true;
  const video = useVideoExport({ fps: exportFps, format: exportFormat, webp: { width: webpWidth, quality: webpQuality }, mp4Quality, mp4Vfr: mp4Vfr && !webp, stem, save: (name, blob) => saveFile(name, blob, blob.type) });
  // what an export would carry under a non-commercial licence (CC BY-NC-SA): such a video may not be used commercially
  const ncParts = [window.PieceSets.NON_COMMERCIAL.includes(pieceSet.id) && `${pieceSet.name} pieces`, !webp && t.sound !== false && window.Sfx.NON_COMMERCIAL.includes(soundSet) && `${soundSet.replace(/^Lichess /, '')} sounds`].filter(Boolean);
  const ncNote = ncParts.length ? `The ${ncParts.join(' and ')} are under a non-commercial licence (CC BY-NC-SA): a video made with ${ncParts.length > 1 ? 'them' : 'it'} may not be used commercially, on a monetised channel for one, and should credit ${ncParts.length > 1 ? 'them' : 'it'} (Settings › View and Sound name the authors). ` : '';
  // the stretch to export, in plies: from -1 starts on the title card, to N (the ply count) ends after the end card
  const [clip, setClip] = React.useState({ from: -1, to: Infinity });
  React.useEffect(() => { setClip({ from: -1, to: Infinity }); }, [M]);
  const NP = MV.plies.length, clipFrom = Math.min(clip.from, NP - 1), clipTo = Math.max(clipFrom, Math.min(clip.to, NP));
  const clipOpts = React.useMemo(() => {
    const at = window.ChessCore.clipRange(MV, TM), ply = MV.plies.map((p, i) => ({ i, l: label(MV, i), t: at(i, i) }));
    return {
      at, S: window.ChessCore.schedule(MV, window.ChessCore.cues(TM.scenes), TM.d),
      from: [{ i: -1, s: 'Title card · 0:00' }].concat(ply.map((o) => ({ i: o.i, s: `${o.l} · ${fmtLen(o.t.start)}` }))),
      to: ply.map((o) => ({ i: o.i, s: `${o.l} · ${fmtLen(o.t.end)}` })).concat([{ i: NP, s: `End card · ${fmtLen(TM.total)}` }]),
    };
  }, [MV, TM]);
  const clipT = clipOpts.at(clipFrom, clipTo), clipFromOpts = clipOpts.from, clipToOpts = clipOpts.to.filter((o) => o.i >= clipFrom);
  const plyTag = (i) => `${Math.floor((MV.ply0 + i) / 2) + 1}${(MV.ply0 + i) % 2 ? 'b' : 'w'}`;
  const clipSuffix = clipFrom < 0 && clipTo >= NP ? '' : `_${clipFrom < 0 ? 'start' : plyTag(clipFrom)}-${clipTo >= NP ? 'end' : plyTag(clipTo)}`;
  const run = () => window.BoardThemes.render(boardTheme.id, boardAdj).catch(() => null).then(() => video.run({ start: clipT.start, end: clipT.end, suffix: clipSuffix, audio: t.sound === false || webp ? null
    : () => window.Sfx.renderTrack(window.Sfx.fetchSound, soundSet, window.Sfx.track(MV, clipOpts.S, clipT.start, clipT.end), soundVolume, clipT.end - clipT.start) }));
  return { video, exportFps, formats, exportFormat, webp, webpWidths, webpWidth, webpPx, webpQuality, mp4Quality, mp4Vfr, ncNote,
    clipFrom, clipTo, clipFromOpts, clipToOpts, setClip, clipT, clipSuffix, run };
}

// fen: the position's, as it was when the dialog opened; board: a free board (its moves are the PGN), else the loaded
// game's annotated and raw PGN. pgn: { board, saveBoard, annotated, saveAnnotated, raw, saveRaw, saveAnalysis (or null) },
// each text a function. x: useExportSettings. onFail(what) is the copy button's onFail; onReplay replays a board's moves
// as a game; onExport runs the export
function ShareDialog({ fen, board, pgn, x, setTweak, onFail, onReplay, onExport, onClose }) {
  return (
    <DialogBox label="Share and export" className="xfer-box" onClose={onClose}>
      <TweakSection label="FEN">
        <div className="xfer-row">
          <input className="xfer-field" type="text" readOnly value={fen} aria-label="FEN" spellCheck={false} onFocus={(e) => e.target.select()} />
          <CopyButton label="Copy FEN" text={() => fen} onFail={onFail('FEN')} />
        </div>
      </TweakSection>
      <TweakSection label="PGN">
        {board ? (
          <div className="xfer-row">
            <TweakButton secondary label="Download" onClick={pgn.saveBoard} />
            <CopyButton label="Copy PGN" text={pgn.board} onFail={onFail('PGN')} />
          </div>
        ) : <>
          <div className="xfer-row">
            <TweakButton secondary label="Download annotated" onClick={pgn.saveAnnotated} />
            <CopyButton label="Copy annotated PGN" text={pgn.annotated} onFail={onFail('PGN')} />
          </div>
          <div className="xfer-row">
            <TweakButton secondary label="Download raw" onClick={pgn.saveRaw} />
            <CopyButton label="Copy raw PGN" text={pgn.raw} onFail={onFail('PGN')} />
          </div>
          <div className="twk-note">Annotated: the marks, evals, clocks, commentary, Queen’s answers and better lines. Raw: the tags and the moves alone.</div>
        </>}
      </TweakSection>
      {!board && pgn.saveAnalysis && <TweakSection label="Analysis">
        <TweakButton secondary label="Download analysis" onClick={pgn.saveAnalysis} />
      </TweakSection>}
      {!board ? <TweakSection label="Export video">
        {x.formats.length > 1 ? <TweakRadio id="tw-format" label="Export as" value={x.exportFormat} options={x.formats} onChange={(v) => setTweak('exportFormat', v)} />
          : <div className="twk-note">{EXPORT_NO_VIDEO}</div>}
        {x.webp && <>
          <TweakSelect id="tw-webp-width" label="WebP width" value={x.webpPx(x.webpWidth)} options={x.webpWidths.map(x.webpPx)} onChange={(v) => setTweak('webpWidth', x.webpWidths.find((w) => x.webpPx(w) === v))} />
          <TweakSlider id="tw-webp-q" label="WebP quality" value={x.webpQuality} min={WEBP_QUALITY.min} max={WEBP_QUALITY.max} step={WEBP_QUALITY.step} format={(v) => (v >= 100 ? 'Lossless' : v)} onChange={(v) => setTweak('webpQuality', v)} />
        </>}
        {!x.webp && <TweakSelect id="tw-mp4-q" label={`${x.exportFormat} quality`} value={x.mp4Quality} options={MP4_QUALITIES} onChange={(v) => setTweak('mp4Quality', v)} />}
        {!x.webp && <TweakToggle id="tw-mp4-vfr" label="Variable frame rate" info="A frame that doesn’t change (a pause, the title and end cards) isn’t encoded: the frame before is held for its time. The frame rate is then the most frames a second a move’s animation gets. Some players and editors seek a variable-rate video less smoothly." value={x.mp4Vfr} onChange={(v) => setTweak('mp4Vfr', v)} />}
        <TweakSelect id="tw-fps" label={!x.webp && x.mp4Vfr ? 'Export frame rate (at most)' : 'Export frame rate'} value={x.exportFps + ' fps'} options={EXPORT_FPS_OPTIONS.map((f) => f + ' fps')} onChange={(v) => setTweak('exportFps', parseInt(v, 10))} />
        <div className="twk-pair">
          <TweakSelect id="tw-clip-from" label="From" aria="Export from" value={x.clipFromOpts.find((o) => o.i === x.clipFrom).s} options={x.clipFromOpts.map((o) => o.s)} onChange={(v) => x.setClip((c) => ({ ...c, from: x.clipFromOpts.find((o) => o.s === v).i }))} />
          <TweakSelect id="tw-clip-to" label="To" aria="Export to" value={x.clipToOpts.find((o) => o.i === x.clipTo).s} options={x.clipToOpts.map((o) => o.s)} onChange={(v) => x.setClip((c) => ({ ...c, to: x.clipToOpts.find((o) => o.s === v).i }))} />
        </div>
        <TweakButton label={`${x.webp ? 'Export animated WebP (' : `Export video (${x.exportFormat}, `}${!x.webp && x.mp4Vfr ? 'up to ' : ''}${x.exportFps} fps${!x.webp && x.mp4Vfr ? ', variable' : ''}, ${window.ChessCore.fmtLen(x.clipT.end - x.clipT.start)})`} disabled={x.video.busy} onClick={onExport} />
        <div className="twk-note">Renders every frame in this tab: about {window.ChessCore.fmtLen(Math.ceil((x.clipT.end - x.clipT.start) * x.exportFps * 0.04))} for {x.clipSuffix ? 'these moves' : 'this game'}, longer on a phone. Higher frame rates are smoother but slower. Each move’s clip runs from just before it until the board settles. {x.ncNote}{x.webp ? 'No sound, and it loops; a smaller width or quality makes a smaller file, and Lossless a much larger one.' : `Includes move sounds when on; a lower quality makes a smaller file.${x.exportFormat === 'WebM' ? ' Firefox takes about three times as long to encode a WebM as an MP4.' : ''}`}</div>
      </TweakSection> : !window.PlayCore.inProgress(board) && <TweakSection label="Export video">
        <div className="twk-note">{board.steps.length ? 'A video or WebP is made from a loaded game: replay these moves as one, then export it here.' : 'Play some moves first; then they can be replayed as a game and exported as a video.'}</div>
        {board.steps.length > 0 && <TweakButton label="Replay these moves as a game" onClick={onReplay} />}
      </TweakSection>}
      <div className="fen-btns"><button type="button" className="twk-btn secondary" data-autofocus onClick={onClose}>Close</button></div>
    </DialogBox>
  );
}
