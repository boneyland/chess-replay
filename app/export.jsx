// ---------- video export ----------
// Steps the player through every frame, draws the stage into a canvas (export-draw.js: the board, the eval bar and the
// graph drawn there, the other layers with html2canvas-pro, each only when it changes) and encodes it in
// the browser: an MP4 (WebCodecs, muxed by Mediabunny), or an animated WebP (each frame a still WebP from libwebp,
// joined by webp-core.js). The libraries load on the first export only: html2canvas-pro from the CDN, Mediabunny and
// libwebp from the site.
// frame rates offered in Settings; each frame takes about 0.2 s to draw, so the export time scales with it
const EXPORT_FPS_OPTIONS = [8, 12, 15, 24, 30];
// a new version of html2canvas-pro needs a new hash. Mediabunny 1.61.0 (an ES module) is served next to the page
// (vendor/): an import() can't carry an integrity hash, and not every browser honours an import map's
const EXPORT_LIBS = {
  html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas-pro@2.5.0/dist/html2canvas-pro.min.js',
  html2canvasHash: 'sha384-IT/7L8+t0nqitKnKyUD1rh3hC/qPQehh1Et4A2dTqUuxKbomoRs73yhSQoALaYeI',
  mediabunny: 'mediabunny.min.js',
};
const EXPORT_FORMATS = ['MP4', 'WebP'];
// WebP widths offered besides the frame's own (the screen-sized page's width at the screen's density): 1676 fills GitHub's 838 px README
// column on 2× screens. Quality is 50–95 (lossy). Encoded straight from the drawn frames, a WebP looks better than one
// converted from the MP4, though it is larger than the MP4 of the same clip
const WEBP_WIDTHS = [1676, 1280, 960, 838, 640];
const WEBP_QUALITY = { min: 50, max: 95, step: 5 };
// libwebp 1.1.0 built to WebAssembly (Squoosh's codec, as packaged in @jsquash/webp 1.5.0), served next to the page.
// The browser's own encoder (canvas.toBlob) takes only a quality, and at most qualities it sometimes chose a strong deblocking
// filter for a frame, smearing the board's square edges and the text for that one frame. Here the filter is off, so
// every frame is as sharp as its quality allows. These are all of libwebp's WebPConfig fields, which the codec needs
const WEBP_LIB = { js: 'webp_enc_simd.js', wasm: 'webp_enc_simd.wasm' };
const WEBP_CONFIG = {
  quality: 75, target_size: 0, target_PSNR: 0, method: 4, sns_strength: 50, filter_strength: 0, filter_sharpness: 0,
  filter_type: 1, partitions: 0, segments: 4, pass: 1, show_compressed: 0, preprocessing: 0, autofilter: 0,
  partition_limit: 0, alpha_compression: 1, alpha_filtering: 1, alpha_quality: 100, lossless: 0, exact: 0, image_hint: 0,
  emulate_jpeg_size: 0, thread_level: 0, low_memory: 0, near_lossless: 100, use_delta_palette: 0, use_sharp_yuv: 0,
};
// each library loads once; a failed load is tried again on the next export
const once = (load) => { let p = null; return () => (p = p || load().catch((e) => { p = null; throw e; })); };
const loadHtml2canvas = once(() => new Promise((ok, fail) => {
  if (window.html2canvas) return ok(window.html2canvas);
  const s = document.createElement('script');
  s.src = EXPORT_LIBS.html2canvas; s.integrity = EXPORT_LIBS.html2canvasHash; s.crossOrigin = 'anonymous';
  s.onload = () => ok(window.html2canvas); s.onerror = () => fail(new Error('could not load html2canvas-pro'));
  document.head.appendChild(s);
}));
const loadMediabunny = once(() => import(new URL(EXPORT_LIBS.mediabunny, document.baseURI).href));
// the codec's glue is an ES module; given the wasm's bytes, it doesn't fetch them itself
const loadWebp = once(async () => {
  const at = (f) => new URL(f, document.baseURI).href;
  const [glue, wasm] = await Promise.all([import(at(WEBP_LIB.js)), fetch(at(WEBP_LIB.wasm)).then((r) => {
    if (!r.ok) throw new Error('could not load the WebP encoder');
    return r.arrayBuffer();
  })]);
  return glue.default({ noInitialRun: true, wasmBinary: wasm });
});

