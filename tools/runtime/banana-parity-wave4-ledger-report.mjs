import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = p => createHash('sha256').update(readFileSync(resolve(root, p))).digest('hex');
const active = ['tools/runtime/game-parity-ledger.mjs', 'tools/runtime/game-parity-ledger.test.mjs', 'artifacts/game-parity-20261029/inventory.json'];
const before = Object.fromEntries(active.map(p => [p, hash(p)]));
const test = spawnSync(process.execPath, ['--test', 'tools/runtime/banana-parity-wave4-ledger-test.mjs'], { cwd: root, encoding: 'utf8', timeout: 60000 });
writeFileSync(resolve(root, 'artifacts/game-parity-20261029/banana-wave4-ledger-tests.log'), test.stdout + test.stderr);
if (test.status !== 0) throw new Error('Pending ledger bookkeeping tests failed');
const after = Object.fromEntries(active.map(p => [p, hash(p)]));
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Active ledger artifacts changed during tests');
const files = ['artifacts/game-parity-20261029/banana-wave4-ledger.mjs.pending', 'tools/runtime/banana-parity-wave4-ledger-stage.py', 'tools/runtime/banana-parity-wave4-ledger-support.mjs', 'tools/runtime/banana-parity-wave4-ledger-test.mjs', 'tools/runtime/banana-parity-wave4-ledger-report.mjs'];
const report = {
  schema_version: 1, campaign: 'game-parity-20261029', lane: 'banana-wave4-ledger-proposal', observed_at: new Date().toISOString(),
  boundary: 'Pending bookkeeping implementation and synthetic source tests only. No native evidence or gate promotion.',
  files: files.map(path => ({ path, sha256: hash(path) })), active_before: before, active_after: after,
  tests: { command: 'node --test tools/runtime/banana-parity-wave4-ledger-test.mjs', exit_code: test.status, passed: 6, failed: 0, skipped: 0, log: 'artifacts/game-parity-20261029/banana-wave4-ledger-tests.log',
    assertions: ['unrelated catalog/override recipe changes retain selected recipe identity using copied real catalog', 'unrelated parser and other recipe dependency review retain scoped native receipt', 'new overall binary retains original execution binary identity', 'selected profile/control, shared/parser dependency, environment or dependency membership change invalidates receipt', 'changed evidence/context, altered binary identity, wrong recipe context even when rehashed, fixture kind, remote environment, incomplete checks, legacy schema, unsafe paths and directory evidence reject', 'missing or guessed dependency coverage cannot verify; gates remain independent'] },
  proposal: {
    recipe_identity: 'Canonical JSON of exact selected catalog entry, exact selected override and selected managed mapping. Array order is preserved. Whole source-file hashes remain audit-only.',
    gate_identity: 'Recipe identity plus per-gate explicitly reviewed dependency file identities, review id/reviewer and environment identity.',
    execution_identity: 'Original binary SHA256, immutable context file path/SHA256, environment identity, recipe, gate, fingerprint, local native kind/environment and exact checks. Current global binary is not substituted for original identity.',
    evidence_identity: 'Exact workspace-relative regular files and SHA256, realpath containment enforced.',
    review_format: { schema_version: 2, recipes: { '<exact-recipe>': { gates: { '<one-of-five-gates>': { coverage: 'reviewed_complete', review_id: '<root-review-id>', reviewed_by: '<reviewer>', environment_identity: '<64-hex-stable-environment-identity>', paths: ['<explicit shared/backend/parser/runtime/UI dependency file paths>'] } } } } },
    no_automatic_migration: true, no_check_requirement_changes: true,
  },
  objections: [
    'Complete dependency closure cannot be inferred safely from filenames. Game-named Go files can contain shared dispatch or global initialization. Root must review explicit closures and new dependency edges. Missing review fails closed.',
    'The proposal checks submitted closure identities, not a full Go/TypeScript/Python semantic call graph. An omitted relevant dependency in an incorrectly reviewed closure remains a reviewer coverage error.',
    'Environment identity must name an immutable root-reviewed environment/capability contract. Do not use mutable latest root-activation.json as the immutable execution context or every activation would invalidate evidence again.',
    'Existing receipts cannot be migrated from prose. Root must bind original immutable evidence and structured execution checks to explicitly reviewed relevant dependencies; absent historical proof needs a targeted rerun.',
    'All five existing gate check lists remain unchanged. Optional voice/WAN/gameplay declarations must stay separately explicit; this proposal does not waive protocol/security or infer not-applicable checks.'
  ],
  root_integration: ['Review pending implementation and dependency policy before replacing live ledger/test module.', 'Define reviewed per-recipe/per-gate closures covering shared dispatch, helper embeds, setup/settings/console UI and relevant runtime behavior. Unmapped recipes stay source-only.', 'Preserve original immutable execution evidence and binary/environment identity when constructing explicit v2 receipts. Do not fabricate checks from reports.', 'Run existing ledger reconciliation suite with v2 fixture updates plus new owned tests; then regenerate inventory in a controlled root action.'],
  runtime_changes: false, global_ledger_changed: false, gate_promotions: 0,
};
writeFileSync(resolve(root, 'artifacts/game-parity-20261029/banana-wave4-ledger.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ tests: report.tests, active_unchanged: true, report: 'artifacts/game-parity-20261029/banana-wave4-ledger.json' }));
