// How build.cjs turns a unit's source into the page's script: JSX compiled with Babel's React preset, a plain script
// left as written, and the comments of both dropped (they stay in the sources; about 260 KB of the page's 1.4 MB of
// script, parsed on every visit), but a licence's (/*!, @license, @preserve). compact: false, or Babel squeezes a unit
// over 500 KB (game-video.jsx since the Prettier pass) onto a few long lines, which makes the crash screen's line and
// column numbers useless. tests/build.test.cjs checks the page against these
const path = require('path');
const Babel = require(path.join(__dirname, 'babel', 'babel.min.js'));
const keepComment = (c) => /^!|@license|@preserve/.test(c);
const jsx = (code, name) =>
  Babel.transform(code, { filename: name, presets: ['react'], compact: false, shouldPrintComment: keepComment }).code;
const plain = (code, name) =>
  Babel.transform(code, { filename: name, sourceType: 'script', compact: false, shouldPrintComment: keepComment }).code;
module.exports = { jsx, plain };
