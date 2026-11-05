import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pending = readFileSync(resolve(root, 'artifacts/game-parity-20261029/banana-wave4-ledger.mjs.pending'), 'utf8');
const { generate, scopedBinding, reconcileGate, requirements } = await import('data:text/javascript;base64,' + Buffer.from(pending).toString('base64'));
const sha = x => createHash('sha256').update(x).digest('hex');
const write = (folder, path, value) => { mkdirSync(dirname(resolve(folder, path)), { recursive: true }); writeFileSync(resolve(folder, path), typeof value === 'string' ? value : JSON.stringify(value)); };

function fixture() {
  const folder = mkdtempSync(resolve(tmpdir(), 'voltra-scoped-ledger-'));
  const profile = { entry: { path: 'games/a.json', sha256: 'upstream', egg: { name: 'A', variables: [{ env_variable: 'PORT', default_value: '1234' }] } }, override: null, managed: null };
  write(folder, 'shared.go', 'shared dispatch'); write(folder, 'a-parser.go', 'parser A'); write(folder, 'b-parser.go', 'parser B');
  const review = { schema_version: 2, recipes: { 'games/a.json': { gates: { console: { coverage: 'reviewed_complete', review_id: 'synthetic-review-1', reviewed_by: 'synthetic-root', environment_identity: sha('environment'), paths: ['shared.go', 'a-parser.go'] } } } } };
  const bind = () => scopedBinding(folder, 'games/a.json', 'console', profile, review);
  const binding = bind();
  const checks = Object.fromEntries(requirements.console.map(k => [k, true]));
  const execution = { binary_sha256: sha('original immutable binary'), environment_identity: binding.environment_identity, context: { path: 'execution.json' } };
  write(folder, 'execution.json', { schema_version: 2, recipe: binding.recipe, gate: 'console', fingerprint: binding.fingerprint, kind: 'native_server', environment: 'windows-docker-desktop-linux-local-npipe', binary_sha256: execution.binary_sha256, environment_identity: execution.environment_identity, checks });
  execution.context.sha256 = sha(readFileSync(resolve(folder, 'execution.json')));
  write(folder, 'evidence.json', { checks, native_capture: 'synthetic fixture only' });
  const receipt = { schema_version: 2, status: 'verified', reason: 'synthetic bookkeeping fixture', fingerprint: binding.fingerprint, kind: 'native_server', environment: 'windows-docker-desktop-linux-local-npipe', checks, execution, evidence: ['evidence.json'], evidence_identity: [{ path: 'evidence.json', sha256: sha(readFileSync(resolve(folder, 'evidence.json'))) }] };
  const reconcile = (r = receipt, b = bind()) => reconcileGate(folder, 'console', { status: 'unknown', evidence: [] }, r, b);
  return { folder, profile, review, binding, bind, receipt, reconcile };
}

test('unrelated parser, other recipe review and new global binary preserve scoped evidence', () => {
  const f = fixture(); try {
    assert.equal(f.reconcile().status, 'verified');
    write(f.folder, 'b-parser.go', 'different unrelated parser');
    write(f.folder, 'current-binary', 'new overall build');
    f.review.recipes['games/b.json'] = { gates: { console: { paths: ['b-parser.go'] } } };
    assert.deepEqual(f.bind(), f.binding);
    assert.equal(f.reconcile().execution.binary_sha256, f.receipt.execution.binary_sha256);
  } finally { rmSync(f.folder, { recursive: true, force: true }); }
});

test('relevant shared, parser, exact ordered controls, and environment changes invalidate', () => {
  for (const mutation of [
    f => write(f.folder, 'shared.go', 'changed dispatch'),
    f => write(f.folder, 'a-parser.go', 'changed parser'),
    f => { f.profile.entry.egg.variables[0].default_value = '5678'; },
    f => { f.profile.override = { egg: { name: 'changed selected override' } }; },
    f => { f.review.recipes['games/a.json'].gates.console.environment_identity = sha('new environment'); },
    f => { f.review.recipes['games/a.json'].gates.console.paths.push('b-parser.go'); },
  ]) { const f = fixture(); try { mutation(f); assert.throws(() => f.reconcile(), /Stale/); } finally { rmSync(f.folder, { recursive: true, force: true }); } }
});

