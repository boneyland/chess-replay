// Import game's paste box: what the pasted text is. A Lichess link (LichessCore.gameLink) is fetched by the dialog; one
// line that looks like a FEN (or a lone [FEN "…"] tag) is a position, read by EditCore (legal or not; the caller decides
// where it opens); anything else must be standard chess and build as a PGN (pgn()). read(text) → { link } | { setup } | { pgn } | { error }
(function () {
  const looksFen = (t) => !/\n/.test(t) && (/^\[\s*FEN\s/i.test(t) || (t.split(/\s/)[0].match(/\//g) || []).length === 7);

  function read(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return { error: 'Paste a PGN, a FEN or a Lichess link first.' };
    const link = window.LichessCore && window.LichessCore.gameLink(t);
    if (link) return { link };
    if (/^(https?:\/\/|www\.|lichess\.org)\S*$/i.test(t)) return { error: 'That link isn’t a Lichess game, broadcast or study.' };
    if (looksFen(t)) {
      const r = window.EditCore.fromFen(t);
      return r.setup ? { setup: r.setup } : { error: r.error };
    }
    return pgn(t);
  }

  // A PGN, pasted or fetched from Lichess, as the page will open it: { pgn } when it is standard chess and builds, else
  // { error } saying why, so the dialog can say so before it closes or changes anything
  function pgn(text) {
    const v = window.LichessCore && window.LichessCore.variant(text);
    if (v) return { error: `That’s a ${v} game: only standard chess opens here.` };
    try { window.ChessCore.buildGame({ pgn: text }); } catch (e) { return { error: (e && e.message) || 'That isn’t a PGN, FEN or Lichess link this page can read.' }; }
    return { pgn: text };
  }

  window.ImportCore = { read, pgn };
})();