// The two encoders behind one interface: frame(isNew) after each frame is drawn into the canvas (isNew false when
// run() left the canvas as it was, its markup unchanged), then finish() gives the file as { blob, ext }, or cancel()
async function mp4Encoder(cv, W, H, fps, audio) {
  const MB = await loadMediabunny();
  const avc = await MB.canEncodeVideo('avc', { width: W, height: H });
  const codec = avc ? 'avc' : (await MB.canEncodeVideo('vp9', { width: W, height: H })) ? 'vp9' : null;
  if (!codec) throw new Error('this browser cannot encode video. Try a recent Chrome, Edge or Firefox.');
  const output = new MB.Output({ format: avc ? new MB.Mp4OutputFormat() : new MB.WebMOutputFormat(), target: new MB.BufferTarget() });
  const src = new MB.CanvasSource(cv, { codec, bitrate: MB.QUALITY_HIGH });
  output.addVideoTrack(src, { frameRate: fps });
  // the move sounds, when the browser can encode them: AAC in an MP4, else Opus (which MP4 and WebM both hold)
  const sound = audio ? await audio() : null;
  let asrc = null;
  if (sound) {
    const acodec = await MB.getFirstEncodableAudioCodec(avc ? ['aac', 'opus'] : ['opus'], { numberOfChannels: sound.numberOfChannels, sampleRate: sound.sampleRate });
    if (acodec) { asrc = new MB.AudioBufferSource({ codec: acodec, bitrate: MB.QUALITY_MEDIUM }); output.addAudioTrack(asrc); }
  }
  await output.start();
  if (asrc) { await asrc.add(sound); asrc.close(); }
  let i = 0;
  return {
    frame: async () => { await src.add(i / fps, 1 / fps); i++; },
    finish: async () => {
      await output.finalize();
      return { blob: new Blob([output.target.buffer], { type: avc ? 'video/mp4' : 'video/webm' }), ext: avc ? '.mp4' : '.webm' };
    },
    cancel: async () => { if (output.state === 'started') await output.cancel(); },
  };
}

// Each frame is drawn at the WebP's width (width 0: the frame's own), compared with the last one pixel by pixel, and
// only the rectangle that changed is encoded, straight from the drawn pixels: nothing is encoded twice, so quality
// doesn't drift. A picture that didn't change lengthens the frame before: isNew false says so without reading the
// pixels (pauses, the title and end cards), and the comparison catches a new markup that draws the same picture.
async function webpEncoder(cv, W, H, fps, { width = 0, quality = 75 } = {}) {
  const scale = width && width < W ? width / W : 1;
  const w = Math.round(W * scale), h = Math.round(H * scale);
  let codec;
  try { codec = await loadWebp(); } catch (e) { throw new Error('the WebP encoder couldn’t be downloaded from this site. Check the connection and try again, or export an MP4.'); }
  // at the frame's own size the pixels are read straight from cv; a smaller WebP is drawn into its own canvas first
  const out = scale === 1 ? cv : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ox = out.getContext('2d', { willReadFrequently: true });
  ox.imageSmoothingQuality = 'high';
  const config = { ...WEBP_CONFIG, quality };
  const frames = [];
  let i = 0, prev = null;
  // frame i ends at round((i + 1) * 1000 / fps) ms, so the whole file keeps time (see WebPAnim.durations)
  const end = (k) => Math.round((k * 1000) / fps);
  return {
    frame: async (isNew) => {
      const last = frames[frames.length - 1], dur = end(i + 1) - end(i);
      i++;
      if (!isNew && last) { last.duration += dur; return; }
      if (out !== cv) { ox.clearRect(0, 0, w, h); ox.drawImage(cv, 0, 0, w, h); }
      const pixels = ox.getImageData(0, 0, w, h).data;
      const box = prev ? window.WebPAnim.changedBox(prev, pixels, w, h) : { x: 0, y: 0, w, h };
      prev = pixels;
      if (!box) { last.duration += dur; return; }
      const part = box.w === w && box.h === h ? pixels : ox.getImageData(box.x, box.y, box.w, box.h).data;
      const still = codec.encode(part, box.w, box.h, config);
      if (!still) throw new Error('the WebP encoder failed on frame ' + i);
      const { offset, alpha } = window.WebPAnim.stillImage(still);
      frames.push({ data: new Blob([still.subarray(offset)]), size: still.length - offset, duration: dur, alpha, ...box });
    },
    finish: async () => ({ blob: new Blob(window.WebPAnim.mux(frames, { width: w, height: h }), { type: 'image/webp' }), ext: '.webp' }),
    cancel: async () => {},
  };
}
// the stage re-renders synchronously inside dispatchEvent, so the frame can be drawn straight after
const seekStage = (t) => window.dispatchEvent(new CustomEvent('chess-video:seek', { detail: { time: t, sync: true } }));

