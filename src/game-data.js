window.GAME = {
  white: { name: 'Carlsen, Magnus', short: 'Carlsen', title: 'GM', elo: 2803, team: 'Alpine APL Pipers', acc: 88.2 },
  black: { name: 'Nepomniachtchi, Ian', short: 'Nepomniachtchi', title: 'GM', elo: 2729, team: 'Ganges Grandmasters', acc: 96.5 },
  event: 'Global Chess League', stage: 'Final, Game 2', round: '34.1', site: 'Bengaluru, India', date: '31 Aug 2026',
  eco: 'E05', opening: 'Catalan Opening: Open Defense, Classical Line', result: '0-1', winner: 'b',
  engine: 'Stockfish 19 · 4s per position · 1 line · 7 threads',
  san: 'Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 c4 O-O d4 dxc4 Qa4 a6 Qxc4 b5 Qc2 Bb7 Bd2 Be4 Qc1 c6 Rd1 Nbd7 Bf4 Rc8 Nc3 Bg6 Ne5 Nxe5 dxe5 Nd5 e4 Nxc3 Qxc3 Qc7 Rd6 c5 Rxa6 Qb7 Qa5 Bd8 Ra7 Qc6 Qa6 Bb6 Rb7 Rb8 Rxb8 Rxb8 Rd1 h6 Rd6 Qc7 Qxb5 c4 Qd7 Bxf2+ Kxf2 Rxb2+ Kf1 Qc5 Rd2 c3 Rxb2 cxb2 Qd3 Bh5 Bd2 Qb6 Qb1 Qb5+ Kg1 Be2 a4 Qb6+ Kh1 Bd3'.split(' '),
  uci: 'g1f3 d7d5 g2g3 g8f6 f1g2 e7e6 e1g1 f8e7 c2c4 e8g8 d2d4 d5c4 d1a4 a7a6 a4c4 b7b5 c4c2 c8b7 c1d2 b7e4 c2c1 c7c6 f1d1 b8d7 d2f4 a8c8 b1c3 e4g6 f3e5 d7e5 d4e5 f6d5 e2e4 d5c3 c1c3 d8c7 d1d6 c6c5 d6a6 c7b7 c3a5 e7d8 a6a7 b7c6 a5a6 d8b6 a7b7 c8b8 b7b8 f8b8 a1d1 h7h6 d1d6 c6c7 a6b5 c5c4 b5d7 b6f2 g1f2 b8b2 f2f1 c7c5 d6d2 c4c3 d2b2 c3b2 d7d3 g6h5 f4d2 c5b6 d3b1 b6b5 f1g1 h5e2 a2a4 b5b6 g1h1 e2d3'.split(' '),
  // Stockfish eval after each ply, centipawns, White's point of view
  evalStart: 24,
  evals: [21,16,12,8,11,13,13,13,16,15,17,14,17,18,9,8,11,4,11,18,10,9,0,-5,-5,-9,-11,-17,-8,-5,-8,-3,0,-2,0,0,0,0,0,73,68,62,70,141,166,202,197,208,218,203,211,267,282,286,-13,-4,-1,0,-83,-102,-202,-394,-534,-561,-595,-623,-633,-640,-964,-1007,-1013,-1007,-1006,-1029,-1044,-1049,-1052,-1023],
  clocks: '19:56 19:59 19:54 19:57 19:52 19:56 19:50 19:55 19:45 19:52 19:39 19:40 19:32 19:38 19:30 19:37 19:29 19:36 19:26 19:15 19:25 19:06 19:02 19:03 18:51 18:35 18:24 18:32 18:22 18:00 18:20 17:46 18:08 17:45 18:06 16:33 18:02 15:21 15:29 15:13 15:06 12:36 14:48 12:27 12:43 10:38 12:05 10:38 12:04 10:36 11:28 10:22 10:50 10:21 10:21 10:20 8:52 10:16 8:34 10:14 5:47 9:07 5:27 8:04 5:26 8:03 5:24 6:10 1:23 4:21 1:22 3:45 1:20 3:40 0:37 3:36 0:31 3:33'.split(' ').map((s) => { const [m, x] = s.split(':'); return +m * 60 + +x; }),
  clockStart: 1200,
  // keyed by ply (1 = White's first move)
  marks: { 40: '?!', 44: '?!', 46: '?!', 55: '??', 59: '?!', 61: '?!', 63: '??', 69: '?' },
  unrated: [20, 23, 52, 75, 78],
  loss: { 1: 3, 3: 4, 6: 2, 20: 7, 23: 9, 40: 73, 44: 71, 46: 36, 52: 56, 55: 299, 59: 83, 61: 100, 63: 140, 69: 324, 75: 15, 78: 29 },
  best: {
    20: ['h7h6', 'h6 Rc1 Bd6 a3 Nbd7 Ba5'], 23: ['a2a4', 'a4 Nbd7 Nc3 Bg6 Nh4 Bh5'],
    40: ['c5c4', 'c4 Rd6 h6 h4 Rfd8 a4'], 44: ['d8a5', 'Bxa5 Rxb7'], 46: ['c6a6', 'Qxa6 Rxa6 c4 a4 bxa4 Bd2'],
    52: ['b8a8', 'Ra8 Rd6 Qxd6 Qxa8+ Qd8 Qxd8+'], 55: ['f4e3', 'Be3 b4 f4 Kh7 Bf3 f6'], 59: ['g1f1', 'Kf1 Qxd7 Rxd7 Rxb2 Rd8+ Kh7'],
    61: ['f2g1', 'Kg1 Qc5+ Rd4 Rb1+ Bf1 c3'], 63: ['d6d4', 'Rd4 c3 Bf3 Rxa2 g4 Kh7'], 69: ['f4e3', 'Be3 Qb4 Qb1 Bd1 Kf2 Bc2'],
    75: ['g2f1', 'Bf1 Bxf1 Qxf1 Qxf1+ Kxf1 b1=Q+'], 78: ['b6b3', 'Qb3 h3 Bd3 Qxb2 Qxb2 Be3'],
  },
  bookUntil: 20,
  comments: {
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
  },
};

