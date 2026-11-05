// Read-only source reconciliation. No Docker, network, panel or legacy harness calls.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const requirements = {
  install: ['egg_import', 'acquisition', 'install'],
  setup: ['shared_setup', 'populated_fields', 'validation'],
  console: ['logs', 'colors', 'starting', 'online', 'stopping', 'offline', 'crash'],
  settings: ['shared_settings', 'typed_native_fields', 'unknown_keys_preserved', 'secrets_preserved'],
  lifecycle: ['start', 'stop', 'restart', 'settings_round_trip', 'save_reload', 'reinstall_preservation', 'permissions', 'protocol_security'],
};
const catalogPath = 'internal/panel/game_library/upstream/catalog.json';
const overridesPath = 'internal/panel/game_library/overrides.json';
const bridgePath = 'internal/panel/steam_catalog_bridge.go';
const fs25Path = 'internal/panel/game_fs25.go';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = (root, path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const parseObject = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };

export function managedMappings(source) {
  const body = source.match(/func steamCatalogBridgeID\(recipe string\) string \{([\s\S]*?)\n\}/)?.[1];
  if (!body) throw new Error('Managed mapping function not found');
  return Object.fromEntries([...body.matchAll(/case "([^"]+)":\s*return "([^"]+)"/g)].map(m => [m[1], m[2]]));
}

