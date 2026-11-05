import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderUntested} from './game-parity-untested.mjs';

test('list preserves every incomplete recipe and distinguishes missing native acceptance from no tests', () => {
  const ledger = JSON.parse(fs.readFileSync(new URL('../../artifacts/game-parity-20261029/inventory.json', import.meta.url)));
  const output = renderUntested(ledger);
  assert.match(output, /does not mean no tests have run/);
  assert.equal(output.split('\n').filter(line => /^\d+\. /.test(line)).length, ledger.total - ledger.complete);
  for (const game of ledger.games.filter(game => !game.complete)) assert.ok(output.includes('`' + game.path + '`'));
  const synthetic = {total: 2, complete: 1, games: [
    {name: 'Done', path: 'done', complete: true, native_evidence_gaps: []},
    {name: 'Waiting', path: 'waiting', complete: false, native_evidence_gaps: ['lifecycle']},
  ]};
  assert.ok(!renderUntested(synthetic).includes('Recipe: `done`'));
  assert.match(renderUntested(synthetic), /Waiting.*lifecycle/);
});
