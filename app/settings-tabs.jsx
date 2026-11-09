// ---------- Settings ----------
// The Settings panel's tabs and the Analysis panel's engine settings, drawn from GameApp's state: each takes the settings
// (t, setTweak) and what else it shows or changes as props

// The Analysis panel's engine menu (EngineMenuContext): the Lite/Full choice in its title row, and these settings in
// the panel while the menu is open; the explanations sit behind ⓘ. A game has no engine menu. They are the live
// searches' (your moves, the free board, Go deeper); the game analysis has its own, in GameAnalysisDialog.
// full: the full engine's download (useFullEngine); ES the engine settings in use (AnalysisCore.engineSettings);
// hash: { choices, note, clearNote }, the hash sizes this device can give; board: a free board
function EngineSettings({ t, setTweak, full, ES, sfKind, threading, hash, board }) {
  // Remove the full engine asks first (getting it back is another 99 MB); answering it, or any change to the download,
  // drops the question (a removal that fails leaves the engine kept, and says why)
  const [askRemove, setAskRemove] = React.useState(false);
  React.useEffect(() => setAskRemove(false), [full.state]);
  const SF_KEYS = ['sfOwnDepth', 'sfOwnTime', 'sfLines', 'sfHash', 'sfThreads'];
  const sfChanged = JSON.stringify(ES.own) !== JSON.stringify(window.AnalysisCore.engineSettings(window.TWEAK_DEFAULTS, sfKind, threading, hash.choices).own);
  const MB = keptMB(full.total), stopsAt = 'Each search stops at its depth or time limit, whichever comes first.';
  return <>
    {!SF_SIMD && <div className="twk-note twk-err">{SF_ASM_NOTE}</div>}
    {full.offered && <>
      {t.sfEngine === 'Full' && full.state === 'absent' && <TweakButton label={`Download full Stockfish · ${MB} MB`} onClick={full.download}
        info={`Full Stockfish 19 is stronger than Lite, with the big neural network. It is a ${MB} MB download from unpkg.com, kept in this browser for next time and offline. Until it is downloaded, Lite runs.`} />}
      {full.state === 'downloading' && <>
        <KeptProgress what="full Stockfish" got={full.got} total={full.total} />
        <TweakButton secondary label="Cancel the download" onClick={full.cancel} />
      </>}
      {full.err && <div className="twk-note twk-err">{full.err}</div>}
      {full.state === 'ready' && (askRemove ? <>
        <KeptRemoveAsk what="full engine" total={full.total} />
        <div className="twk-pair">
          <TweakButton danger label="Remove" onClick={() => { setAskRemove(false); full.remove(); }} />
          <TweakButton secondary label="Keep" onClick={() => setAskRemove(false)} />
        </div>
      </> : <TweakButton secondary label={`Remove the full engine download · ${MB} MB`} onClick={() => setAskRemove(true)}
        info={`Full Stockfish is kept in this browser (${MB} MB) and takes a few seconds to start. It reaches less depth than Lite in the same time but judges positions better.`} />)}
    </>}
    <TweakSlider id="tw-sf-odepth" label="Your moves: depth" value={ES.own.depth} stops={window.AnalysisCore.DEPTHS} format={sfDepthText} onChange={(v) => setTweak('sfOwnDepth', v)} info={`For the moves you play on the board${board ? ': on the free board every move is rated with these' : ''}; Go deeper starts from them. ${stopsAt}`} />
    <TweakSlider id="tw-sf-otime" label="Your moves: time limit per position" value={ES.own.time_limit} stops={window.AnalysisCore.SECONDS} unit="s" onChange={(v) => setTweak('sfOwnTime', v)} info={`For the moves you play on the board. ${stopsAt}`} />
    <TweakSelect id="tw-sf-lines" label="Lines" value={String(ES.own.lines)} options={window.AnalysisCore.LINES.map(String)} onChange={(v) => setTweak('sfLines', parseInt(v, 10))}
      info="For the moves you play and for Go deeper. Above one, Stockfish shows that many best moves, with an arrow each, and Go deeper on a move of an analysed game shows and writes into the annotated PGN that many lines. Every line takes its share of the search, so each one goes less deep in the same time." />
    <SfHashSelect id="tw-sf-hash" value={ES.own.hash_mb} hash={hash} onChange={(v) => setTweak('sfHash', v)} />
    <SfThreadsSelect id="tw-sf-threads" value={ES.own.threads} threading={threading} onChange={(v) => setTweak('sfThreads', v)} />
    {sfChanged && <TweakButton secondary label="Reset engine settings" onClick={() => SF_KEYS.forEach((k) => setTweak(k, window.TWEAK_DEFAULTS[k]))} />}
    {!board && <div className="twk-note">Analysing the whole game has its own settings, under the computer button by the engine.</div>}
    <div className="twk-note">Stockfish is free software under the GPL-3.0; <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">source</a>.</div>
  </>;
}
const sfDepthText = (d) => (d == null ? 'No limit' : String(d));
// Hash table and Threads, for the live searches (the engine menu) and the game analysis (its dialog) alike
function SfHashSelect({ id, value, hash, onChange }) {
  return <>
    <TweakSelect id={id} label="Hash table" value={value + ' MB'} options={hash.choices.map((x) => x + ' MB')} onChange={(v) => { hash.clearNote(); onChange(parseInt(v, 10)); }}
      info={`Helps long searches${SF_HASH_CHOICES.length < window.AnalysisCore.HASH_MB.length ? '; larger sizes aren’t offered on this device, a touchscreen with no mouse or touchpad, or short of memory' : '; a big table on a device short of memory falls back to 64 MB'}.`} />
    {hash.note && <div className="twk-note twk-err" role="status">{hash.note}</div>}
  </>;
}
// sfThreads and sfGameThreads null (the default): half the cores, at most 4
function SfThreadsSelect({ id, value, threading, onChange }) {
  return <>
    <TweakSelect id={id} label="Threads" value={String(value)} options={window.AnalysisCore.threadChoices(threading.cores).map(String)} disabled={!threading.on} onChange={(v) => onChange(parseInt(v, 10))}
      info="How many of your processor’s threads Stockfish uses. More threads let it look at more positions in the same time, which helps most in sharp positions, but keep your computer busier." />
    {!threading.on && <div className="twk-note">{threading.reason}</div>}
  </>;
}

