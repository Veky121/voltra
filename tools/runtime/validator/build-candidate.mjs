// Run only on explicit root admission. This creates an unserved candidate, never an active pointer.
// selection: {scope, testRegex:"^(TestName|TestOther)$", selected_backend:[
//   {path:"internal/panel/file.go", source:"C:/absolute/file.go", sha256:"...", bytes:123, before_sha256:"..." /* null for additions */}
// ]}. Paths in candidate receipts retain the wave485 manifest format.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const hash = p => digest(fs.readFileSync(p));
const args = process.argv.slice(2), opts = {};
assert.equal(args.length, 6, 'Expected --campaign-root M --selection JSON --out NEW_RECEIPT_DIR');
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--campaign-root', '--selection', '--out'].includes(args[i]) && !opts[args[i]], 'Unknown or duplicate option');
  opts[args[i]] = args[i + 1];
}
const root = fs.realpathSync(opts['--campaign-root']);
const resolve = p => path.resolve(root, p);
const selectionPath = path.resolve(opts['--selection']);
const out = path.resolve(opts['--out']);
const snapshotName = 'build-input-' + Date.now();
const snapshot = path.join(out, snapshotName), binary = path.join(out, 'panel-frozen-' + snapshotName + '.exe');
const selection = read(selectionPath);
const priorPath = resolve(selection.base_candidate.path);
assert.equal(hash(priorPath), selection.base_candidate.sha256, 'Reviewed predecessor drift');
const prior = read(priorPath);
const expectedSnapshot = resolve(prior.backend.snapshot);
const sha = s => assert.match(s, /^[a-f0-9]{64}$/);
function relative(p) {
  assert.equal(typeof p, 'string');
  assert.ok(p.length && !p.includes('\\') && !p.includes(':') && !p.startsWith('/') && !p.split('/').some(x => !x || x === '.' || x === '..'), 'Unsafe manifest path');
  assert.ok(!p.endsWith('.') && !p.includes('\0') && !p.split('/').some(x => /[<>"|?*\x00-\x1f]/.test(x) || /[ .]$/.test(x) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)), 'Unsafe Windows path');
  return p;
}
function rowsValid(rows) {
  assert.ok(Array.isArray(rows));
  const seen = new Set();
  for (const r of rows) { relative(r.path); sha(r.sha256); const k = r.path.toLowerCase(); assert.ok(!seen.has(k), 'Duplicate path'); seen.add(k); }
}
function regular(p) {
  // Reject junctions/symlinks in every ancestor, including selected source parents.
  let current = path.resolve(p);
  for (;;) { assert.ok(!fs.lstatSync(current).isSymbolicLink(), 'Symlink/junction rejected'); const parent = path.dirname(current); if (parent === current) break; current = parent; }
  assert.ok(fs.statSync(p).isFile(), 'Expected regular file');
}
function verify(s, expected) {
  const manifest = path.join(s, 'snapshot-manifest.json'); regular(manifest);
  if (expected) assert.equal(hash(manifest), expected);
  const m = read(manifest); rowsValid(m.inputs); assert.equal(digest(JSON.stringify(m.inputs)), m.fingerprint);
  for (const r of m.inputs) { const p = path.join(s, r.path); regular(p); assert.equal(hash(p), r.sha256, r.path); }
  return m;
}
assert.ok(!fs.existsSync(out), 'Receipt directory must be new');
assert.ok(!fs.existsSync(snapshot) && !fs.existsSync(binary), 'Snapshot/binary must be new');
const activationPath = resolve('artifacts/game-parity-20261029/root-activation.json');
const activation = await (await import(pathToFileURL(resolve('tools/runtime/campaign-native-20261029.mjs')).href)).verifyRuntime();
assert.equal(path.resolve(activation.snapshot), expectedSnapshot);
assert.equal(activation.binary_sha256, prior.backend.binary_sha256);
const protectedIdentities = prior.running_panel_identity.map(row => row.ports.includes(18099) ? {
  pid: activation.pid, path: activation.executable, sha256: activation.binary_sha256, ports: [18099],
} : row);
assert.equal(prior.status, 'built_unserved_pending_root_review');
assert.equal(resolve(prior.backend.snapshot), expectedSnapshot);
assert.equal(activation.source_fingerprint, prior.backend.fingerprint);
assert.ok(typeof selection.scope === 'string' && selection.scope.trim());
// Exact named tests only, no broad package regex or shell expression.
assert.match(selection.testRegex, /^\^\(Test[A-Za-z0-9_]+(?:\|Test[A-Za-z0-9_]+)*\)\$$/);
rowsValid(selection.selected_backend); assert.ok(selection.selected_backend.length);
const base = verify(expectedSnapshot, prior.backend.manifest_sha256);
const baseMap = new Map(base.inputs.map(r => [r.path, r]));
const selected = new Map();
for (const r of selection.selected_backend) {
  assert.ok(r.path.startsWith('internal/panel/'), 'Only panel selections admitted');
  assert.ok(r.path !== 'internal/panel/game_library/upstream/catalog.json', 'Upstream catalog must remain unchanged');
  assert.ok(Object.hasOwn(r, 'before_sha256')); if (r.before_sha256 !== null) sha(r.before_sha256);
  assert.equal(baseMap.get(r.path)?.sha256 ?? null, r.before_sha256, 'Predecessor selected hash mismatch');
  assert.notEqual(r.sha256, r.before_sha256, 'Selected path must change');
  assert.ok(path.isAbsolute(r.source), 'Selected source must be absolute'); regular(r.source);
  assert.ok(Number.isSafeInteger(r.bytes) && r.bytes >= 0); assert.equal(fs.statSync(r.source).size, r.bytes); assert.equal(hash(r.source), r.sha256);
  selected.set(r.path, r);
}
const rows = base.inputs.map(r => selected.has(r.path) ? {path:r.path, sha256:selected.get(r.path).sha256} : {...r});
for (const r of selected.values()) if (!baseMap.has(r.path)) rows.push({path:r.path, sha256:r.sha256});
rowsValid(rows);
const changed = rows.filter(r => baseMap.get(r.path)?.sha256 !== r.sha256).map(r => r.path).sort();
assert.deepEqual(changed, [...selected.keys()].sort());
assert.deepEqual(base.inputs.filter(r => !rows.some(x => x.path === r.path)), []);
const catalogPath = 'internal/panel/game_library/upstream/catalog.json';
assert.equal(rows.find(r => r.path === catalogPath)?.sha256, baseMap.get(catalogPath)?.sha256);
assert.ok(baseMap.has(catalogPath));
fs.mkdirSync(out); // Exclusive reservation. No pre-existing directory is ever reused.
const write = (n, value) => fs.writeFileSync(path.join(out, n), JSON.stringify(value, null, 2) + '\n', {flag:'wx'});
const guards = [priorPath, activationPath, selectionPath, ...[...selected.values()].map(r => r.source)].map(p => ({path:p, sha256:hash(p)}));
function identity() {
  const ids = protectedIdentities; assert.ok(Array.isArray(ids) && ids.length === 3);
  for (const r of ids) assert.ok(Number.isSafeInteger(r.pid) && r.pid > 0);
  const script = `$rows=@(); foreach($taskId in @(${ids.map(r => r.pid).join(',')})){ $p=Get-Process -Id $taskId -ErrorAction Stop; $ports=@(Get-NetTCPConnection -State Listen -OwningProcess $taskId -ErrorAction Stop | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique); $rows += [pscustomobject]@{pid=$p.Id;path=$p.Path;started=$p.StartTime.ToUniversalTime().ToString('o');sha256=(Get-FileHash -LiteralPath $p.Path -Algorithm SHA256).Hash.ToLower();ports=$ports} }; ConvertTo-Json -InputObject $rows -Depth 5 -Compress`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {encoding:'utf8', timeout:60000, maxBuffer:1024*1024});
  assert.equal(r.status, 0, 'Protected identity read failed');
  return JSON.parse(r.stdout);
}
function frontend() {
  verify(resolve(prior.frontend.snapshot), prior.frontend.manifest_sha256);
  const manifest = resolve(prior.frontend.output_manifest);
  assert.equal(prior.frontend.output_manifest_sha256, '5b36a8e0448d5095272e74a48e10b2583eb407b1c730d4f199d4783cca67cdc2');
  assert.equal(hash(manifest), prior.frontend.output_manifest_sha256);
  const outputs = read(manifest); rowsValid(outputs); assert.equal(outputs.length, 5047);
  const dir = resolve(prior.frontend.output), actual = [];
  function walk(rel = '') { for (const n of fs.readdirSync(path.join(dir, rel))) { const p = rel ? rel + '/' + n : n; const s = fs.lstatSync(path.join(dir, p)); assert.ok(!s.isSymbolicLink()); if (s.isDirectory()) walk(p); else { assert.ok(s.isFile()); actual.push(p); } } }
  walk(); assert.deepEqual(actual.sort(), outputs.map(r => r.path).sort());
  for (const r of outputs) { regular(path.join(dir, r.path)); assert.equal(hash(path.join(dir, r.path)), r.sha256); }
  assert.equal(hash(path.join(dir, 'index.html')), '6ef475d0d341d515efd1faf76da23555a2d0d1b4a83504ba4ddc1571105a3a3c');
}
const env = {...process.env, GOTOOLCHAIN:'local', GOPROXY:'off', GOSUMDB:'off', GOMAXPROCS:'2', GOFLAGS:'', GOWORK:'off', GOENV:'off', GOTELEMETRY:'off'};
const go = path.join(process.env.USERPROFILE, 'go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.3.windows-amd64/bin/go.exe');
function run(name, commandArgs, cwd, timeout) {
  const start = Date.now();
  const r = spawnSync(go, commandArgs, {cwd, env, encoding:'utf8', timeout, maxBuffer:16*1024*1024, windowsHide:true});
  fs.writeFileSync(path.join(out, name + '.log'), (r.stdout || '') + (r.stderr || ''), {flag:'wx'});
  const receipt = {exe:go, args:commandArgs, exit_code:r.status, signal:r.signal, seconds:(Date.now()-start)/1000, error_code:r.error?.code ?? null};
  write(name + '-command.json', receipt); assert.equal(r.status, 0, name + ' failed; see receipt'); return r;
}
let before;
try {
  write('protected-inputs.json', guards); before = identity(); write('identities-before.json', before);
  for (let i = 0; i < protectedIdentities.length; i++) for (const [key, value] of Object.entries(protectedIdentities[i])) assert.deepEqual(before[i][key], value, 'Protected runtime identity changed');
  frontend();
  write('selection.json', selection);
  write('paths.json', {backend:snapshot, binary, frontend:prior.frontend.snapshot, output:prior.frontend.output});
  for (const r of rows) {
    const source = selected.get(r.path)?.source || path.join(expectedSnapshot, r.path); regular(source); assert.equal(hash(source), r.sha256);
    const dest = path.join(snapshot, r.path); fs.mkdirSync(path.dirname(dest), {recursive:true}); fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL); fs.chmodSync(dest, 0o444);
  }
  const bm = {scope:selection.scope, inputs:rows, fingerprint:digest(JSON.stringify(rows)), snapshot};
  fs.writeFileSync(path.join(snapshot, 'snapshot-manifest.json'), JSON.stringify(bm, null, 2)+'\n', {flag:'wx'});
  fs.chmodSync(path.join(snapshot, 'snapshot-manifest.json'), 0o444); write('backend-source-manifest.json', bm);
  write('source-delta.json', {backend_delta:selection.selected_backend, changed, removed:[], frontend_delta:[], backend_other_inputs_unchanged:rows.length-changed.length, base_candidate:priorPath, base_candidate_sha256:hash(priorPath), contract_sha256:hash(selectionPath), before:base.inputs, after:rows});
  verify(snapshot); regular(go);
  const version = run('toolchain', ['version'], snapshot, 60000);
  assert.equal(version.stdout.trim(), 'go version go1.27.3 windows/amd64');
  const tests = run('backend-test', ['test','-p','2','-mod=readonly','./internal/panel','-run',selection.testRegex,'-count=1'], snapshot, 600000);
  assert.ok(!/no tests to run|\[no test files\]/i.test((tests.stdout || '') + (tests.stderr || '')), 'Focused tests did not execute');
  run('backend-build', ['build','-p','2','-mod=readonly','-o',binary,'./cmd/panel'], snapshot, 600000);
  fs.chmodSync(binary, 0o444);
  verify(snapshot); verify(expectedSnapshot, prior.backend.manifest_sha256); frontend();
  for (const r of guards) assert.equal(hash(r.path), r.sha256, 'Protected input changed');
  for (const r of selected.values()) assert.equal(fs.statSync(r.source).size, r.bytes);
  const catalog = fs.readFileSync(path.join(snapshot, 'internal/panel/game_library/overrides.json'));
  assert.ok(fs.readFileSync(binary).includes(catalog), 'Exact embedded overrides missing');
  const after = identity(); write('identities-after.json', after); assert.deepEqual(after, before);
  const candidate = {at:new Date().toISOString(), status:'built_unserved_pending_root_review', scope:selection.scope, base_candidate:priorPath,
    backend:{snapshot, manifest:path.join(snapshot,'snapshot-manifest.json'), manifest_sha256:hash(path.join(snapshot,'snapshot-manifest.json')), fingerprint:bm.fingerprint, inputs:rows.length, snapshot_matches_manifest:true, current_source_matches_snapshot:false, binary, binary_sha256:hash(binary), bytes:fs.statSync(binary).size, embedded_catalog_sha256:digest(catalog), exact_embedded_catalog_verified:true, upstream_catalog_sha256:baseMap.get(catalogPath).sha256},
    frontend_reused:true, frontend:{...prior.frontend}, backend_delta:path.join(out,'source-delta.json'), running_panel_identity:after, running_panel_identity_unchanged:true,
    validation:['focused exact named panel tests','one cached backend compile','base and candidate manifests before/after','selected hashes and bytes before/after','all 5047 frontend output hashes and index before/after','exact embedded overrides bytes','protected process identities before/after'],
    reused_evidence:{frontend_gzip:{candidate:priorPath, verified:prior.frontend.gzip_verified, reused:true}},
    served_api_check:'pending', native_acceptance:false, new_native_acceptance:false, activation:false, restart:false, publication:false, full_catalog_tests:false};
  write('candidate.json', candidate);
  write('report.json', {...candidate, candidate:path.join(out,'candidate.json'), candidate_sha256:hash(path.join(out,'candidate.json')), test:read(path.join(out,'backend-test-command.json')), compile:read(path.join(out,'backend-build-command.json')), verification_limits:'Unserved candidate; root review and served API checks pending. No native acceptance, activation, restart, publication, frontend rebuild or active pointer changes.'});
  console.log(JSON.stringify({status:candidate.status, binary_sha256:candidate.backend.binary_sha256, manifest_sha256:candidate.backend.manifest_sha256}));
} catch (error) {
  // Do not serialize environment values or source contents into error receipts.
  write('failure.json', {status:'failed_unserved', error:error.code || error.name, message:error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Candidate preparation failed; inspect command receipts'});
  process.exitCode = 1;
} finally {
  if (before && !fs.existsSync(path.join(out, 'identities-after.json'))) {
    try { const after = identity(); write('identities-after.json', after); assert.deepEqual(after, before); } catch { write('identity-failure.json', {status:'protected_identity_check_failed'}); process.exitCode = 1; }
  }
}