// run() takes the stretch of the timeline to export in seconds ({ start, end }), a file name suffix, and audio: an
// async function giving the stretch's soundtrack as an AudioBuffer (or null for none; a WebP has no sound).
// format: one of EXPORT_FORMATS; webp: { width (0 the frame's own, 'Half', or pixels), quality } for webpEncoder
function useVideoExport({ fps, format, webp, save, stem }) {
  const [state, setState] = React.useState(null); // { phase: 'load' | 'render' | 'save', done, N, eta } or { phase: 'error', msg }
  const stopRef = React.useRef(false);
  const run = async ({ start, end, suffix = '', audio }) => {
    if (state && state.phase !== 'error') return;
    stopRef.current = false;
    setState({ phase: 'load', done: 0, N: 0 });
    let enc = null, stage = null;
    try {
      const html2canvas = await loadHtml2canvas();
      // the stage is in its screen-sized video layout once the busy state has rendered: wait a frame, then draw it from
      // its top (a paused one-column page may have been scrolled)
      await new Promise((ok) => requestAnimationFrame(ok));
      const el = document.querySelector('.stage-frame > div');
      el.closest('.stage-area').scrollTop = 0;
      // the page is drawn at the screen's density (LayoutCore.exportScale, as Settings' widths assume), up to 1920 px on its longer side
      const cssW = el.offsetWidth, cssH = el.offsetHeight, scale = LayoutCore.exportScale(cssW, cssH, window.devicePixelRatio);
      const W = LayoutCore.exportPx(cssW, scale), H = LayoutCore.exportPx(cssH, scale);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d', { willReadFrequently: format === 'WebP' }); // the WebP encoder reads every frame back
      // Full (0) and Half are taken against the canvas drawn now, whatever Settings' widths were worked out from
      const wpx = webp.width === 'Half' ? Math.round(W / 2) : webp.width;
      enc = format === 'WebP' ? await webpEncoder(cv, W, H, fps, { ...webp, width: wpx }) : await mp4Encoder(cv, W, H, fps, audio);
      // html2canvas copies the whole document every frame: leave out the scripts (the page inlines its sounds
      // and opening tables) and the page around the stage, but keep the head and every stylesheet (fonts and base styles)
      const keep = (n) => n.tagName === 'STYLE' || n.tagName === 'LINK' || n.tagName === 'HEAD' || n.closest('head');
      const skip = (target) => (n) => n.tagName === 'SCRIPT' || (!keep(n) && n !== target && !n.contains(target) && !target.contains(n));
      // the stage drawn layer by layer, each redrawn only when its markup changes (export-draw.js)
      stage = window.ExportDraw.compositor(el, { W, H, scale: W / cssW, html2canvas, skip });
      const N = Math.floor((end - start) * fps) + 1, t0 = performance.now();
      let prev = null;
      for (let i = 0; i < N; i++) {
        if (stopRef.current) { await enc.cancel(); stage.done(); setState(null); return; }
        seekStage(start + i / fps);
        // a frame whose markup matches the last one (holds, the title and end cards) reuses the canvas as it is
        const html = el.innerHTML, isNew = html !== prev;
        if (isNew) { await stage.draw(cx); prev = html; }
        await enc.frame(isNew);
        const per = (performance.now() - t0) / (i + 1);
        setState({ phase: 'render', done: i + 1, N, eta: per * (N - i - 1) / 1000 });
      }
      stage.done();
      setState({ phase: 'save', done: N, N });
      const { blob, ext } = await enc.finish();
      await save(stem + suffix + ext, blob);
      setState(null);
    } catch (e) {
      if (stage) stage.done();
      try { if (enc) await enc.cancel(); } catch (_) {}
      setState({ phase: 'error', msg: 'Export failed: ' + ((e && e.message) || e) });
    }
  };
  return { state, run, format, cancel: () => { stopRef.current = true; }, dismiss: () => setState(null), busy: !!state && state.phase !== 'error' };
}

function ExportOverlay({ x }) {
  const s = x.state;
  if (!s) return null;
  if (s.phase === 'error') return (
    <div className="export" role="alertdialog" aria-label="Export failed">
      <div className="export-box">
        <div className="export-title">Export failed</div>
        <div className="export-line export-err">{s.msg.replace(/^Export failed: /, '')}</div>
        <button type="button" className="twk-btn secondary" onClick={x.dismiss}>Close</button>
      </div>
    </div>
  );
  const pct = s.N ? Math.round((100 * s.done) / s.N) : 0;
  // minutes and seconds, as the Settings note gives the export's length
  const left = s.eta != null ? Math.ceil(s.eta) : 0, eta = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const line = s.phase === 'load' ? 'Loading the encoder…'
    : s.phase === 'save' ? 'Finishing the file…'
    : `Frame ${s.done} of ${s.N} · about ${eta} left`;
  return (
    <div className="export" role="dialog" aria-label="Exporting">
      <div className="export-box">
        <div className="export-title">Exporting {x.format === 'WebP' ? 'animated WebP' : 'video'}</div>
        <div className="export-bar"><div style={{ width: pct + '%' }} /></div>
        <div className="export-line">{line}</div>
        <div className="export-note">Keep this tab active and in front: the export slows or stops while the tab or window is hidden (another tab, or minimized). Resizing the window or turning the phone changes the layout, and the video with it.</div>
        {s.phase === 'render' && <button type="button" className="twk-btn secondary" onClick={x.cancel}>Cancel</button>}
      </div>
    </div>
  );
}
