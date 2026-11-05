import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, managedMappings, reconcileGate, requirements } from './game-parity-ledger.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
test('current catalog includes FS25 and four managed bridges without promoting historical claims', () => {
  const ledger = generate(root);
  assert.equal(Object.keys(ledger.managed_mappings).length, 4);
  assert.ok(ledger.games.some(g => g.path === 'farming-simulator/egg-farming-simulator-25.json'));
  assert.equal(new Set(ledger.games.map(g => g.path)).size, ledger.total);
  assert.equal(ledger.complete, 0);
  for (const path of ['web/src/client/consoleFormatting.ts', 'web/src/client/consoleOutput.ts', 'web/src/client/gameTemplateModel.ts', 'internal/panel/game_quick_setup.go']) {
    assert.ok(ledger.sources.some(source => source.path === path), `Verification fingerprint must include ${path}`);
  }
  assert.ok(ledger.games.some(g => g.historical_claim.verification === 'runtime_verified'));
  for (const game of ledger.games.filter(game => game.managed_game)) {
    assert.equal(game.gates.settings.status, 'partial', 'managed handler coverage is source-only evidence');
    assert.ok(game.gates.settings.evidence.includes('internal/panel/game_settings_documents.go'));
  }
  for (const game of ledger.games) {
    assert.deepEqual(Object.keys(game.gates), Object.keys(requirements));
    assert.equal(game.complete, false);
    assert.ok(Object.values(game.gates).every(g => g.status !== 'verified'));
  }
  assert.deepEqual(generate(root), ledger, 'no clock, nondeterministic ordering or mutable progress input');
});

test('gate verification requires complete local native receipt and stays independent', () => {
  const folder = mkdtempSync(resolve(tmpdir(), 'voltra-ledger-'));
  try {
    writeFileSync(resolve(folder, 'receipt.json'), '{}');
    const baseline = { status: 'unknown', evidence: [] };
    const receipt = { status: 'verified', fingerprint: 'current', kind: 'native_server', environment: 'windows-docker-desktop-linux-local-npipe', evidence: ['receipt.json'], reason: 'root reviewed native console evidence', checks: Object.fromEntries(requirements.console.map(check => [check, true])) };
    assert.equal(reconcileGate(folder, 'console', baseline, receipt, 'current').status, 'verified');
    assert.equal(reconcileGate(folder, 'lifecycle', baseline, undefined, 'current').status, 'unknown');
    for (const mutation of [
      { fingerprint: 'old' }, { kind: 'fixture' }, { environment: 'home-server' },
      { checks: { ...receipt.checks, crash: false } }, { evidence: [] },
      { evidence: ['missing.json'] }, { evidence: ['../receipt.json'] },
      { evidence: ['C:/secrets.txt'] }, { status: 'runtime_verified' },
    ]) assert.throws(() => reconcileGate(folder, 'console', baseline, { ...receipt, ...mutation }, 'current'));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('mapping parser fails closed and source setup blockers stay scoped', () => {
  assert.throws(() => managedMappings('function changed() {}'));
  const ledger = generate(root);
  for (const game of ledger.games.filter(g => g.gates.setup.status === 'blocked')) {
    assert.ok(game.gates.setup.reason);
    assert.equal(game.gates.lifecycle.status, 'unknown');
  }
  assert.throws(() => generate(root, { 'not-a-current-game': {} }), /Unknown receipt recipe/);
  assert.throws(() => generate(root, { [ledger.games[0].path]: { gameplay: {} } }), /Unknown receipt gate/);
});
