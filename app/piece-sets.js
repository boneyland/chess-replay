// Piece sets: Lichess's freely licensed ones (lila's COPYING.md). cburnett, the default, is in the page itself
// (window.PIECE_IMG, src/pieces.js) so the board draws at once; the others are lila's SVGs, unchanged, that build.cjs
// serves next to the page as pieces/<set>/<piece>.svg (vendor/pieces), fetched only when chosen and kept by the
// service worker as they're used.
(function () {
  const PIECES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
  const LIC = {
    'GPL-2.0-or-later': 'https://www.gnu.org/licenses/gpl-2.0.txt', 'GPL-3.0-or-later': 'https://www.gnu.org/licenses/gpl-3.0.html',
    'AGPL-3.0-or-later': 'https://www.gnu.org/licenses/agpl-3.0.html', 'Apache 2.0': 'https://www.apache.org/licenses/LICENSE-2.0',
    MIT: 'https://opensource.org/license/mit', 'CC0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
    'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/', 'CC BY-NC-SA 4.0': 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    'CC BY-NC-SA 2.5': 'https://xkcd.com/license.html',
  };
  // [id, name, author, licence, author's page]; the first is the default, then the open sets, then the non-commercial ones
  const SETS = [
    ['cburnett', 'Cburnett', 'Colin M.L. Burnett', 'GPL-2.0-or-later', 'https://en.wikipedia.org/wiki/User:Cburnett'],
    ['merida', 'Merida', 'Armando Hernandez Marroquin', 'GPL-2.0-or-later'],
    ['chessnut', 'Chessnut', 'Alexis Luengas', 'Apache 2.0', 'https://github.com/LexLuengas/chessnut-pieces'],
    ['fantasy', 'Fantasy', 'Maurizio Monge', 'MIT', 'https://github.com/maurimo/chess-art'],
    ['spatial', 'Spatial', 'Maurizio Monge', 'MIT', 'https://github.com/maurimo/chess-art'],
    ['celtic', 'Celtic', 'Maurizio Monge', 'MIT', 'https://github.com/maurimo/chess-art'],
    ['rhosgfx', 'RhosGFX', 'RhosGFX', 'CC0 1.0', 'https://rhosgfx.itch.io/'],
    ['kiwen-suwi', 'Kiwen-suwi', 'neverRare', 'CC BY 4.0', 'https://github.com/neverRare'],
    ['firi', 'Firi', 'James Faure', 'CC BY 4.0', 'https://github.com/jfaure/Firi-pieceset'],
    ['letter', 'Letter', 'usolando', 'AGPL-3.0-or-later', 'https://lichess.org/@/usolando'],
    ['pirouetti', 'Pirouetti', 'pirouetti', 'AGPL-3.0-or-later', 'https://lichess.org/@/pirouetti'],
    ['pixel', 'Pixel', 'therealqtpi', 'AGPL-3.0-or-later'],
    ['mpchess', 'MPChess', 'Maxime Chupin', 'GPL-3.0-or-later', 'https://github.com/chupinmaxime'],
    ['staunty', 'Staunty', 'sadsnake1', 'CC BY-NC-SA 4.0'],
    ['maestro', 'Maestro', 'sadsnake1', 'CC BY-NC-SA 4.0'],
    ['fresca', 'Fresca', 'sadsnake1', 'CC BY-NC-SA 4.0'],
    ['cardinal', 'Cardinal', 'sadsnake1', 'CC BY-NC-SA 4.0'],
    ['icpieces', 'ICpieces', 'sadsnake1', 'CC BY-NC-SA 4.0'],
    ['gioco', 'Gioco', 'sadsnake1', 'CC BY-NC-SA 4.0'],
    ['tatiana', 'Tatiana', 'sadsnake1', 'CC BY-NC-SA 4.0'],
    ['dubrovny', 'Dubrovny', 'sadsnake1', 'CC BY-NC-SA 4.0'],
    ['california', 'California', 'Jerry S.', 'CC BY-NC-SA 4.0', 'https://sites.google.com/view/jerrychess/home'],
    ['caliente', 'Caliente', 'avi', 'CC BY-NC-SA 4.0', 'https://github.com/avi-0/caliente'],
    ['cooke', 'Cooke', 'fejfar', 'CC BY-NC-SA 4.0', 'https://github.com/fejfar'],
    ['minimal-warmth', 'Minimal warmth', 'blunder_reign', 'CC BY-NC-SA 4.0', 'https://lichess.org/@/blunder_reign'],
    ['xkcd', 'xkcd', 'Randall Munroe', 'CC BY-NC-SA 2.5', 'https://xkcd.com/about'],
  ].map(([id, name, by, licence, home]) => ({ id, name, by, licence, licenceUrl: LIC[licence], home: home || null }));
  const DEFAULT = SETS[0].id, IDS = SETS.map((s) => s.id);
  // non-commercial sets (CC BY-NC-SA): drawn on the page but kept out of exported videos, which viewers may post
  // anywhere, monetised channels included; an export draws the default in their place (as Sfx.exportSet does)
  const NON_COMMERCIAL = SETS.filter((s) => /NC/.test(s.licence)).map((s) => s.id);
  const valid = (id) => (IDS.includes(id) ? id : DEFAULT);
  const exportSet = (id) => (NON_COMMERCIAL.includes(valid(id)) ? DEFAULT : valid(id));
  const byId = (id) => SETS.find((s) => s.id === valid(id));
  const url = (id, piece) => (valid(id) === DEFAULT ? window.PIECE_IMG[piece] : `pieces/${id}/${piece}.svg`);

  // A set is drawn only once all twelve pictures have decoded, so the board never mixes sets or shows a broken one;
  // the decoded pictures are held here, so the board's <img>s (and an export's first frame) find them at once. A
  // failed load (offline before the set was ever kept) is forgotten, so the next asks again.
  const kept = { [DEFAULT]: true }, loading = {};
  const ready = (id) => !!kept[valid(id)];
  const load = (id, make = () => new Image()) => {
    id = valid(id);
    if (kept[id]) return Promise.resolve(true);
    if (loading[id]) return loading[id];
    const imgs = PIECES.map((p) => { const im = make(); im.src = url(id, p); return im; });
    return (loading[id] = Promise.all(imgs.map((im) => im.decode())).then(
      () => { kept[id] = imgs; delete loading[id]; return true; },
      () => { delete loading[id]; return false; },
    ));
  };

  window.PieceSets = { PIECES, SETS, DEFAULT, NON_COMMERCIAL, valid, exportSet, byId, url, ready, load };
})();
