// ---------- position from image: the dialog ----------
// Import game › Position from image (and the Play dialogs' Start from › From image): the board reader's download when it isn't
// kept (need), a picture chosen or pasted (pick), a box pulled over it to the squares (crop), and the read handed on to
// Edit position (onRead). The picture never leaves the device: it is decoded here and read by Vision's Worker.
// again = { bitmap, box, grey, found }: Back to crop, opening at the box with the picture (and its greyscale copy and
// the squares found in it) GameApp kept. The bitmap the dialog decoded itself is closed here unless onRead hands it
// on; again's bitmap is GameApp's and never closed here.

const VISION_ABOUT = 'Reads a position from a screenshot, a diagram or a photo, on this device: the picture isn’t sent anywhere.';
const VISION_HELP = 'A photo: read it as it is. A diagram or screenshot: pull the edges in to the squares.';
const VISION_NO_CLIPBOARD = 'The browser didn’t let the page read the clipboard. Press Ctrl+V (⌘V on a Mac) here instead.';
const VISION_FOUND = 'The box is on the board’s squares; drag its edges if it’s off.';

// the picture's greyscale copy for VisionGrid (its longest side at most VisionGrid.SIDE, never enlarged) and the
// board's squares found in it (a box, or null); neither where the copy can't be made (a canvas that can't be read
// back), and the dialog goes on as without them
function visionGrid(bitmap) {
  try {
    const G = window.VisionGrid, k = Math.min(1, G.SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k)), h = Math.max(1, Math.round(bitmap.height * k));
    const g = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.fillStyle = '#ffffff'; // on white, as the reader sees it: transparent pixels would read as black
    g.fillRect(0, 0, w, h);
    g.drawImage(bitmap, 0, 0, w, h);
    const grey = G.grey(g.getImageData(0, 0, w, h).data, w, h);
    return { grey, found: G.findBoard(grey) };
  } catch (e) {
    return { grey: null, found: null };
  }
}
// the upload arrow of the drop tile and the drop area
const VisionUpIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5V5m-4.5 4.5L12 5l4.5 4.5M5 19h14" /></svg>;
const VISION_BAD_FILE = 'That file isn’t an image this browser can open.';
// The dialog's own caps, as GameApp refuses a file over 50 MB: a picture is decoded whole (4 bytes a pixel), and a
// 20000 × 20000 one would take about 1.6 GB and end the tab with no message. 50 megapixels (200 MB decoded) still
// takes a phone's largest photos; the reader never uses more than 2048 px of it
const VISION_MAX_BYTES = 50e6, VISION_MAX_PIXELS = 50e6;
const VISION_TOO_BIG = 'That image is too large to read (over 50 MB).';
const VISION_TOO_MANY = 'That image is too large to read (over 50 megapixels): crop it or save it smaller first.';
// the picture's width and height from its header, before it is decoded (an <img> that isn't drawn isn't decoded), or
// null where the browser can't open it that way (createImageBitmap then says whether it can)
function visionSize(f) {
  return new Promise((ok) => {
    const url = URL.createObjectURL(f), img = new Image();
    const done = (v) => { URL.revokeObjectURL(url); ok(v); };
    img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => done(null);
    img.src = url;
  });
}
// the crop box's handles: which edges each pulls, where it sits on the box (fractions of its width and height), its cursor
const CROP_HANDLES = [
  ['n', 0.5, 0, 'ns-resize'], ['s', 0.5, 1, 'ns-resize'], ['w', 0, 0.5, 'ew-resize'], ['e', 1, 0.5, 'ew-resize'],
  ['nw', 0, 0, 'nwse-resize'], ['se', 1, 1, 'nwse-resize'], ['ne', 1, 0, 'nesw-resize'], ['sw', 0, 1, 'nesw-resize'],
];

