// Assemble the page (out/site): plain scripts inlined as-is, JSX precompiled with Babel, each unit in its own scope.
const fs = require('fs'), path = require('path');
const dir = __dirname, src = path.join(dir, 'src'), app = path.join(dir, 'app');
const Babel = require(path.join(dir, 'babel', 'babel.min.js'));
const jsx = (code, name) => Babel.transform(code, { filename: name, presets: ['react'] }).code;
const read = (p) => fs.readFileSync(p, 'utf8');
// Lichess's sound sets (vendor/sounds: Enigmahack's AGPL-3.0-or-later ones and EdinburghCollective's lisp, CC BY-NC-SA 4.0),
// served next to the page as sounds/<set>/<Kind>.mp3 (Sfx.soundUrl) and kept by the service worker from the first visit
const SOUNDS = path.join(dir, 'vendor', 'sounds');
const SOUND_FILES = ['futuristic', 'lisp', 'nes', 'piano', 'sfx'].flatMap((set) => ['Move', 'Capture', 'Check', 'Victory', 'Draw'].map((f) => `sounds/${set}/${f}.mp3`));
const units = [
  ['pieces.js', read(path.join(src, 'pieces.js'))],
  ['piece-sets.js', read(path.join(app, 'piece-sets.js'))],
  ['board-themes.js', read(path.join(app, 'board-themes.js'))],
  ['chess-core.js', read(path.join(app, 'chess-core.js'))],
  ['analysis-core.js', read(path.join(app, 'analysis-core.js'))],
  ['lichess-core.js', read(path.join(app, 'lichess-core.js'))],
  ['openings-data.js', 'window.OPENINGS_TSV = ' + JSON.stringify(require('./openings-data.cjs').openingsTsv()).replace(/</g, '\\u003c') + ';'],
  ['openings-core.js', read(path.join(app, 'openings-core.js'))],
  ['board-core.js', read(path.join(app, 'board-core.js'))],
  ['edit-core.js', read(path.join(app, 'edit-core.js'))],
  ['import-core.js', read(path.join(app, 'import-core.js'))],
  ['draw-core.js', read(path.join(app, 'draw-core.js'))],
  ['vision-core.js', read(path.join(app, 'vision-core.js'))],
  ['vision-grid.js', read(path.join(app, 'vision-grid.js'))],
  ['layout-core.js', read(path.join(app, 'layout-core.js'))],
  ['play-core.js', read(path.join(app, 'play-core.js'))],
  ['dead-core.js', read(path.join(app, 'dead-core.js'))],
  ['games-core.js', read(path.join(app, 'games-core.js'))],
  ['sf-engine.js', read(path.join(app, 'sf-engine.js'))],
  ['kept-files.js', read(path.join(app, 'kept-files.js'))],
  ['sf-full.js', read(path.join(app, 'sf-full.js'))],
  ['vision.js', read(path.join(app, 'vision.js'))],
  ['queen-core.js', read(path.join(app, 'queen-core.js'))],
  ['sfx-core.js', read(path.join(app, 'sfx-core.js'))],
  ['drag-scroll.js', read(path.join(app, 'drag-scroll.js'))],
  ['webp-core.js', read(path.join(app, 'webp-core.js'))],
  ['export-draw.js', read(path.join(app, 'export-draw.js'))],
  ['sample-game.js', read(path.join(src, 'sample-game.js'))],
  ['game-data.js', read(path.join(src, 'game-data.js'))],
  ['sample-analysis.js', read(path.join(app, 'sample-analysis.js'))],
  ['engine.jsx', jsx(read(path.join(app, 'engine.jsx')), 'engine.jsx')],
  ['tweaks.jsx', jsx(read(path.join(app, 'tweaks.jsx')), 'tweaks.jsx')],
  ['game-video.jsx', jsx(read(path.join(app, 'game-video-core.jsx')) + '\n' + read(path.join(app, 'queen.jsx')) + '\n' + read(path.join(app, 'stockfish.jsx')) + '\n' + read(path.join(app, 'tablebase.jsx')) + '\n' + read(path.join(app, 'dead.jsx')) + '\n' + read(path.join(app, 'explorer.jsx')) + '\n' + read(path.join(app, 'free-board.jsx')) + '\n' + read(path.join(app, 'edit-board.jsx')) + '\n' + read(path.join(app, 'sfx.jsx')) + '\n' + read(path.join(app, 'export.jsx')) + '\n' + read(path.join(app, 'vision.jsx')) + '\n' + read(path.join(app, 'game-app.jsx')), 'game-video.jsx')],
];
const scripts = units.map(([name, code]) => {
  if (/<\/script/i.test(code)) throw new Error(name + ' contains </script');
  return `<script>\n// ${name}\n(function () {\n${code}\n})();\n</script>`;
}).join('\n');
const page = read(path.join(app, 'shell.html'));
const out = page.replace('<!--SCRIPTS-->', () => scripts); // a function, so $' or $& in the code stay as they are
fs.mkdirSync(path.join(dir, 'out', 'site'), { recursive: true });
// what a shared link and the browser tab show
const DESCRIPTION = 'Replay an annotated chess game as a broadcast-style video: move ratings, best lines, commentary and an eval graph, with Stockfish in your browser.';
// A link preview's image needs an absolute URL: the host's own (Render sets RENDER_EXTERNAL_URL; a local build points at Render)
const SITE_URL = (process.env.RENDER_EXTERNAL_URL || 'https://chess-replay.onrender.com').replace(/\/$/, '');
const VENDOR = ['stockfish-19-asm.js', 'stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm', 'stockfish-19-lite.js', 'stockfish-19-lite.wasm', 'webp_enc_simd.js', 'webp_enc_simd.wasm', 'mediabunny.min.js', 'chasolver.wasm'];
const ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#9a6a1c"/><circle cx="16" cy="9.5" r="4" fill="#fffaf2"/><path d="M12.5 14h7l1.5 9h-10z M8.5 24h15v3h-15z" fill="#fffaf2"/></svg>');
// The document shell around the page. It doesn't zoom (maximum-scale, user-scalable): a browser set to ignore that (iPhone Safari, Chrome's Force
// enable zoom) still lets the viewer pinch
// Firefox for Android reports the gesture bar as a bottom safe-area inset though it never draws the page under it, so
// in a browser tab (not full screen, which reports 0 anyway) the bottom padding would leave that strip empty
const site = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="description" content="${DESCRIPTION}">
<meta property="og:title" content="Chess Replay">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE_URL}/">
<meta property="og:image" content="${SITE_URL}/og-image.png">
<meta property="og:image:width" content="1653">
<meta property="og:image:height" content="944">
<meta property="og:image:alt" content="A game replaying: the board with a best-move arrow, the move list, commentary, Stockfish and Queen's analysis and the eval graph">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f2ece3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#13100f" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${ICON}">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Chess Replay">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>:root{--safe-b:env(safe-area-inset-bottom,0px);padding-top:env(safe-area-inset-top,0px);padding-bottom:var(--safe-b)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}@media (display-mode:browser){@supports (-moz-appearance:none){:root:not(:fullscreen){--safe-b:0px}}}</style>
</head>
<body>
${out}
<script>
// sw.js keeps a copy of the page and its files, so it works offline
if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}); });
</script>
</body>
</html>
`;
// The page's Content-Security-Policy, as a <meta> so the build can list a hash of each of its inline scripts (no
// 'unsafe-inline' for scripts, so an injected one doesn't run). It names every host the page talks to: React and
// html2canvas-pro (CDNs), the fonts, Hugging Face (sign-in, the Queen Space), Lichess's tablebase and explorer, the full engine's
// download (unpkg). The engines and the export's encoders are WebAssembly ('wasm-unsafe-eval'); the full engine and
// Mediabunny start workers from Blob URLs, and the full engine's glue fetches its wasm from one. Scripts from a CDN are
// allowed by their exact URLs (those in shell.html and export.jsx), not the whole host, so no other file there can run.
// Framing (frame-ancestors) can't be set in a <meta>: render.yaml sends it as a header
// The hosts of the CDN files and fonts: allowed by the CSP, and their files kept by the service worker (KEEP_HOSTS in
// sw.js: as they're used; SW_REMOTE, the files shell.html and export.jsx name there: at install)
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
// the other hosts the page talks to, never kept: Hugging Face (sign-in, the Queen Space), Lichess (tablebase, explorer,
// games), the full engine's download (unpkg, kept in a cache of its own)
const API_HOSTS = ['huggingface.co', 'boneyland-queen-pawn-8.hf.space', 'tablebase.lichess.ovh', 'explorer.lichess.ovh', 'lichess.org', 'unpkg.com'];
const hostRe = new RegExp(`https://(?:${CDN_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})/[^'"\\s\`]+`, 'g');
const SW_REMOTE = [...new Set([read(path.join(app, 'shell.html')), read(path.join(app, 'export.jsx'))].join('\n').match(hostRe))];
const CDN_SCRIPTS = SW_REMOTE.filter((u) => /\.js$/.test(u));
const inlineHashes = [...site.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${require('crypto').createHash('sha256').update(m[1]).digest('base64')}'`);
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${CDN_SCRIPTS.join(' ')} ${inlineHashes.join(' ')}`,
  "worker-src 'self' blob:",
  `connect-src 'self' blob: data: ${API_HOSTS.concat(CDN_HOSTS).map((h) => 'https://' + h).join(' ')}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');
// Everything served next to the page goes through put(), which says whether the service worker keeps it at install
// (SW_LOCAL below is built from those, so a file copied here is never left out of the offline copy by mistake)
const SITE = path.join(dir, 'out', 'site'), PAGE = 'chess-game-video.html';
const kept = [];
// a folder's files (no dotfiles, no folders)
const filesIn = (d) => fs.readdirSync(d).filter((f) => !f.startsWith('.') && fs.statSync(path.join(d, f)).isFile());
const put = (rel, from, { keep = false, text } = {}) => {
  fs.mkdirSync(path.dirname(path.join(SITE, rel)), { recursive: true });
  if (text != null) fs.writeFileSync(path.join(SITE, rel), text); else fs.copyFileSync(from, path.join(SITE, rel));
  if (keep) kept.push(rel);
};
fs.writeFileSync(path.join(SITE, PAGE), site.replace('<meta charset="utf-8">\n', () => `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">\n`));
// the engine, the WebP export's encoder, the MP4 export's muxer and the dead-position prover, kept; the link preview's
// image (a 1653×944 frame from the player), not needed offline
put('og-image.png', path.join(app, 'og-image.png'));
for (const f of VENDOR) put(f, path.join(dir, 'vendor', f), { keep: true });
// the dead-position prover's Worker, which runs chasolver.wasm (a Worker is started from a file of the page's own origin)
put('dead-worker.js', path.join(app, 'dead-worker.js'), { keep: true });
// the board reader's Worker (small, kept with the page; the model and runtime it loads are in vision/, kept only on request)
put('vision-worker.js', path.join(app, 'vision-worker.js'), { keep: true });
// the board reader's model and runtime (vision/, 55 MB), served next to the page for the viewer who asks to keep them
// (sw.js answers them from VISION_CACHE, never from its own copy); the licence texts stay in the repo
for (const f of filesIn(path.join(dir, 'vision'))) if (!/LICENSE$|^NOTICE$/.test(f)) put('vision/' + f, path.join(dir, 'vision', f));
// the piece sets other than cburnett (which is in the page), served as pieces/<set>/<piece>.svg (PieceSets.url); the service
// worker keeps a set when it's first drawn, not at install, so a first visit doesn't fetch all 1.4 MB
const PIECES = path.join(dir, 'vendor', 'pieces');
for (const set of fs.readdirSync(PIECES).filter((s) => !s.startsWith('.'))) for (const f of filesIn(path.join(PIECES, set))) put(`pieces/${set}/${f}`, path.join(PIECES, set, f));
// the picture boards and every board's picker tile, served as boards/<file> (BoardThemes.url, .thumb), kept by the
// service worker as they're used, as the piece sets are
for (const f of filesIn(path.join(dir, 'vendor', 'boards'))) put('boards/' + f, path.join(dir, 'vendor', 'boards', f));
for (const f of SOUND_FILES) put(f, path.join(SOUNDS, f.slice('sounds/'.length)), { keep: true });
// Add to Home Screen opens the page without the browser's bars (iPhone Safari has no other way to lose them).
// The icons are the tab icon above drawn as PNGs; the maskable and Apple ones are full-bleed for the launcher to round.
const ICONS = path.join(app, 'icons');
for (const f of filesIn(ICONS)) put(f, path.join(ICONS, f), { keep: true });
const manifest = {
  name: 'Chess Replay', short_name: 'Chess Replay', description: DESCRIPTION,
  start_url: './', scope: './', display: 'fullscreen', display_override: ['fullscreen', 'standalone'], orientation: 'any',
  background_color: '#f2ece3', theme_color: '#f2ece3', // --bg in app/shell.html (light)
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
put('manifest.webmanifest', null, { keep: true, text: JSON.stringify(manifest, null, 2) + '\n' });
// The service worker (app/sw.js) and what it keeps: the page and the files put() kept, and the CDN files the page names
// (React and the fonts' stylesheet in shell.html, the export's libraries in export.jsx). The rest it is given here, each
// from the one place it is set: the board reader's cache name (VisionCore's CACHE, which a model update bumps), the
// cross-origin isolation headers (render.yaml's: removing them there removes them from the worker's answers too) and
// the hosts it keeps files from. Its VERSION is a hash of all that and of the kept files, so a deploy that changes one
// replaces the kept copies; the page itself is fetched afresh on every visit.
const SW_LOCAL = [PAGE, ...kept];
const VISION_CACHE = (() => {
  const m = [...read(path.join(app, 'vision-core.js')).matchAll(/const CACHE = '(chess-vision-\d+)'/g)];
  if (m.length !== 1) throw new Error('vision-core.js: no single `const CACHE = \'chess-vision-N\'`');
  return m[0][1];
})();
const swFilled = read(path.join(app, 'sw.js'))
  .replace('__LOCAL__', () => JSON.stringify(SW_LOCAL)).replace('__REMOTE__', () => JSON.stringify(SW_REMOTE, null, 2))
  .replace('__VISION_CACHE__', () => VISION_CACHE).replace('__ISOLATION__', () => JSON.stringify(require('./render-headers.cjs').isolation()))
  .replace('__KEEP_HOSTS__', () => JSON.stringify(CDN_HOSTS));
const swHash = require('crypto').createHash('sha256').update(swFilled);
for (const f of kept) swHash.update(fs.readFileSync(path.join(SITE, f)));
fs.writeFileSync(path.join(SITE, 'sw.js'), swFilled.replace('__VERSION__', swHash.digest('hex').slice(0, 16)));
console.log('wrote', site.length, 'bytes (site)');
