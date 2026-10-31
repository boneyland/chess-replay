// Assemble the page (out/site): plain scripts inlined as-is, JSX precompiled with Babel, each unit in its own scope.
const fs = require('fs'), path = require('path');
const dir = __dirname, src = path.join(dir, 'src'), app = path.join(dir, 'app');
const Babel = require(path.join(dir, 'babel', 'babel.min.js'));
const jsx = (code, name) => Babel.transform(code, { filename: name, presets: ['react'] }).code;
const read = (p) => fs.readFileSync(p, 'utf8');
// Lichess's Enigmahack sound sets (AGPL-3.0-or-later, vendor/sounds), inlined as base64 MP3s: { sfx: { move: '…' }, … }
const SOUNDS = path.join(dir, 'vendor', 'sounds');
const soundsData = () => Object.fromEntries(['futuristic', 'nes', 'piano', 'sfx'].map((set) => [set, Object.fromEntries(['Move', 'Capture', 'Check', 'Victory', 'Draw'].map((f) => [f.toLowerCase(), fs.readFileSync(path.join(SOUNDS, set, f + '.mp3')).toString('base64')]))]));
const units = [
  ['pieces.js', read(path.join(src, 'pieces.js'))],
  ['chess-core.js', read(path.join(app, 'chess-core.js'))],
  ['analysis-core.js', read(path.join(app, 'analysis-core.js'))],
  ['lichess-core.js', read(path.join(app, 'lichess-core.js'))],
  ['openings-data.js', 'window.OPENINGS_TSV = ' + JSON.stringify(require('./openings-data.cjs').openingsTsv()).replace(/</g, '\\u003c') + ';'],
  ['openings-core.js', read(path.join(app, 'openings-core.js'))],
  ['board-core.js', read(path.join(app, 'board-core.js'))],
  ['edit-core.js', read(path.join(app, 'edit-core.js'))],
  ['layout-core.js', read(path.join(app, 'layout-core.js'))],
  ['play-core.js', read(path.join(app, 'play-core.js'))],
  ['games-core.js', read(path.join(app, 'games-core.js'))],
  ['sf-engine.js', read(path.join(app, 'sf-engine.js'))],
  ['sf-full.js', read(path.join(app, 'sf-full.js'))],
  ['queen-core.js', read(path.join(app, 'queen-core.js'))],
  ['sounds-data.js', 'window.SFX_DATA = ' + JSON.stringify(soundsData()) + ';'],
  ['sfx-core.js', read(path.join(app, 'sfx-core.js'))],
  ['drag-scroll.js', read(path.join(app, 'drag-scroll.js'))],
  ['webp-core.js', read(path.join(app, 'webp-core.js'))],
  ['export-draw.js', read(path.join(app, 'export-draw.js'))],
  ['sample-game.js', read(path.join(src, 'sample-game.js'))],
  ['game-data.js', read(path.join(src, 'game-data.js'))],
  ['sample-analysis.js', read(path.join(app, 'sample-analysis.js'))],
  ['engine.jsx', jsx(read(path.join(app, 'engine.jsx')), 'engine.jsx')],
  ['tweaks.jsx', jsx(read(path.join(app, 'tweaks.jsx')), 'tweaks.jsx')],
  ['game-video.jsx', jsx(read(path.join(app, 'game-video-core.jsx')) + '\n' + read(path.join(app, 'queen.jsx')) + '\n' + read(path.join(app, 'stockfish.jsx')) + '\n' + read(path.join(app, 'tablebase.jsx')) + '\n' + read(path.join(app, 'explorer.jsx')) + '\n' + read(path.join(app, 'free-board.jsx')) + '\n' + read(path.join(app, 'edit-board.jsx')) + '\n' + read(path.join(app, 'sfx.jsx')) + '\n' + read(path.join(app, 'export.jsx')) + '\n' + read(path.join(app, 'game-app.jsx')), 'game-video.jsx')],
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
const VENDOR = ['stockfish-19-asm.js', 'stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm', 'stockfish-19-lite.js', 'stockfish-19-lite.wasm', 'webp_enc_simd.js', 'webp_enc_simd.wasm', 'mediabunny.min.js'];
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
const SW_REMOTE = [...new Set([read(path.join(app, 'shell.html')), read(path.join(app, 'export.jsx'))].join('\n')
  .match(/https:\/\/(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com\/css2)[^'"\s]*/g))].filter((u) => !/\/$/.test(u));
const CDN_SCRIPTS = SW_REMOTE.filter((u) => /\.js$/.test(u));
const inlineHashes = [...site.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${require('crypto').createHash('sha256').update(m[1]).digest('base64')}'`);
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${CDN_SCRIPTS.join(' ')} ${inlineHashes.join(' ')}`,
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data: https://huggingface.co https://boneyland-queen-pawn-8.hf.space https://tablebase.lichess.ovh https://explorer.lichess.ovh https://lichess.org https://unpkg.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');
fs.writeFileSync(path.join(dir, 'out', 'site', 'chess-game-video.html'), site.replace('<meta charset="utf-8">\n', () => `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">\n`));
// the engine, the WebP export's encoder and the MP4 export's muxer, served next to the page, and the link preview's image (a
// 1653×944 frame from the player)
fs.copyFileSync(path.join(app, 'og-image.png'), path.join(dir, 'out', 'site', 'og-image.png'));
for (const f of VENDOR) fs.copyFileSync(path.join(dir, 'vendor', f), path.join(dir, 'out', 'site', f));
// Add to Home Screen opens the page without the browser's bars (iPhone Safari has no other way to lose them).
// The icons are the tab icon above drawn as PNGs; the maskable and Apple ones are full-bleed for the launcher to round.
const ICONS = path.join(app, 'icons');
for (const f of fs.readdirSync(ICONS)) fs.copyFileSync(path.join(ICONS, f), path.join(dir, 'out', 'site', f));
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
fs.writeFileSync(path.join(dir, 'out', 'site', 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
// The service worker (app/sw.js) and what it keeps: the files next to the page, and the CDN files the page names (React
// and the fonts' stylesheet in shell.html, the export's libraries in export.jsx). Its VERSION changes with any of
// them, so a deploy that changes one replaces the kept copies; the page itself is fetched afresh on every visit.
const SW_LOCAL = ['chess-game-video.html', 'manifest.webmanifest', ...fs.readdirSync(ICONS), ...VENDOR];
const swSrc = read(path.join(app, 'sw.js'));
const swHash = require('crypto').createHash('sha256').update(swSrc).update(JSON.stringify(SW_REMOTE));
for (const f of SW_LOCAL.slice(1)) swHash.update(fs.readFileSync(path.join(dir, 'out', 'site', f)));
fs.writeFileSync(path.join(dir, 'out', 'site', 'sw.js'), swSrc.replace('__VERSION__', swHash.digest('hex').slice(0, 16))
  .replace('__LOCAL__', JSON.stringify(SW_LOCAL)).replace('__REMOTE__', JSON.stringify(SW_REMOTE, null, 2)));
console.log('wrote', site.length, 'bytes (site)');