// The picture drawn to fit (w x h CSS pixels) with the box over it: dimmed outside, an 8 x 8 grid inside, the handles at
// its corners and edge midpoints and a move area inside. A drag is measured from where it started, as fractions of the
// picture shown, and handed to VisionCore.dragBox with the box it started from
function CropBox({ bitmap, box, onBox, w, h, onKeyDown, label }) {
  const canvas = React.useRef(null), drag = React.useRef(null);
  React.useEffect(() => {
    const cv = canvas.current;
    if (!cv || !w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, 0, 0, cv.width, cv.height);
  }, [bitmap, w, h]);
  const down = (handle) => (e) => {
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    e.currentTarget.ownerSVGElement.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, handle, x: e.clientX, y: e.clientY, box };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    onBox(window.VisionCore.dragBox(d.box, d.handle, (e.clientX - d.x) / w, (e.clientY - d.y) / h));
  };
  const up = (e) => { if (drag.current && drag.current.id === e.pointerId) drag.current = null; };
  const x0 = box.x0 * w, y0 = box.y0 * h, x1 = box.x1 * w, y1 = box.y1 * h, bw = x1 - x0, bh = y1 - y0;
  const lines = [1, 2, 3, 4, 5, 6, 7].map((k) => `M${x0 + (bw * k) / 8} ${y0}V${y1}M${x0} ${y0 + (bh * k) / 8}H${x1}`).join('');
  const HIT = 36, MARK = 12; // the handles' hit squares (touch-sized) and the squares drawn
  return (
    <div role="group" aria-label={label} tabIndex={0} data-autofocus onKeyDown={onKeyDown}
      style={{ position: 'relative', width: w, height: h, margin: '0 auto', touchAction: 'none', outlineOffset: 2 }}>
      <canvas ref={canvas} style={{ display: 'block', width: w, height: h }} />
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', touchAction: 'none', userSelect: 'none' }}>
        <path d={`M0 0H${w}V${h}H0ZM${x0} ${y0}V${y1}H${x1}V${y0}Z`} fillRule="evenodd" fill="rgba(0,0,0,0.55)" />
        <path d={lines} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={1} />
        <rect x={x0} y={y0} width={bw} height={bh} fill="transparent" style={{ stroke: 'var(--accent)', strokeWidth: 2, cursor: 'move' }} onPointerDown={down('move')} />
        {CROP_HANDLES.map(([k, fx, fy, cursor]) => {
          const cx = x0 + bw * fx, cy = y0 + bh * fy;
          return (
            <g key={k} style={{ cursor }} onPointerDown={down(k)}>
              <rect x={cx - HIT / 2} y={cy - HIT / 2} width={HIT} height={HIT} fill="transparent" />
              <rect x={cx - MARK / 2} y={cy - MARK / 2} width={MARK} height={MARK} rx={2} fill="#fff" style={{ stroke: 'var(--accent)', strokeWidth: 2 }} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function VisionDialog({ again, onRead, onClose }) {
  const V = window.Vision, VC = window.VisionCore;
  // state: 'checking', 'need', 'pick' or 'crop'
  const [state, setState] = React.useState(again ? 'crop' : 'checking');
  // pic: { bitmap, grey, found }, the picture, its greyscale copy and the squares found in it (VisionGrid)
  // (Back to crop hands them back as they were: nothing found again)
  const [pic, setPic] = React.useState(again ? { bitmap: again.bitmap, grey: again.grey, found: again.found } : null);
  const [box, setBox] = React.useState(again ? again.box : VC.WHOLE);
  const dl = useKeptDownload(), [err, setErr] = React.useState('');
  const [askRemove, setAskRemove] = React.useState(false), [reading, setReading] = React.useState(false);
  const [online, setOnline] = React.useState(navigator.onLine !== false);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const wrap = React.useRef(null), stage = React.useRef(null), file = React.useRef(null);
  // what unmounting must tidy, set as things happen (not from a render): own, the bitmap the dialog decoded and hasn't
  // handed on; a read under way (useKeptDownload stops a download)
  const live = React.useRef({ alive: true, own: null, reading: false });
  React.useEffect(() => () => {
    const l = live.current;
    l.alive = false;
    if (l.reading) V.stop(); // Cancel while reading stops the read, so the next one isn't refused as Already reading
    if (l.own) l.own.close();
  }, []);

  React.useEffect(() => {
    if (state !== 'checking') return;
    V.kept.present().then((has) => { if (live.current.alive) setState(has ? 'pick' : 'need'); });
  }, [state]);
  React.useEffect(() => {
    const on = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);
  // each state's first control takes the focus (the crop box itself in crop, so Enter reads and Esc cancels from there),
  // else the first button that can: the focus never falls to the page behind, whose keys would step the board
  const focusFirst = () => {
    const w = wrap.current;
    if (!w) return;
    const ok = (el) => !el.disabled && el.getClientRects().length;
    const el = [...w.querySelectorAll('[data-autofocus]')].find(ok) || [...w.querySelectorAll('button')].find(ok);
    if (el) el.focus();
  };
  React.useEffect(focusFirst, [state, askRemove, size.w > 0, dl.on, online]);

  // (a failed download's message is dl.err, shown with the dialog's own)
  const download = async () => {
    setErr('');
    if ((await dl.start((o) => V.kept.download(o))) && live.current.alive) setState('pick');
  };
  // Paste image: the first image on the clipboard, read when asked (the browser may ask first); Ctrl+V / ⌘V works too
  const pasteImage = async () => {
    setErr('');
    let items;
    try { items = await navigator.clipboard.read(); } catch (e) { if (live.current.alive) setErr(VISION_NO_CLIPBOARD); return; }
    for (const it of items) {
      const type = it.types.find((t) => /^image\//.test(t));
      if (!type) continue;
      let blob;
      try { blob = await it.getType(type); } catch (e) { if (live.current.alive) setErr(VISION_NO_CLIPBOARD); return; }
      return take(blob);
    }
    if (live.current.alive) setErr('There’s no image on the clipboard.');
  };
  // a removal that fails says why, and the dialog follows what is kept now
  const remove = async () => {
    setAskRemove(false);
    const r = await V.kept.removeKept();
    if (live.current.alive) { setErr(r.err); setState(r.kept ? 'pick' : 'need'); }
  };

  // A picked or pasted file decoded (its EXIF orientation applied); the picture before it goes, if it was the dialog's
  const take = async (f) => {
    if (!f || reading) return;
    setErr('');
    if (f.size > VISION_MAX_BYTES) { setErr(VISION_TOO_BIG); return; }
    const size = await visionSize(f);
    if (!live.current.alive) return;
    if (size && size.w * size.h > VISION_MAX_PIXELS) { setErr(VISION_TOO_MANY); return; }
    let bitmap;
    try { bitmap = await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch (e) { if (live.current.alive) setErr(VISION_BAD_FILE); return; }
    if (!live.current.alive) { bitmap.close(); return; }
    if (live.current.own) live.current.own.close();
    live.current.own = bitmap;
    const grid = visionGrid(bitmap);
    setPic({ bitmap, ...grid });
    setBox(grid.found || VC.WHOLE);
    setState('crop');
  };
  // pasting works only while this dialog is open: the first image on the clipboard, text left alone
  const canTake = state === 'pick' || state === 'crop';
  React.useEffect(() => {
    if (!canTake) return;
    const onPaste = (e) => {
      const item = e.clipboardData && [...e.clipboardData.items].find((it) => it.kind === 'file' && /^image\//.test(it.type));
      if (!item) return;
      e.preventDefault();
      take(item.getAsFile());
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [canTake, reading]);
  // Files held over the window are this dialog's while it is open (GameApp leaves them): over the tiles or the picture
  // (zone) they light it up as one drop area, and dropped there the first image is taken; elsewhere they can't drop
  const zone = React.useRef(null), takeRef = React.useRef(take);
  takeRef.current = take;
  const [hot, setHot] = React.useState(false);
  React.useEffect(() => watchFileDrag({
    over: (e) => {
      const on = !!zone.current && zone.current.contains(e.target);
      e.dataTransfer.dropEffect = on ? 'copy' : 'none';
      setHot(on);
    },
    off: () => setHot(false),
    drop: (e) => {
      if (!zone.current || !zone.current.contains(e.target)) return;
      const list = droppedFiles(e);
      takeRef.current(list.find((f) => /^image\//.test(f.type)) || list[0]);
    },
  }), []);
  const dropHere = hot && canTake && !reading && <div className="vision-drop" aria-hidden="true">
    <VisionUpIcon />
    <b>Drop the image to read the board</b>
    <span>PNG, JPEG, WebP…</span>
  </div>;

  // the picture's size on screen: the dialog's width, and the window's height less the rest of the dialog
  React.useLayoutEffect(() => {
    if (state !== 'crop' || !pic) return;
    const fit = () => {
      const st = stage.current, bx = st && st.closest('.dlg-box');
      if (!st || !bx) return;
      const roomW = st.clientWidth, roomH = Math.max(120, window.innerHeight - 32 - (bx.offsetHeight - st.offsetHeight));
      const k = Math.min(roomW / pic.bitmap.width, roomH / pic.bitmap.height);
      setSize({ w: Math.max(1, Math.floor(pic.bitmap.width * k)), h: Math.max(1, Math.floor(pic.bitmap.height * k)) });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [state, pic, err]);

  // The box's part of the picture, at most 2048 px on its longest side, to the reader; a PNG of it for Edit position.
  // The crop bitmap is the reader's once read is called (it transfers or closes it)
  const read = async () => {
    if (reading || !pic) return;
    setErr('');
    setReading(true);
    live.current.reading = true;
    // the focus stays in the dialog (on the box) while Read board is disabled, so Esc still cancels
    focusFirst();
    let url = null, crop = null;
    try {
      const r = VC.cropRect(box, pic.bitmap.width, pic.bitmap.height);
      crop = await createImageBitmap(pic.bitmap, r.sx, r.sy, r.sw, r.sh, { resizeWidth: r.dw, resizeHeight: r.dh, resizeQuality: 'high' });
      if (!live.current.alive) throw new Error('Closed');
      const cv = new OffscreenCanvas(r.dw, r.dh);
      cv.getContext('2d').drawImage(crop, 0, 0);
      const png = cv.convertToBlob({ type: 'image/png' });
      const c = crop;
      crop = null;
      // both settled before either failure is shown: a PNG that fails while the reader still runs would otherwise
      // free Read board while Vision is busy, and the next read be refused as Already reading
      const [rl, rp] = await Promise.allSettled([V.read(c), png]);
      if (rl.status === 'rejected') throw rl.reason;
      if (rp.status === 'rejected') throw rp.reason;
      const logits = rl.value, blob = rp.value;
      live.current.reading = false;
      if (!live.current.alive) return;
      url = URL.createObjectURL(blob);
      const { b, conf } = VC.read(logits);
      // the rank labels decide which way up the read is, where the box is on checkered squares (found, or pulled in by
      // hand: not a box loosely round a photo)
      const G = window.VisionGrid, turn = !!pic.grey && G.isGrid(pic.grey, box) && G.shouldTurn(pic.grey, box, b);
      if (live.current.own === pic.bitmap) live.current.own = null; // handed on: GameApp keeps it for Back to crop
      setReading(false);
      onRead({ setup: turn ? VC.turn(VC.setupFrom(b)) : VC.setupFrom(b), unsure: turn ? VC.turnSquares(VC.unsure(conf)) : VC.unsure(conf), url, bitmap: pic.bitmap, box, grey: pic.grey, found: pic.found });
    } catch (e) {
      live.current.reading = false;
      if (crop) crop.close();
      if (url) URL.revokeObjectURL(url);
      if (!live.current.alive) return;
      setReading(false);
      setErr((e && e.message) || 'The board reader failed');
      // a kept copy found incomplete is dropped by the reader: offer the download again
      V.kept.present().then((has) => { if (!has && live.current.alive) setState('need'); });
    }
  };
  const onCropKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); read(); } };

  const total = V.kept.total(), MB = keptMB(total);
  const supported = V.supported();
  const canPaste = !!(navigator.clipboard && navigator.clipboard.read);
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); // a touch screen: nothing to drag from
  const cancelBtn = <button type="button" className="twk-btn secondary" onClick={onClose}>Cancel</button>;
  const msg = (err || dl.err) && <div className="dlg-msg" role="alert">{err || dl.err}</div>;
  let body;
  if (state === 'checking') body = <div className="dlg-btns"><button type="button" className="twk-btn secondary" data-autofocus onClick={onClose}>Cancel</button></div>;
  else if (state === 'need') {
    body = <>
      <div className="dlg-note">{VISION_ABOUT}</div>
      <div className="dlg-note">The model is <a href="https://github.com/JSeytre/chessqueries" target="_blank" rel="noopener">ChessQ Lite by Joël Seytre (ChessQueries)</a>, under <a href="https://polyformproject.org/licenses/noncommercial/1.0.0/" target="_blank" rel="noopener">PolyForm Noncommercial 1.0.0</a>. Required Notice: Copyright (c) 2026 Joël Seytre. It is built on Meta AI’s <a href="https://github.com/facebookresearch/dinov2" target="_blank" rel="noopener">DINOv2</a> (Copyright (c) Meta Platforms, Inc. and affiliates), under the <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">Apache License 2.0</a>.</div>
      {!supported ? <div className="twk-note twk-err">This browser can’t run the board reader.</div>
        : !online && !dl.on && <div className="dlg-note" role="status">The board reader downloads once; you’re offline.</div>}
      {dl.on && <KeptProgress what="board reader" got={dl.got} total={total} />}
      {msg}
      <div className="dlg-btns">
        {dl.on ? <button type="button" className="twk-btn secondary" data-autofocus onClick={dl.cancel}>Cancel the download</button> : cancelBtn}
        {!dl.on && <button type="button" className="twk-btn" data-autofocus disabled={!online || !supported} onClick={download}>Download board reader · {MB} MB</button>}
      </div>
    </>;
  } else if (state === 'pick') {
    body = <>
      <div className="dlg-note">{VISION_ABOUT}</div>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const el = e.target; take(el.files && el.files[0]).finally(() => { el.value = ''; }); }} />
      <div ref={zone} className="vision-zone">
        <div className="vision-tiles" style={dropHere ? { visibility: 'hidden' } : null}>
          <button type="button" className="vision-tile vision-tile-drop" aria-label="Choose image, or drop one here" data-autofocus onClick={() => file.current && file.current.click()}>
            <VisionUpIcon />
            <span>{coarse ? <u>Choose an image</u> : <>Drop an image or <u>choose one</u></>}</span>
            <small>PNG, JPEG, WebP…</small>
          </button>
          <button type="button" className="vision-tile" onClick={canPaste ? pasteImage : () => setErr(VISION_NO_CLIPBOARD)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="12" height="16" rx="2" /><path d="M9.5 3h5v3h-5z" /></svg>
            <span>Paste image</span>
            {!coarse && <small>or press {/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Ctrl+V'}</small>}
          </button>
        </div>
        {dropHere}
      </div>
      {msg}
      {askRemove ? <>
        <KeptRemoveAsk what="board reader" total={total} />
        <div className="dlg-btns">
          <button type="button" className="twk-btn danger" onClick={remove}>Remove</button>
          <button type="button" className="twk-btn secondary" data-autofocus onClick={() => setAskRemove(false)}>Keep</button>
        </div>
      </> : <div className="dlg-btns" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button type="button" className="twk-btn secondary vision-remove" onClick={() => setAskRemove(true)}>Remove the board reader · {MB} MB</button>
        {cancelBtn}
      </div>}
    </>;
  } else {
    body = <>
      <div ref={(el) => { stage.current = el; zone.current = el; }} style={{ position: 'relative', width: '100%' }}>
        {dropHere}
        {size.w > 0 && <CropBox bitmap={pic.bitmap} box={box} onBox={setBox} w={size.w} h={size.h} onKeyDown={onCropKey}
          label="The picture: drag the box’s edges or corners to the board’s squares, or drag inside it to move it. Enter reads the board." />}
      </div>
      <div className="dlg-note">{pic.found && ['x0', 'y0', 'x1', 'y1'].every((k) => box[k] === pic.found[k]) ? VISION_FOUND : VISION_HELP}</div>
      {msg}
      <div className="dlg-btns">
        {cancelBtn}
        <button type="button" className="twk-btn" disabled={reading} onClick={read}>{reading ? 'Reading…' : 'Read board'}</button>
      </div>
    </>;
  }
  return (
    <DialogBox label="Position from image" part="position-from-image" className="vision-box" onClose={onClose}>
      <div ref={wrap} style={{ display: 'contents' }}>{body}</div>
    </DialogBox>
  );
}