function safeEvidence(root, path) {
  if (typeof path !== 'string' || isAbsolute(path) || /^[A-Za-z]:|\\|:\/\//.test(path)) return false;
  const rel = relative(root, resolve(root, path));
  return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && existsSync(resolve(root, path));
}

// Receipts are explicit assertions reviewed by root, not inferred from filenames or prose.
export function reconcileGate(root, name, baseline, receipt, fingerprint) {
  if (!receipt) return baseline;
  if (!['unknown', 'partial', 'blocked', 'verified'].includes(receipt.status)) throw new Error(`Invalid ${name} status`);
  const evidence = receipt.evidence || [];
  if (!Array.isArray(evidence) || evidence.some(e => !safeEvidence(root, e))) throw new Error(`Missing/unsafe ${name} evidence`);
  if (receipt.status !== 'unknown' && (!evidence.length || !receipt.reason)) throw new Error(`${name} needs evidence and reason`);
  if (receipt.status === 'verified') {
    if (receipt.fingerprint !== fingerprint) throw new Error(`Stale ${name} fingerprint`);
    if (receipt.kind !== 'native_server' || receipt.environment !== 'windows-docker-desktop-linux-local-npipe') throw new Error(`${name} requires local native receipt`);
    if (requirements[name].some(check => receipt.checks?.[check] !== true)) throw new Error(`Incomplete ${name} checks`);
  }
  return { ...receipt, evidence: [...new Set([...baseline.evidence, ...evidence])] };
}

export function generate(root, receipts = {}) {
  root = resolve(root);
  const catalog = json(root, catalogPath), overrides = json(root, overridesPath);
  const progressPath = 'artifacts/game-progress-current.json';
  const historicalProgress = existsSync(resolve(root, progressPath)) ? json(root, progressPath) : null;
  const bridge = readFileSync(resolve(root, bridgePath), 'utf8');
  const managed = managedMappings(bridge);
  const fsSource = readFileSync(resolve(root, fs25Path), 'utf8');
  const fsPath = fsSource.match(/const fs25Path = "([^"]+)"/)?.[1];
  if (!fsPath) throw new Error('FS25 catalog addition not found');
  const sources = [catalogPath, overridesPath, bridgePath, fs25Path,
    'internal/panel/game_library/fs25/upstream-egg.json',
    'internal/panel/game_templates.go', 'internal/panel/game_settings_documents.go',
    'internal/panel/game_settings_structured.go', 'web/src/client/GameQuickSetup.tsx',
    'web/src/client/GameSetupFields.tsx', 'web/src/client/GameSettingsFields.tsx',
    'web/src/client/Console.tsx', 'web/src/client/consoleLifecycle.ts',
    'web/src/client/consoleFormatting.ts', 'web/src/client/consoleOutput.ts',
    'web/src/client/consoleQueue.ts', 'web/src/client/consoleReplay.ts',
    'web/src/client/powerOperation.ts', 'web/src/client/gameTemplateModel.ts',
    'web/src/client/gameSetupModel.ts', 'web/src/client/templateSetupValidation.ts',
    'internal/panel/game_quick_setup.go', 'internal/panel/steam_games.go',
    'internal/panel/game_settings_arma.go', 'internal/panel/game_settings_source.go',
    'internal/panel/game_settings_discovery.go', 'internal/panel/game_settings_ini_safety.go',
    'internal/panel/game_settings_stk.go', 'internal/panel/game_settings_stk_dispatch.go',
    'internal/panel/game_settings_ddnet.go', 'internal/panel/game_settings_privacy.go',
    'internal/panel/game_settings_aska.go', 'internal/panel/game_settings_recipe_managed.go',
    'internal/panel/game_settings_barotrauma.go'];
  const sharedFingerprint = hash(sources.map(path => hash(readFileSync(resolve(root, path)))).join(':'));
  const entries = [...catalog.entries, { path: fsPath, egg: json(root, 'internal/panel/game_library/fs25/upstream-egg.json'), sha256: hash(fsSource), synthetic: true }];
  const seen = new Set(), warnings = [];
  const games = entries.map(entry => {
    if (seen.has(entry.path)) throw new Error(`Duplicate recipe ${entry.path}`);
    seen.add(entry.path);
    const override = overrides[entry.path];
    if (override && override.upstream_sha256 !== entry.sha256) throw new Error(`Override upstream hash mismatch: ${entry.path}`);
    const egg = override?.egg || entry.egg;
    const fingerprint = hash(JSON.stringify({ entry, override, sharedFingerprint }));
    for (const gate of Object.keys(receipts[entry.path] || {})) if (!(gate in requirements)) throw new Error(`Unknown receipt gate: ${gate}`);
    const evidence = [entry.synthetic ? fs25Path : catalogPath, ...(override ? [overridesPath] : []), ...(managed[entry.path] ? [bridgePath] : [])];
    const partial = reason => ({ status: 'partial', kind: 'source', reason, evidence });
    const unknown = reason => ({ status: 'unknown', reason, evidence: [] });
    const config = parseObject(egg?.config?.files);
    const gates = {
      install: egg?.scripts?.installation?.script ? partial('Recipe installer exists; acquisition and isolated install need native evidence.') : unknown('No recipe installer evidence.'),
      setup: egg?.variables?.length ? partial('Recipe variables exist; populated shared setup and validation need campaign evidence.') : unknown('Shared setup needs inspection and native evidence.'),
      console: egg?.config?.startup ? partial('Recipe readiness/stop metadata exists; colors and every lifecycle state need evidence.') : unknown('Console needs inspection and native evidence.'),
      settings: managed[entry.path] ? { ...partial('Managed bridge has shared native settings discovery; typed controls, preservation and native behavior still require campaign evidence.'), evidence: [...evidence, 'internal/panel/game_settings_documents.go', 'internal/panel/game_quick_setup.go'] } : Object.keys(config).length || Object.keys(override?.settings_documents || {}).length ? partial('Recipe file mappings or declared documents exist; typed shared native settings and preservation need evidence.') : unknown('No recipe config mappings; native settings schema/UI need inspection.'),
      lifecycle: unknown('Power, persistence, permissions and protocol/security need isolated native evidence.'),
    };
    if (override?.setup_unavailable_reason) gates.setup = { status: 'blocked', kind: 'source', reason: override.setup_unavailable_reason, evidence };
    for (const name of Object.keys(requirements)) gates[name] = reconcileGate(root, name, gates[name], receipts[entry.path]?.[name], fingerprint);
    const prerequisites = ['runtime lane environment receipt and resource lease', 'root-assigned native execution', 'player-client verification where applicable'];
    if (override?.agreements?.length) prerequisites.push('explicit publisher agreement consent; agent must not accept');
    if ((egg?.variables || []).some(v => /STEAM_(USER|PASS|AUTH)|LICENSE|LICENCE|TOKEN|API_KEY/.test(v.env_variable))) prerequisites.push('review credential/license/token requirements; secret handling through root if required');
    if (entry.synthetic) prerequisites.push('FS25 licensed media/key and container-author licence review; native egg is assembled in Go');
    if (override?.platforms?.length) prerequisites.push(`declared platforms: ${override.platforms.join(', ')}`);
    return {
      path: entry.path, id: hash(entry.path).slice(0, 16), name: egg?.name || entry.path,
      in_scope: !!entry.egg, managed_game: managed[entry.path] || null,
      source_fingerprint: fingerprint, profile: override?.revision || null,
      historical_claim: { verification: override?.verification || (managed[entry.path] ? 'managed runtime_verified claim' : 'not_verified'), detail: override?.detail || null, evidence, campaign_completion: false },
      gates, prerequisites, native_evidence_gaps: Object.entries(gates).filter(([, gate]) => gate.status !== 'verified').map(([name]) => name),
      complete: Object.values(gates).every(gate => gate.status === 'verified'),
    };
  });
  for (const path of Object.keys(overrides)) if (!seen.has(path)) warnings.push(`Orphan override: ${path}`);
  for (const path of Object.keys(receipts)) if (!seen.has(path)) throw new Error(`Unknown receipt recipe: ${path}`);
  for (const path of Object.keys(managed)) if (!seen.has(path)) throw new Error(`Missing managed recipe: ${path}`);
  const counts = Object.fromEntries(Object.keys(requirements).map(gate => [gate, Object.fromEntries(['unknown', 'partial', 'blocked', 'verified'].map(status => [status, games.filter(game => game.gates[gate].status === status).length]))]));
  return {
    schema_version: 1, campaign: 'game-parity-20261029', sources: sources.map(path => ({ path, sha256: hash(readFileSync(resolve(root, path))) })),
    policy: 'Five independent gates. Historical runtime_verified, source and fixture checks do not establish native campaign completion.',
    scope_exclusions: ['home server', 'SSH', 'remote Docker', 'production mutation', 'publication or desktop installation', 'automatic publisher consent or private licence acquisition', 'generic app-ID onboarding is last priority'],
    receipt_contract: { requirements, environment: 'windows-docker-desktop-linux-local-npipe', kind: 'native_server', note: 'Root-reviewed assertions only. Each verified gate needs current source fingerprint, all checks true, reason and existing workspace-relative evidence files. Player-client evidence remains separate.' },
    managed_mappings: managed, total: games.length, complete: games.filter(game => game.complete).length, counts, warnings, games,
    historical_progress: historicalProgress ? {
      evidence: progressPath, sha256: hash(readFileSync(resolve(root, progressPath))),
      observed_at: historicalProgress.observed_at, declared_catalog_total: historicalProgress.catalog_total,
      current_total_delta: games.length - historicalProgress.catalog_total,
      declared_status_counts: historicalProgress.current_verification_counts || historicalProgress.verification_counts,
      note: 'Historical aggregate is retained for reconciliation only; no per-gate promotion. Current total includes the Go-added FS25 entry.',
    } : null,
  };
}

export function main(args) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  if (args.length > 1) throw new Error('Usage: node tools/runtime/game-parity-ledger.mjs [receipt.json]');
  const reviewed = args[0] || 'artifacts/game-parity-20261029/reviewed-gates.json';
  const ledger = generate(root, existsSync(resolve(root, reviewed)) ? json(root, reviewed) : {});
  const output = resolve(root, 'artifacts/game-parity-20261029');
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'inventory.json'), JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ total: ledger.total, complete: ledger.complete, counts: ledger.counts, warnings: ledger.warnings }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
