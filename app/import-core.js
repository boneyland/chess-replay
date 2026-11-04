// Import game's paste box: what the pasted text is. One line that looks like a FEN (or a lone [FEN "…"] tag) is a
// position, read by EditCore (legal or not; the caller decides where it opens); anything else must build as a PGN.
// read(text) → { setup } | { pgn } | { error }
(function () {
  const looksFen = (t) => !/\n/.test(t) && (/^\[\s*FEN\s/i.test(t) || (t.split(/\s/)[0].match(/\//g) || []).length === 7);

  function read(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return { error: 'Paste a PGN or FEN first.' };
    if (looksFen(t)) {
      const r = window.EditCore.fromFen(t);
      return r.setup ? { setup: r.setup } : { error: r.error };
    }
    try { window.ChessCore.buildGame({ pgn: t }); } catch (e) { return { error: (e && e.message) || 'That isn’t a PGN or FEN this page can read.' }; }
    return { pgn: t };
  }

  window.ImportCore = { read };
})();