// Analyse the game (the Analysis panel's computer button, and the empty panel's Analyse with Stockfish): the game
// analysis's own settings (sfDepth, sfTime, sfGameThreads, sfGameHash, kept like every setting), and the button that
// runs it. Starting closes the dialog: the panel shows the run. While one runs, the dialog shows it and Stop.
// analysis: useGameAnalysis; engine: useEngine; files: the stored files and onRemoveAnalysis drops their analysis
function GameAnalysisDialog({ t, setTweak, ES, sfKind, threading, hash, analysis, engine, files, M, onRemoveAnalysis, onClose }) {
  const KEYS = ['sfDepth', 'sfTime', 'sfGameLines', 'sfGameThreads', 'sfGameHash'];
  const changed = JSON.stringify(ES.game) !== JSON.stringify(window.AnalysisCore.engineSettings(window.TWEAK_DEFAULTS, sfKind, threading, hash.choices).game);
  const stopsAt = 'Each position’s search stops at its depth or time limit, whichever comes first.';
  const running = analysis.state === 'running';
  const label = analysis.resumeAt ? `Resume from move ${Math.floor((M.ply0 + analysis.resumeAt) / 2) + 1}` : files.analysis ? 'Analyse again' : 'Analyse with Stockfish';
  return (
    <DialogBox label="Analyse the game" part="game-analysis" className="xfer-box" onClose={onClose}>
      {!SF_SIMD && <div className="twk-note twk-err">{SF_ASM_NOTE}</div>}
      <TweakSlider id="tw-sf-depth" label="Depth" value={ES.game.depth} stops={window.AnalysisCore.DEPTHS} format={sfDepthText} onChange={(v) => setTweak('sfDepth', v)} info={stopsAt} />
      <TweakSlider id="tw-sf-time" label="Time limit per position" value={ES.game.time_limit} stops={window.AnalysisCore.SECONDS} unit="s" onChange={(v) => setTweak('sfTime', v)} info={stopsAt} />
      <TweakSelect id="tw-sf-glines" label="Lines" value={String(ES.game.lines)} options={window.AnalysisCore.LINES.map(String)} onChange={(v) => setTweak('sfGameLines', parseInt(v, 10))}
        info="How many best moves Stockfish finds in each position. The analysis file keeps them (the Analysis panel lists them after each move and the annotated PGN writes them as variations). Every line takes its share of the search, so at a set depth 3 lines take about 4 times as long as one, and with threads on they weaken the search." />
      <SfThreadsSelect id="tw-sf-gthreads" value={ES.game.threads} threading={threading} onChange={(v) => setTweak('sfGameThreads', v)} />
      <SfHashSelect id="tw-sf-ghash" value={ES.game.hash_mb} hash={hash} onChange={(v) => setTweak('sfGameHash', v)} />
      {changed && <TweakButton secondary label="Reset these settings" onClick={() => KEYS.forEach((k) => setTweak(k, window.TWEAK_DEFAULTS[k]))} />}
      <div className="twk-note">{engineLabel(ES.game.name)} runs in your browser, {ES.game.lines === 1 ? 'one line' : ES.game.lines + ' lines'} per position. New settings apply to the next analysis{files.analysis ? ', which replaces this one' : ''}; a stopped analysis resumes with its original settings. While it runs, Stockfish looks at nothing else: your moves and Go deeper wait until it ends.</div>
      {running && <div className="twk-note an-status" role="status">Analysing {analysis.done} of {analysis.total} positions{analysis.etaSec != null ? ' · ' + fmtEta(analysis.etaSec) : ''}<span className="an-spin" aria-hidden="true" /></div>}
      {analysis.note && <div className="twk-note" role="status">{analysis.note}</div>}
      {analysis.err && <div className="twk-note twk-err">{analysis.err}</div>}
      <div className="fen-btns">
        {files.analysis && !running && <button type="button" className="twk-btn secondary" onClick={onRemoveAnalysis}>Remove analysis</button>}
        <button type="button" className="twk-btn secondary" onClick={onClose}>{running ? 'Close' : 'Cancel'}</button>
        {running
          ? <button type="button" className="twk-btn danger" onClick={analysis.stop}>Stop the analysis</button>
          : <button type="button" className="twk-btn" data-autofocus disabled={engine.status === 'unavailable'} onClick={() => { onClose(); analysis.start(); }}>{label} · about {analysis.estimateMin} min</button>}
      </div>
    </DialogBox>
  );
}

