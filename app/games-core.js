// My games: the games played at the board (PlayCore), kept in the browser as they go. The list is
// [{ id, updated, board }], newest first: id the game's (board.game.id), updated a time in ms, board in BoardCore.save's
// form, so a game in progress resumes with its clocks and result. Lists are never mutated.
(function () {
  const KEEP = 50;
  const B = () => window.BoardCore;

  // The stored list back (a JSON string, or null): entries shaped like a kept game (an id, a time, a board whose game
  // has that id), the first of each id, the newest KEEP. Never throws, whatever localStorage held. Only the shape is
  // checked, as this runs on every move: whether a board still restores is the list's reader's business (playable), so a
  // game a later version can't read isn't dropped from storage by the next write.
  function read(raw) {
    const list = parse(raw);
    if (!list) return [];
    const seen = new Set(), out = [];
    for (const e of list) {
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || seen.has(e.id) || !Number.isFinite(e.updated)) continue;
      const b = e.board, g = b && typeof b === 'object' && b.game;
      if (!g || typeof g !== 'object' || g.id !== e.id || typeof b.fen !== 'string' || !Array.isArray(b.moves) || !b.moves.length) continue;
      seen.add(e.id);
      out.push({ id: e.id, updated: e.updated, board: b });
    }
    return out.sort((a, b) => b.updated - a.updated).slice(0, KEEP);
  }

  // The stored text as an array, or null when there is text that isn't one (a write would replace every game in it)
  function parse(raw) {
    if (raw == null || raw === '') return [];
    try { const list = JSON.parse(raw); return Array.isArray(list) ? list : null; } catch (e) { return null; }
  }
  const readable = (raw) => parse(raw) != null;

  // An entry's board restored, when it is still a game with moves; null otherwise
  function playable(e) {
    const b = B().restore(e.board);
    return b && b.game && window.PlayCore.played(b) && b.game.id === e.id ? b : null;
  }

  // The list with this game kept, first: from its first move; a game with no moves (all taken back) leaves the list
  function keep(list, board, now) {
    const g = board && board.game;
    if (!g || !g.id) return list;
    const rest = list.filter((e) => e.id !== g.id);
    if (!window.PlayCore.played(board)) return rest;
    return [{ id: g.id, updated: now, board: B().save(board) }].concat(rest).slice(0, KEEP);
  }

  const remove = (list, id) => list.filter((e) => e.id !== id);

  window.GamesCore = { KEEP, read, readable, playable, keep, remove };
})();