test('native identity, immutable execution and evidence hashes cannot be silently replaced', () => {
  for (const mutation of [
    f => write(f.folder, 'execution.json', { prose: 'everything verified' }),
    f => write(f.folder, 'evidence.json', 'changed evidence'),
    f => { f.receipt.execution.binary_sha256 = sha('other binary'); },
    f => { f.receipt.checks.crash = false; },
    f => { f.receipt.kind = 'fixture'; },
    f => { f.receipt.environment = 'home-server'; },
    f => { delete f.receipt.schema_version; },
    f => { f.receipt.evidence = ['../outside']; },
  ]) { const f = fixture(); try { mutation(f); assert.throws(() => f.reconcile()); } finally { rmSync(f.folder, { recursive: true, force: true }); } }
});

test('missing/incomplete dependency review fails closed and gates remain independent', () => {
  const f = fixture(); try {
    assert.equal(scopedBinding(f.folder, 'games/a.json', 'lifecycle', f.profile, f.review), null);
    assert.equal(reconcileGate(f.folder, 'lifecycle', { status: 'unknown', evidence: [] }, undefined, null).status, 'unknown');
    assert.throws(() => f.reconcile(f.receipt, null), /unreviewed/);
    f.review.recipes['games/a.json'].gates.console.coverage = 'guessed_from_filename';
    assert.throws(() => f.bind(), /Invalid dependency review/);
  } finally { rmSync(f.folder, { recursive: true, force: true }); }
});

test('rehashing a structurally wrong execution context still refuses; directories are not evidence', () => {
  const f = fixture(); try {
    const context = JSON.parse(readFileSync(resolve(f.folder, 'execution.json')));
    context.recipe = 'games/other.json';
    write(f.folder, 'execution.json', context);
    f.receipt.execution.context.sha256 = sha(readFileSync(resolve(f.folder, 'execution.json')));
    assert.throws(() => f.reconcile(), /Execution context mismatch: recipe/);
    f.receipt.evidence = ['folder']; mkdirSync(resolve(f.folder, 'folder'));
    assert.throws(() => f.reconcile(), /Missing\/unsafe/);
    f.review.recipes['games/a.json'].gates.console.paths = ['../outside'];
    assert.throws(() => f.bind(), /Missing\/unsafe/);
  } finally { rmSync(f.folder, { recursive: true, force: true }); }
});

test('canonical recipe selection ignores unrelated catalog/override entries, not selected profile edits', () => {
  const baseline = generate(root);
  assert.equal(baseline.complete, 0);
  assert.ok(baseline.total >= 241);
  const folder = mkdtempSync(resolve(tmpdir(), 'voltra-catalog-ledger-'));
  try {
    for (const source of baseline.sources) write(folder, source.path, readFileSync(resolve(root, source.path), 'utf8'));
    const before = generate(folder);
    const catPath = 'internal/panel/game_library/upstream/catalog.json';
    const overridesPath = 'internal/panel/game_library/overrides.json';
    const catalog = JSON.parse(readFileSync(resolve(folder, catPath)));
    const overrides = JSON.parse(readFileSync(resolve(folder, overridesPath)));
    const [selected, unrelated] = catalog.entries.filter(e => !overrides[e.path]).slice(0, 2);
    assert.ok(selected && unrelated, 'fixture needs two raw entries');
    unrelated.egg.name += ' unrelated change';
    write(folder, catPath, catalog);
    overrides[unrelated.path] = { upstream_sha256: unrelated.sha256, egg: unrelated.egg };
    write(folder, overridesPath, overrides);
    const after = generate(folder);
    const fingerprint = (ledger, path) => ledger.games.find(g => g.path === path).source_fingerprint;
    assert.equal(fingerprint(after, selected.path), fingerprint(before, selected.path));
    assert.notEqual(fingerprint(after, unrelated.path), fingerprint(before, unrelated.path));
    selected.egg.name += ' relevant change'; write(folder, catPath, catalog);
    assert.notEqual(fingerprint(generate(folder), selected.path), fingerprint(before, selected.path));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