// Settings › Game: the loaded game or board (status, the error if any), where to go from it, and About.
// go: { importGame, boardAsGame, backToGame, backToBoard, backToSample, reset }; commit stores a change of the files
function GameSettings({ M, files, board, status, err, go, commit, commentary }) {
  return <>
      <div className={err ? 'twk-note twk-err' : 'twk-note'}>{err || status}</div>
      <TweakButton label="Import game" onClick={go.importGame} />
      {board && board.game && <div className="twk-note">{board.game.mode === 'stockfish' ? 'Stockfish 19 plays the other side at full strength (there is no strength setting) and quietly rates your moves; Analyse on the free board shows its eval once the game ends.' : 'Stockfish is off during a game; Analyse on the free board brings it back once the game ends.'}</div>}
      {!board && <div className="twk-note">Uses the PGN’s own evals (Lichess [%eval] or cutechess +0.25/20). Without them, analyse the game with Stockfish: the computer button in the Analysis panel’s title. Saved analysis, notes and Queen files load here too.</div>}
      {board && !window.PlayCore.inProgress(board) && <TweakButton label="Replay these moves as a game" disabled={!board.steps.length} onClick={go.boardAsGame} />}
      {board && !window.PlayCore.inProgress(board) && <div className="twk-note">{board.steps.length ? 'Opens every move on the board as a game: watch it, analyse it with Stockfish, and export it as a video or WebP. The board comes back with “Back to the free board”.' : 'Play some moves first; then they can be replayed and exported as a video.'}</div>}
      {board && files.lastGame && <TweakButton secondary label="Back to the loaded game" onClick={go.backToGame} />}
      {!board && files.fromBoard && <TweakButton secondary label="Back to the free board" onClick={go.backToBoard} />}
      {!files.sample && <TweakButton secondary label="Back to sample game" onClick={go.backToSample} />}
      {!board && M.canChooseSource && (
        <TweakRadio id="tw-source" label="Evaluations from" value={M.evalSource === 'pgn' ? 'PGN' : 'Analysis'} options={['Analysis', 'PGN']} onChange={(v) => commit({ ...files, evalSource: v === 'PGN' ? 'pgn' : 'analysis' })} />
      )}
      {!board && M.gameCount > 1 && (
        <TweakSelect id="tw-game" label="Game in PGN" value={String((files.gameIndex || 0) + 1)} options={Array.from({ length: M.gameCount }, (_, i) => String(i + 1))} onChange={(v) => commit({ ...files, gameIndex: +v - 1, analysis: null, analysisName: null })} />
      )}
      {/* one block, never split between the panel's columns */}
      {commentary && <TweakSection label="Commentary"><div className="twk-keep">{commentary}</div></TweakSection>}
      <TweakSection label="About">
        <div className="twk-note">This player is free software under the GPL-3.0-or-later; <a href="https://github.com/boneyland/chess-replay" target="_blank" rel="noopener">source on GitHub</a>. Some parts aren’t covered by the GPL: the piece sets other than Cburnett have their own licences, some of them non-commercial (see View › Pieces), and so do the lisp move sounds (see the Sound tab) and the board reader’s model (Position from image, <code>vision/</code>), <a href="https://github.com/JSeytre/chessqueries" target="_blank" rel="noopener">ChessQueries</a>’ ChessQ Lite by Joël Seytre, under <a href="https://polyformproject.org/licenses/noncommercial/1.0.0/" target="_blank" rel="noopener">PolyForm Noncommercial 1.0.0</a>: non-commercial use only (Required Notice: Copyright (c) 2026 Joël Seytre). It is built on Meta AI’s <a href="https://github.com/facebookresearch/dinov2" target="_blank" rel="noopener">DINOv2</a> (Copyright (c) Meta Platforms, Inc. and affiliates), under the <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">Apache License 2.0</a>.</div>
      </TweakSection>
      {/* every setting back to its default; the kept games, the loaded game, Queen's answers, sign-ins and the engine download stay, and so does the engine choice */}
      <TweakButton danger label="Reset all settings" onClick={go.reset} />
  </>;
}

