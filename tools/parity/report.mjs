import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { artifact, project, loadJSON, jsonFile } from './common.mjs';

const inventory = await loadJSON(path.join(artifact, 'inventory.json'));
const suites = [];
for (const file of await readdir(artifact)) {
  if (!file.endsWith('.json') || ['inventory.json', 'report.json'].includes(file)) continue;
  const value = await loadJSON(path.join(artifact, file));
  if (value.suite && Array.isArray(value.checks)) suites.push({ file: `artifacts/parity/${file}`, ...value });
}
const checks = suites.flatMap(suite => suite.checks.map(check => ({ ...check, report: suite.file, completed_at: suite.completed_at })));
const routeEvidence = new Map();
for (const check of checks) for (const route of check.source_routes ?? []) {
  const evidence = routeEvidence.get(route) ?? [];
  evidence.push({ check: check.id, status: check.status, artifact: check.report }); routeEvidence.set(route, evidence);
}
const routes = inventory.routes.map(route => {
  const evidence = routeEvidence.get(`${route.method} ${route.path}`) ?? [];
  const status = !route.required ? route.status : evidence.some(e => e.status === 'failed') ? 'failed' : evidence.some(e => e.status === 'passed') ? 'behavior_exercised' : 'not_exercised';
  return { ...route, status, evidence };
});
const eggs = inventory.game_eggs.map(egg => {
  const check = checks.find(c => c.id === `egg-corpus:${egg.path}`);
  return { ...egg, status: check?.status === 'passed' ? 'import_export_verified' : check?.status ?? 'not_exercised', runtime_status: 'not_exercised', evidence: check ? [{ check: check.id, artifact: check.report }] : [] };
});
const controls = inventory.controls.map(control => {
  const evidence = checks.filter(c => c.browser === true && c.status === 'passed' && c.source_controls?.includes(control.id));
  return { ...control, status: !control.required ? control.status : evidence.length ? 'behavior_exercised' : 'not_exercised', evidence: evidence.map(e => ({ check: e.id, artifact: e.report })) };
});
const commands = inventory.cli_commands.map(command => {
  const name = command.command?.split(' ')[0];
  const evidence = checks.filter(c => c.status === 'passed' && c.evidence?.commands?.includes(name));
  return { ...command, status: !command.required ? command.status : evidence.length ? 'behavior_exercised' : 'not_exercised', evidence: evidence.map(e => ({ check: e.id, artifact: e.report })) };
});
const failed = checks.filter(c => c.status === 'failed');
const blocked = checks.filter(c => c.status === 'blocked');
const requiredRoutes = routes.filter(r => r.required);
const featureAudit = await loadJSON(path.join(artifact, 'feature-audit.json')).catch(() => null);
const externalEvidence = [];
for (const filename of ['client-browser.json', 'client-egg-features.json', 't3-browser.json', 'scheduler-timezone.json', 'runtime-lifecycle.json', 'runtime-constraints.json', 'runtime-cli.json', 'runtime-game.json', 'runtime-s3.json', 'runtime-revocation.json', 'runtime-latency.json']) {
  const value = await loadJSON(path.join(project, 'artifacts', filename)).catch(() => null);
  if (!value) continue;
  externalEvidence.push({
    artifact: `artifacts/${filename}`, producer: 'separate domain owner', independently_rerun_by_this_report: false,
    tested_at: value.tested_at ?? value.date,
    scope: value.scope ?? null,
    checks: (value.results ?? value.checks)?.filter(r => typeof r.passed === 'boolean').map(r => ({ name: r.name ?? r.feature, passed: r.passed, category: r.category, action_assertions: Array.isArray(r.checks) ? r.checks.length : undefined })) ?? null,
    browser_areas: Array.isArray(value.passed) ? value.passed.map(area => ({ area: area.area, action_assertions: area.checks?.length ?? 0, limitation: area.limitation ?? null })) : null,
    limitations: value.limitations ?? value.observations ?? null,
    s3: filename === 'runtime-s3.json' ? { multipart_upload_callback: value.multipart_upload_callback, restored_original_bytes: value.restored_original_bytes, s3_object_deleted: value.s3_object_deleted } : null,
    latency_measurements: filename === 'runtime-latency.json' ? value.results : null,
    native_oracle_comparison: filename === 'scheduler-timezone.json' ? { reference: value.native_reference, oracle_cases: value.oracle_cases, test_results: value.test_results } : null,
    games: filename === 'runtime-game.json' ? [
      { game: value.game, egg_source: value.egg_source, egg_modified: value.egg_modified, checks: value.results?.map(r => ({ name: r.name, passed: r.passed, category: r.category })) },
      ...Object.values(value).filter(v => v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.results)).map(v => ({ game: v.game ?? 'Additional game', egg_source: v.egg_source, egg_modified: v.egg_modified, startup_detection_difference: v.upstream_startup_detection, checks: v.results.map(r => ({ name: r.name, passed: r.passed })) })),
    ] : null,
  });
}
for (const filename of (await readdir(path.join(project, 'artifacts'))).filter(f => /^go.*\.jsonl$/.test(f))) {
  const source = await readFile(path.join(project, 'artifacts', filename), 'utf8');
  const tests = new Map(), packages = new Map(); let parseErrors = 0;
  for (const line of source.split(/\r?\n/).filter(Boolean)) {
    let event; try { event = JSON.parse(line); } catch { parseErrors++; continue; }
    if (!['pass', 'fail', 'skip'].includes(event.Action)) continue;
    if (event.Test) tests.set(`${event.Package}/${event.Test}`, event.Action);
    else if (event.Package) packages.set(event.Package, event.Action);
  }
  externalEvidence.push({ artifact: `artifacts/${filename}`, producer: 'root Go test process', independently_rerun_by_this_report: false, json_parse_errors: parseErrors,
    test_results: { passed: [...tests.values()].filter(v => v === 'pass').length, failed: [...tests.values()].filter(v => v === 'fail').length, skipped: [...tests.values()].filter(v => v === 'skip').length },
    package_results: [...packages.entries()].map(([name, status]) => ({ name, status })),
    failed_tests: [...tests.entries()].filter(([, status]) => status === 'fail').map(([name]) => name),
  });
}
const baselineReviewed = process.argv.includes('--native-baseline-reviewed');
const goReports = externalEvidence.filter(e => e.producer === 'root Go test process');
const baselineCriteria = {
  explicit_native_baseline_review: baselineReviewed,
  all_pinned_feature_groups_reviewed_and_exercised: featureAudit?.counts.groups === 50 && featureAudit.counts.groups_source_reviewed === 50 && featureAudit.counts.groups_with_behavior_evidence === 50 && featureAudit.counts.implementation_groups_with_confirmed_gaps === 0 && featureAudit.counts.groups_awaiting_go_report === 0,
  no_independent_failures_or_blocked_checks: failed.length === 0 && blocked.length === 0,
  all_supplied_eggs_roundtrip: eggs.length === 321 && eggs.every(e => e.status === 'import_export_verified'),
  full_and_race_go_reports_pass: goReports.length >= 2 && goReports.every(e => e.json_parse_errors === 0 && e.test_results.failed === 0 && e.test_results.passed > 0 && e.package_results.length > 0 && e.package_results.every(p => p.status !== 'fail')),
};
const report = {
  schema_version: 1, generated_at: new Date().toISOString(), reference: inventory.reference,
  full_parity_verified: Object.values(baselineCriteria).every(Boolean),
  parity_scope: {
    baseline: 'Pinned Pterodactyl v1.15.1 native feature baseline, reviewed by the root integration owner',
    meaning: 'All 50 native feature groups have implementation review and actual behavior evidence with no known failing baseline checks. Raw route/control branch coverage remains separate.',
    deferred: 'Browser login, password/email identity changes and TOTP; Cloudflare Access is explicitly deferred by the user.',
    not_claimed: ['Successful installation or gameplay for every supplied egg', 'Every possible validation input or error branch', 'An individual browser click for every duplicate original source control'],
    criteria: baselineCriteria,
  },
  native_feature_audit: featureAudit ? { artifact: 'artifacts/parity/feature-audit.json', counts: featureAudit.counts, actionable_remaining: featureAudit.actionable_remaining, control_line_mapping_does_not_define_feature_completeness: true } : null,
  counts: {
    checks: checks.length, checks_passed: checks.filter(c => c.status === 'passed').length, checks_failed: failed.length, checks_blocked: blocked.length,
    required_routes: requiredRoutes.length, routes_behavior_exercised: requiredRoutes.filter(r => r.status === 'behavior_exercised').length, routes_failed: requiredRoutes.filter(r => r.status === 'failed').length, routes_not_exercised: requiredRoutes.filter(r => r.status === 'not_exercised').length,
    UI_controls: controls.length, UI_controls_required: controls.filter(c => c.required).length, UI_controls_behavior_exercised: controls.filter(c => c.status === 'behavior_exercised').length,
    eggs: eggs.length, eggs_import_export_verified: eggs.filter(e => e.status === 'import_export_verified').length, egg_runtimes_verified: 0,
    cli_commands_behavior_exercised: commands.filter(c => c.status === 'behavior_exercised').length, cli_commands_not_exercised: commands.filter(c => c.required && c.status === 'not_exercised').length,
  },
  limitations: [
    'An exercised route means a named assertion ran, not that all validation, permission, filtering and side-effect branches are covered.',
    'Corpus roundtrips prove data compatibility, not successful installation or gameplay for every game.',
    'Original browser controls and CLI commands remain unverified without explicit action evidence.',
    'UI control counts refer to explicit original source-control mappings. Separate browser artifacts contain real action evidence and are listed independently without fabricating per-control coverage.',
    'The parity boolean is scoped to the explicitly reviewed pinned native feature baseline. It does not convert unexercised route/control branch mappings into verified coverage.',
  ],
  suites: suites.map(s => ({ suite: s.suite, artifact: s.file, run_id: s.run_id, completed_at: s.completed_at, counts: s.counts })),
  external_evidence: externalEvidence,
  failures: failed.map(c => ({ id: c.id, feature: c.feature, detail: c.detail, artifact: c.report })),
  blocked: blocked.map(c => ({ id: c.id, feature: c.feature, detail: c.detail, artifact: c.report })),
  routes, game_eggs: eggs, controls,
  cli_commands: commands,
  features: featureAudit?.features ?? inventory.features.map(f => ({ ...f, status: 'source_review_not_supplied', evidence: [] })),
};
await jsonFile(path.join(artifact, 'report.json'), report);
console.log(JSON.stringify({ full_parity_verified: report.full_parity_verified, ...report.counts }));
process.exitCode = report.full_parity_verified ? 0 : 1;
