// The page's colours in both themes, one source: build.cjs writes them into app/shell.html as its CSS tokens (each key
// k as --k, camelCase as kebab-case: lineStrong is --line-strong; at the /*THEME:light*/ and /*THEME:dark*/ marks, the
// dark ones twice, for the system's dark and the page's own Dark setting; lightMore and darkMore, the system's "more
// contrast" over each, at their own marks) and the manifest's colour (bg), and the views'
// palettes (PALETTES in game-video-core.jsx) take theirs from here: bg, panel, line, ink, dim, and the colours that are
// the same thing under two names, accent (the last move: C.last), ok (a best move: C.best), warn (a mistake: C.mistake),
// danger (a blunder: C.blunder) and queen. Differences kept on purpose, in PALETTES: the views' halo is the start of a
// list of shadows each box ends itself (here the whole list), their scrim is a bare r, g, b to which each adds its own
// alpha, and ctlLine (a control's edge) is stronger than lineStrong
window.THEME = {
  light: {
    bg: '#f2ece3',
    panel: '#fbf7f1',
    raise: '#ebe3d6',
    line: 'rgba(60, 40, 20, 0.14)',
    lineStrong: 'rgba(60, 40, 20, 0.3)',
    ink: '#2a211b',
    dim: '#6b5f53',
    accent: '#8a5e15',
    accentInk: '#fffaf2',
    danger: '#c0392b',
    ok: '#237a46',
    warn: '#b05616',
    queen: '#c03f7c',
    track: 'rgba(60, 40, 20, 0.16)',
    btn: 'var(--raise)',
    btnLine: 'var(--line)',
    btnHover: '#ddd2c0',
    panelGlass: '#fbf7f1',
    glass: '85%', // how opaque the frosted glass is (shell.html's materials): secondary text keeps 4.5:1 over the board
    netTint: '22%',
    netLine: '60%',
    scrim: 'rgba(242, 236, 227, 0.86)',
    shadow: 'rgba(60, 40, 20, 0.18)',
    halo: '0 0 0 transparent',
  },
  dark: {
    bg: '#13100f',
    panel: '#1b1715',
    raise: '#241e1b',
    line: 'rgba(255, 236, 214, 0.1)',
    lineStrong: 'rgba(255, 236, 214, 0.25)',
    ink: '#efe8de',
    dim: '#9a8e82',
    accent: '#e3b55b',
    accentInk: '#15100d',
    danger: '#e4553f',
    ok: '#62c483',
    warn: '#ec9442',
    queen: '#e0609f',
    track: 'rgba(255, 236, 214, 0.16)',
    btn: '#3a312c',
    btnLine: 'rgba(255, 236, 214, 0.28)',
    btnHover: '#5a4d44',
    panelGlass: '#1b1715',
    glass: '92%',
    netTint: '26%',
    netLine: '65%',
    scrim: 'rgba(19, 16, 15, 0.82)',
    shadow: 'rgba(0, 0, 0, 0.45)',
    halo: '0 0 3px rgba(255, 236, 214, 0.3), 0 0 14px rgba(255, 236, 214, 0.14), 0 0 36px rgba(255, 236, 214, 0.1), 0 10px 40px rgba(255, 236, 214, 0.07)',
  },
  // the system's "more contrast" (prefers-contrast: more), over each theme: lines and edges you can see, secondary text
  // nearer the ink, the scrim nearly solid, no glow. The panels are opaque then too (shell.html's materials fallback)
  lightMore: {
    line: 'rgba(60, 40, 20, 0.42)',
    lineStrong: 'rgba(60, 40, 20, 0.7)',
    dim: '#4a4038',
    btnLine: 'rgba(60, 40, 20, 0.6)',
    track: 'rgba(60, 40, 20, 0.4)',
    scrim: 'rgba(242, 236, 227, 0.95)',
  },
  darkMore: {
    line: 'rgba(255, 236, 214, 0.38)',
    lineStrong: 'rgba(255, 236, 214, 0.65)',
    dim: '#c8bcaf',
    btnLine: 'rgba(255, 236, 214, 0.6)',
    track: 'rgba(255, 236, 214, 0.4)',
    scrim: 'rgba(19, 16, 15, 0.95)',
    halo: '0 0 0 transparent',
  },
};
// a theme's CSS tokens, as declarations
window.THEME.css = (mode) =>
  Object.entries(window.THEME[mode])
    .map(([k, v]) => `--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}: ${v};`)
    .join(' ');
