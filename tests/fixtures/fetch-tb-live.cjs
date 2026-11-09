// Writes tests/fixtures/tb-live.json: Lichess's real tablebase answers for every position the live tests ask
// (tests/live/site.test.cjs, fakeTablebase), keyed by LichessCore.tbKey (the FEN without its move number). Run it again,
// with the network, after a live test starts asking a new position: node tests/fixtures/fetch-tb-live.cjs
const fs = require('fs'), path = require('path');
const { loadUnit } = require('../load.cjs');
loadUnit('chess-core.js'); loadUnit('lichess-core.js'); loadUnit('analysis-core.js');
const LC = window.LichessCore, A = window.AnalysisCore;
const KBNK = '8/8/8/4k3/8/8/3KB3/7N w - - 0 1';
const fens = [
  // the free board's endgame, its cursed twin (60 plies gone) and the analysed KBN v K game's positions (the free
  // board's Ke3 is the game's first move)
  ...A.positionFens(KBNK, ['d2e3', 'e5d5', 'e2c4', 'd5c4']),
  '8/8/8/4k3/8/8/3KB3/7N w - - 60 80',
];
(async () => {
  const out = {};
  for (const fen of fens) {
    const r = await fetch(LC.tablebaseUrl(fen), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${fen}: HTTP ${r.status}`);
    out[LC.tbKey(fen)] = await r.json();
    await new Promise((res) => setTimeout(res, 1500)); // Lichess asks for one request at a time
  }
  fs.writeFileSync(path.join(__dirname, 'tb-live.json'), JSON.stringify(out) + '\n');
  console.log(Object.keys(out).join('\n'));
})();
