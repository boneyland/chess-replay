// The sample game's commentary (Carlsen–Nepomniachtchi, Global Chess League 2026, final, game 2), as the notes file the
// loader reads: [INTRO], then the note after each ply (1 = White's first move). Its PGN is src/sample-game.js, its
// analysis app/sample-analysis.js
(function () {
  const COMMENTS = {
    12: 'The Open Catalan: Black grabs the c4-pawn. White will win it back.',
    15: 'Qxc4 — the pawn is regained. Material is level.',
    31: 'Knights come off on e5, and White’s d-pawn lands there.',
    35: 'Another pair of minor pieces off. Stockfish calls it level.',
    39: 'Rxa6 picks up a pawn, but the engine still calls it level.',
    40: 'Qb7?! lets the white queen into a5. c4 was best.',
    44: 'Qc6 — Stockfish preferred trading queens with Bxa5. White is pressing.',
    46: 'Bb6?! White is now two pawns better on the engine.',
    54: '+2.97 — Carlsen’s best moment of the game.',
    55: 'Qxb5?? grabs a second pawn and throws the advantage away. Be3 was best.',
    56: 'c4! The passed pawn and the b6-bishop wake up at once.',
    58: 'Bxf2+ — a bishop sacrifice that strips the white king.',
    60: 'Rxb2+ — the rook joins the attack with check.',
    61: 'Kf1 — Kg1 was Stockfish’s defence. Black is now clearly better.',
    63: 'Rd2?? With under six minutes left, Carlsen offers the rook trade. Rd4 was best.',
    66: 'cxb2 — a black pawn one step from queening.',
    69: 'Bd2? Played with 1:23 on the clock. Be3 was best.',
    75: 'a4 — White is under a minute.',
    78: 'Bd3 guards the queening square b1. 0–1.',
  };
  window.SAMPLE_NOTES = '[INTRO]\nFinal, game 2. Carlsen has White in a Catalan.\n\n' + Object.keys(COMMENTS).map((k) => '[' + k + '] ' + COMMENTS[k]).join('\n\n') + '\n';
})();