// Settings › View: theme, text size, pieces and board, the board's options and the replay's pace. TM: the video's timing
// (ChessCore.timing); pieces the piece set's loading (usePieceSet), boardLook the board picture's (useBoardLook)
function ViewSettings({ t, setTweak, board, TM, pieceSet, pieces, boardTheme, boardAdj, boardLook }) {
  const queenInVideo = t.queenInVideo !== false, fmtLen = window.ChessCore.fmtLen;
  return <>
      <TweakSection label="Appearance">
        <TweakRadio id="tw-scheme" label="Theme" value={t.scheme || 'Auto'} options={['Auto', 'Light', 'Dark']} onChange={(v) => setTweak('scheme', v)} />
        <TweakRadio id="tw-text-size" label="Text size" value={t.textSize || 'Default'} options={Object.keys(LayoutCore.TEXT_SIZES)} onChange={(v) => setTweak('textSize', v)} />
        <PiecePicker value={pieceSet.id} onChange={(id) => setTweak('pieceSet', id)} />
        <div className="twk-note">{pieceSet.name} by {pieceSet.home ? <a href={pieceSet.home} target="_blank" rel="noopener">{pieceSet.by}</a> : pieceSet.by}, under <a href={pieceSet.licenceUrl} target="_blank" rel="noopener">{pieceSet.licence}</a>{pieceSet.id === window.PieceSets.DEFAULT ? '' : <>, from <a href="https://github.com/lichess-org/lila" target="_blank" rel="noopener">Lichess’s source</a></>}{window.PieceSets.NON_COMMERCIAL.includes(pieceSet.id) ? ' (non-commercial: a video exported with it may not be used commercially)' : ''}.{pieces.failed ? ' Couldn’t load it (offline?): the board keeps the pieces it had.' : ''}</div>
        {/* the note stays under the grid, not carried to the next column */}
        <div className="twk-keep">
          <BoardPicker value={boardTheme.id} adj={boardAdj} onChange={(id) => setTweak('boardTheme', id)} />
          <div className="twk-note">{boardTheme.name}{boardTheme.id === window.BoardThemes.DEFAULT ? '' : <>, from <a href="https://github.com/lichess-org/lila" target="_blank" rel="noopener">Lichess’s source</a>, by the lila authors and <a href="https://lichess.org/@/pirouetti" target="_blank" rel="noopener">pirouetti</a> under <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">AGPL-3.0-or-later</a></>}. The sliders change the board’s colours, in exports too.{boardLook.failed ? ' Couldn’t load it (offline?): the board keeps the one it had.' : ''}</div>
        </div>
        <TweakSlider id="tw-board-brightness" label="Brightness" value={boardAdj.brightness} min={window.BoardThemes.SLIDERS.brightness.min} max={window.BoardThemes.SLIDERS.brightness.max} step={window.BoardThemes.SLIDERS.brightness.step} unit="%" onChange={(v) => setTweak('boardBrightness', v)} />
        <TweakSlider id="tw-board-contrast" label="Contrast" value={boardAdj.contrast} min={window.BoardThemes.SLIDERS.contrast.min} max={window.BoardThemes.SLIDERS.contrast.max} step={window.BoardThemes.SLIDERS.contrast.step} unit="%" onChange={(v) => setTweak('boardContrast', v)} />
        <TweakSlider id="tw-board-hue" label="Hue" value={boardAdj.hue} min={window.BoardThemes.SLIDERS.hue.min} max={window.BoardThemes.SLIDERS.hue.max} step={window.BoardThemes.SLIDERS.hue.step} format={(v) => `+ ${Math.round(v * 3.6)}°`} onChange={(v) => setTweak('boardHue', v)} />
        {!window.BoardThemes.isDefault(boardAdj) && <TweakButton secondary label="Reset colours to default" onClick={() => { setTweak('boardBrightness', 100); setTweak('boardContrast', 100); setTweak('boardHue', 0); }} />}
      </TweakSection>
      {!(board && board.game) && <TweakSection label="Board">
        {board ? <TweakToggle id="tw-flip" label="Flip board" value={!!t.flip} onChange={(v) => setTweak('flip', v)} /> : <>
          <TweakToggle id="tw-flip" label="Flip board" value={!!t.flip} onChange={(v) => setTweak('flip', v)} />
          <TweakToggle id="tw-arrows" label="Best-move arrows" value={t.bestArrows} onChange={(v) => setTweak('bestArrows', v)} />
          <TweakToggle id="tw-push" label="Camera push on blunders" value={t.cameraPush} onChange={(v) => setTweak('cameraPush', v)} />
          <TweakToggle id="tw-glow" label="Red glow on blunders and mates" value={t.blunderGlow !== false} onChange={(v) => setTweak('blunderGlow', v)} />
          <TweakToggle id="tw-queen" label="Queen in the video" info="Shows Queen’s comments and lines on the moves it has analysed; those moves stay on screen longer." value={queenInVideo} onChange={(v) => setTweak('queenInVideo', v)} />
        </>}
      </TweakSection>}
      {!board && <TweakSection label="Pace">
        <div className="twk-note">Video length {fmtLen(TM.total)}{TM.capped ? ' (capped at 5:00)' : ''}</div>
        <TweakSlider id="tw-spm" label="Seconds per move" value={t.secondsPerMove} min={0.5} max={4} step={0.1} unit="s" onChange={(v) => setTweak('secondsPerMove', v)} />
        <TweakSlider id="tw-hold" label="Extra hold on !/? moves and uncommented mates" value={t.keyHold} min={0} max={6} step={0.5} unit="s" onChange={(v) => setTweak('keyHold', v)} />
        <TweakToggle id="tw-fast" label="Faster opening" value={t.fastOpening} onChange={(v) => setTweak('fastOpening', v)} />
      </TweakSection>}
  </>;
}

// Settings › Online: what may be sent to Lichess
function OnlineSettings({ t, setTweak, sfKind }) {
  return <>
      <TweakToggle id="tw-tablebase" label="Endgame tablebase (7 pieces or fewer)" info="Positions with 7 pieces or fewer go to Lichess’s tablebase (tablebase.lichess.ovh) for the result with best play and every move ranked by it: in the Analysis panel and the eval bar (tagged TB), while the replay is paused and on the free board, never during a game. “Analyse with Stockfish” takes them from it too, and rates those moves by whether they keep the win or the draw. Nothing is sent with this off." value={t.tablebase !== false} onChange={(v) => setTweak('tablebase', v)} />
      <div className="twk-keep">
        <TweakToggle id="tw-cloud" label="Lichess cloud evaluation" info="The positions Stockfish searches for your moves (the free board, moves you try in the replay) also go to Lichess’s cloud (lichess.org/api/cloud-eval), which has deep evaluations of many positions: whichever answer comes first shows, the deeper one replacing it, labelled “cloud depth”; Go deeper on a move of a loaded analysis asks it too. Never for “Analyse with Stockfish” or in a game. Nothing is sent with this off." value={t.cloudEval === true} onChange={(v) => setTweak('cloudEval', v)} />
        {t.cloudEval === true && <TweakToggle id="tw-cloud-prefer" label="Prefer cloud" info={`Skips the search in your browser where the cloud is at least as deep as its depth limit (${sfKind === 'asm' ? 'at most 22 with the slow engine this device runs' : '35 with No limit'}).`} value={t.cloudPrefer === true} onChange={(v) => setTweak('cloudPrefer', v)} />}
      </div>
      <ExplorerSettings t={t} setTweak={setTweak} />
  </>;
}

// Settings › Game › Commentary (a loaded game): the sources the comments come from. sources: those the game has
// (ChessCore.commentarySources); queenSays: Queen has said something on a move in the video
function CommentarySettings({ t, setTweak, files, sources, queenSays }) {
  const showCommentary = t.commentary !== false;
  const sayFrom = { pgn: t.commentPgn !== false, notes: t.commentNotes !== false, queen: t.commentQueen !== false };
  return <>
      <TweakToggle id="tw-comm" label="Show commentary" value={showCommentary} onChange={(v) => setTweak('commentary', v)} />
      {showCommentary && <>
        {sources.includes('pgn') && <TweakToggle id="tw-comm-pgn" label="From the PGN" value={sayFrom.pgn} onChange={(v) => setTweak('commentPgn', v)} />}
        {sources.includes('notes') && <TweakToggle id="tw-comm-notes" label={files.sample && !files.notes ? 'From the sample notes' : 'From the notes file'} value={sayFrom.notes} onChange={(v) => setTweak('commentNotes', v)} />}
        {queenSays && <TweakToggle id="tw-comm-queen" label="From Queen" value={sayFrom.queen} onChange={(v) => setTweak('commentQueen', v)} />}
        {sources.length + (queenSays ? 1 : 0) > 1 && <div className="twk-note">Where several comment on a move, the first one on wins: notes file, then the PGN; Queen’s sentence follows.</div>}
      </>}
  </>;
}

// Settings › Sound: the move sounds, each change played once
function SoundSettings({ t, setTweak, soundSet, soundVolume }) {
  return <>
      <TweakToggle id="tw-sound" label="Move sounds" value={t.sound !== false} onChange={(v) => setTweak('sound', v)} />
      <TweakSelect id="tw-sset" label="Sound set" value={soundSet} options={window.Sfx.SETS} onChange={(v) => { setTweak('soundSet', v); sfxPlayer.play(v, ['move'], soundVolume); }} />
      <TweakSlider id="tw-vol" label="Volume" value={soundVolume} min={0} max={100} step={5} unit="%" onChange={(v) => { setTweak('soundVolume', v); sfxPlayer.play(soundSet, ['move'], v); }} />
      <div className="twk-note">The Lichess sets are from <a href="https://github.com/lichess-org/lila" target="_blank" rel="noopener">Lichess’s source</a>, unchanged: lisp by <a href="https://lichess.org/@/EdinburghCollective" target="_blank" rel="noopener">EdinburghCollective</a> under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a> (non-commercial: a video exported with it may not be used commercially), the others by <a href="https://github.com/Enigmahack" target="_blank" rel="noopener">Enigmahack</a> under the AGPL-3.0-or-later. Wood is made in your browser.</div>
  </>;
}

// A picker tile's picture (a knight, a board), asked for again a little later when it fails: right after a deploy Render's CDN can answer a
// file with a 404 it then keeps for a few minutes (seen 2026-11-04). The query only makes the browser ask afresh; the
// CDN's copy is shared whatever the query, so the later tries are what outlast it
const TILE_RETRY_S = [5, 15, 30, 60, 120];
function TileImage({ src, style }) {
  const [tries, setTries] = React.useState(0);
  const timer = React.useRef(null);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const retry = () => { if (tries < TILE_RETRY_S.length) timer.current = setTimeout(() => setTries((n) => n + 1), TILE_RETRY_S[tries] * 1000); };
  return <img src={tries ? `${src}?retry=${tries}` : src} alt="" draggable={false} loading="lazy" style={style} onError={retry} />;
}

// Settings › View › Pieces: each set's white knight on a light square (Lichess's way), its name on hover and to a
// screen reader. The knights are fetched when the View tab first shows them, one small file a set
function PiecePicker({ value, onChange }) {
  return (
    <TweakRow label="Pieces">
      <div className="piece-picker" role="group" aria-label="Pieces">
        {window.PieceSets.SETS.map((s) => (
          <button key={s.id} type="button" className="piece-tile" title={s.name} aria-label={s.name} aria-pressed={s.id === value} onClick={() => onChange(s.id)}>
            <TileImage src={window.PieceSets.url(s.id, 'wN')} />
          </button>
        ))}
      </div>
    </TweakRow>
  );
}

// Settings › View › Board: each board's two squares (lila's thumbnails) through the sliders, as Lichess shows them; its
// name on hover and to a screen reader. The CSS filter is close to the board's own (BoardThemes.filter), not exact
function BoardPicker({ value, adj, onChange }) {
  const BT = window.BoardThemes, filter = BT.css(adj);
  return (
    <TweakRow label="Board">
      <div className="board-picker" role="group" aria-label="Board">
        {BT.THEMES.map((b) => (
          <button key={b.id} type="button" className="board-tile" title={b.name} aria-label={b.name} aria-pressed={b.id === value} onClick={() => onChange(b.id)}>
            {BT.thumb(b.id) ? <TileImage src={BT.thumb(b.id)} style={{ filter }} /> : <i style={{ backgroundImage: `url(${BT.url(b.id)})`, filter }} />}
          </button>
        ))}
      </div>
    </TweakRow>
  );
}