// Sample game packaged in the same shapes the loader accepts (chess-animator analysis JSON + notes file)
(function () {
  const G = window.GAME;
  const ENG = { 40: 'inaccuracy', 44: 'inaccuracy', 59: 'inaccuracy', 61: 'inaccuracy', 63: 'inaccuracy', 69: 'inaccuracy', 55: 'blunder' };
  window.SAMPLE_ANALYSIS = {
    white: G.white.name, black: G.black.name, white_elo: String(G.white.elo), black_elo: String(G.black.elo), result: G.result,
    opening_name: G.opening, opening_eco: G.eco,
    moves: G.san.map((san, i) => {
      const p = i + 1, b = G.best[p];
      return { ply: p, move_san: san, move_uci: G.uci[i], eval_before: i ? G.evals[i - 1] : G.evalStart, eval_after: G.evals[i],
        classification: ENG[p] || (G.unrated.includes(p) || p === 46 ? '' : 'best'), eval_loss: G.loss[p] || 0,
        best_move_uci: b ? b[0] : G.uci[i], best_line: b ? b[1].split(' ') : [] };
    }),
    white_stats: { accuracy: 88.22706503354605 }, black_stats: { accuracy: 96.54816286266536 },
    engine: { name: 'Stockfish 19', depth: null, time_limit: 4.0, lines: 1, threads: 7, hash_mb: 256 },
  };
  window.SAMPLE_NOTES = '[INTRO]\nFinal, game 2. Carlsen has White in a Catalan.\n\n' + Object.keys(G.comments).map((k) => '[' + k + '] ' + G.comments[k]).join('\n\n') + '\n';
})();
