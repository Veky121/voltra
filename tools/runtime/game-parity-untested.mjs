// A reviewable list of missing native evidence, separate from fixture results.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function renderUntested(ledger) {
  const games = ledger.games.filter(game => !game.complete);
  games.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : a.path < b.path ? -1 : 1);
  const text = value => String(value).replace(/[\r\n]/g, ' ').replace(/([\\`*\[\]])/g, '\\$1');
  return '# Games awaiting complete native acceptance\n\n' +
    `${games.length} of ${ledger.total} catalog entries lack complete five-gate campaign evidence. ` +
    'This does not mean no tests have run. Source tests, offline fixtures and earlier runtime evidence remain recorded separately.\n\n' +
    'Each entry needs every gate verified against current source on Windows Docker Desktop. ' +
    'See inventory.json for gate reasons, source fingerprints and evidence paths.\n\n' +
    games.map((game, index) => `${index + 1}. ${text(game.name)}. Pending ${game.native_evidence_gaps.join(', ')}. Recipe: \`${game.path}\``).join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../artifacts/game-parity-20261029');
  const ledger = JSON.parse(fs.readFileSync(path.join(folder, 'inventory.json')));
  fs.writeFileSync(path.join(folder, 'UNTESTED-GAMES.md'), renderUntested(ledger));
  console.log(`Wrote ${ledger.total - ledger.complete} incomplete catalog entries.`);
}
