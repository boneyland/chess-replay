// The Lichess opening rows (eco \t name \t pgn) from openings/*.tsv (copied from chess-animator), header rows removed: embedded by build.cjs, read by tests
const fs = require('fs'),
  path = require('path');
const DIR = path.join(__dirname, 'openings');
function openingsTsv() {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.tsv'))
    .sort()
    .map((f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').slice(1).filter(Boolean).join('\n'))
    .join('\n');
}
module.exports = { openingsTsv };
