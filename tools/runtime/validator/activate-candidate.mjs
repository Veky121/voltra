// Preparation only does not invoke this CLI. Running it requires a new explicit root review.
// Review contract: schema_version=1, status='approved exact isolated activation at verified quiescence',
// root_user_resumed_explicitly=true, candidate={path,sha256}, predecessor={path,sha256},
// candidate_identity=<entire candidate JSON>, validator_output=<absolute path>,
// artifacts=[{role:'build'|'compatibility'|'input-manifest',path,sha256}] covering receipts,
// fixtures=[{report,sha256,uuid,id,name,egg,node,container_id}],
// protected_processes=[{pid,executable,sha256,start_time}], public_health=[{url,status,sha256}],
// catalog_sha256, runtime_identity={pid,executable,binary_sha256,source_fingerprint,start_time}.
// All campaign paths are absolute or relative to --campaign-root. Reports are confined to validator-output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';

const hash = b => createHash('sha256').update(b).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2), { flag: 'wx', mode: 0o600 });
const assert = (v, message) => { if (!v) { const error = Error(message); error.safeGuard = message; throw error; } };
async function main() {
const args = process.argv.slice(2), options = {};
assert(args.length === 10 || args.length === 12, 'Required activation paths, optionally --resume-existing yes');
for (let i = 0; i < args.length; i += 2) {
  assert(['--campaign-root', '--candidate', '--review', '--output', '--validator-output', '--resume-existing'].includes(args[i]) && !options[args[i]] && args[i + 1], 'Invalid CLI');
  options[args[i]] = args[i + 1];
}
const root = fs.realpathSync(options['--campaign-root']);
const localRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function confined(base, value, exists = true) {
  assert(typeof value === 'string' && value.length > 0, 'Missing confined path');
  const p = path.resolve(base, value), rel = path.relative(base, p);
  assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel), 'Path outside owned root');
  // Reject junctions and symlinks in every existing component, including output parents.
  let cursor = base;
  for (const part of rel.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), 'Linked target refused');
  }
  if (exists) assert(fs.existsSync(p), 'Required input absent');
  return p;
}
const candidatePath = confined(root, options['--candidate']), reviewPath = confined(root, options['--review']);
const out = confined(root, options['--output'], false);
const validator = confined(localRoot, options['--validator-output']);
const resume = options['--resume-existing'] === 'yes';
assert(resume ? fs.existsSync(path.join(out, 'pending-process.json')) && !fs.existsSync(path.join(out, 'ready.json')) && !fs.existsSync(path.join(out, 'failure.json')) : !fs.existsSync(out), 'Receipt directory state incompatible with activation');
const reviewBytes = fs.readFileSync(reviewPath), candidateBytes = fs.readFileSync(candidatePath);
const review = read(reviewPath), candidate = read(candidatePath);
assert(review.schema_version === 1 && review.status === 'approved exact isolated activation at verified quiescence' && review.root_user_resumed_explicitly === true, 'Explicit root resume review required');
assert(path.resolve(review.validator_output) === validator, 'Validator output review mismatch');
assert(confined(root, review.candidate.path) === candidatePath && review.candidate.sha256 === hash(candidateBytes) && equal(review.candidate_identity, candidate), 'Exact candidate review mismatch');
const predecessorPath = confined(root, review.predecessor.path);
assert(hash(fs.readFileSync(predecessorPath)) === review.predecessor.sha256, 'Predecessor receipt drift');
const predecessor = read(predecessorPath);
assert(confined(root, candidate.base_candidate) === predecessorPath && Number.isInteger(review.runtime_identity.pid) && review.runtime_identity.binary_sha256 === predecessor.backend.binary_sha256, 'Exact verified predecessor identity required');
assert(Array.isArray(review.artifacts) && review.artifacts.length >= 3, 'Reviewed build, compatibility and input receipts required');
assert(['build', 'compatibility', 'input-manifest'].every(role => review.artifacts.some(a => a.role === role)), 'Required receipt roles absent');
const artifacts = review.artifacts.map(a => ({ ...a, path: confined(root, a.path) }));
function verifyArtifacts() {
  assert(hash(fs.readFileSync(reviewPath)) === hash(reviewBytes) && hash(fs.readFileSync(candidatePath)) === hash(candidateBytes), 'Review/candidate changed');
  assert(hash(fs.readFileSync(predecessorPath)) === review.predecessor.sha256, 'Predecessor changed');
  for (const a of artifacts) assert(hash(fs.readFileSync(a.path)) === a.sha256, 'Reviewed artifact drift');
}
verifyArtifacts();
process.chdir(root);
const h = await import(pathToFileURL(confined(root, 'tools/runtime/campaign-native-20261029.mjs')).href);
const runtime = confined(root, '.local/game-parity-20261029/runtime');
const queuePath = confined(runtime, 'queue.json'), envPath = confined(runtime, 'panel-private-env.json');
// Same exclusive lock protocol as batch-queue.transact, without rewriting any queue bytes.
function transact(statePath, operation) {
  const fd = fs.openSync(statePath + '.lock', 'wx', 0o600);
  try { return operation(read(statePath)); }
  finally { fs.closeSync(fd); fs.unlinkSync(statePath + '.lock'); }
}
const rootRecord = confined(root, 'artifacts/game-parity-20261029/root-activation.json');
const processRecord = confined(runtime, 'panel-process.json');
const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'activate-process.ps1');
const ps = (mode, backup = out) => {
  // File handles avoid Windows descendants retaining the synchronous caller's pipes.
  const base = fs.existsSync(out) ? out : path.dirname(reviewPath);
  const stdout = path.join(base, 'process-' + mode + '-' + randomUUID() + '.stdout');
  const stderr = stdout + '.stderr';
  const fds = [fs.openSync(stdout, 'wx', 0o600), fs.openSync(stderr, 'wx', 0o600)];
  try {
    execFileSync('powershell', ['-NoProfile', '-File', helper, '-Mode', mode, '-Backup', backup, '-CampaignRoot', root, '-ReviewPath', reviewPath], { windowsHide: true, stdio: ['ignore', ...fds], timeout: 60000 });
    return fs.readFileSync(stdout);
  }
  catch (error) {
    if (fs.existsSync(out)) fs.writeFileSync(path.join(out, mode + '-private-error.log'), error.stderr ?? '', {mode:0o600});
    throw error;
  }
  finally { for (const fd of fds) fs.closeSync(fd); }
};
const snapshot = c => {
  for (const side of ['backend', 'frontend']) {
    const s = c[side];
    h.verifySnapshot(confined(root, s.snapshot), s.fingerprint);
    const manifest = confined(root, s.manifest);
    assert(hash(fs.readFileSync(manifest)) === s.manifest_sha256, 'Input manifest drift');
    assert(equal(read(manifest).inputs, read(path.join(s.snapshot, 'snapshot-manifest.json')).inputs), 'Input manifest differs from frozen source');
  }
  assert(hash(fs.readFileSync(confined(root, c.backend.binary))) === c.backend.binary_sha256, 'Binary drift');
};
snapshot(candidate); snapshot(predecessor);
assert(path.resolve(review.runtime_identity.executable) === path.resolve(predecessor.backend.binary) && review.runtime_identity.source_fingerprint === predecessor.backend.fingerprint, 'Predecessor source/path mismatch');
const outputManifest = confined(root, candidate.frontend.output_manifest);
const frontend = confined(root, candidate.frontend.output);
assert(hash(fs.readFileSync(outputManifest)) === candidate.frontend.output_manifest_sha256, 'Frontend output manifest drift');
const files = read(outputManifest);
assert(Array.isArray(files) && files.length === candidate.frontend.files && new Set(files.map(f => f.path)).size === files.length, 'Frontend manifest count');
for (const f of files) assert(hash(fs.readFileSync(confined(frontend, f.path))) === f.sha256, 'Frontend output drift');
function outputFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), 'Frontend link refused');
    const relative = prefix + entry.name;
    return entry.isDirectory() ? outputFiles(path.join(dir, entry.name), relative + '/') : [relative];
  });
}
assert(equal(outputFiles(frontend).sort(), files.map(f => f.path).sort()), 'Unmanifested frontend output');
const catalog = fs.readFileSync(confined(candidate.backend.snapshot, 'internal/panel/game_library/overrides.json'));
assert(hash(catalog) === review.catalog_sha256 && fs.readFileSync(candidate.backend.binary).includes(catalog), 'Embedded catalog mismatch');
async function get(url, headers) {
  const r = await fetch(url, { headers: { ...headers, Connection: 'close' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()) };
}
async function api(p) {
  const r = await get('http://127.0.0.1:18099' + p);
  assert(r.status === 200, 'Read-only API probe failed'); return JSON.parse(r.bytes);
}
function processInventory() { return JSON.parse(ps('inspect').toString().replace(/^\uFEFF/, '')); }
function identity(record) {
  const p = processInventory();
  const live = p.processes.find(x => x.pid === record.pid);
  assert(live && path.resolve(live.executable).toLowerCase() === path.resolve(record.executable).toLowerCase() && live.sha256 === record.binary_sha256 && live.start_time === record.start_time, 'Live process identity mismatch');
  assert(p.listeners.filter(x => x.port === 18099).length === 1 && p.listeners.some(x => x.port === 18099 && x.pid === record.pid && x.address === '127.0.0.1'), 'Exact loopback listener required');
  return p;
}
const fixtures = review.fixtures;
assert(Array.isArray(fixtures) && new Set(fixtures.map(f => f.uuid)).size === fixtures.length, 'Unique reviewed fixture inventory required');
function fixtureReports() {
  for (const f of fixtures) {
    const report = confined(validator, f.report);
    assert(hash(fs.readFileSync(report)) === f.sha256, 'Durable fixture report drift');
    const owned = read(report).fixture;
    assert(owned && owned.server.uuid === f.uuid && owned.server.id === f.id && owned.server.name === f.name && owned.name === f.name && owned.egg.id === f.egg && (owned.server.node ?? owned.node) === f.node, 'Durable fixture ownership mismatch');
    assert([null, 'install_failed'].includes(f.status) && owned.server.status === f.status, 'Unreviewed fixture status');
    const source = read(report).source_report;
    const original = confined(validator, source.path);
    assert(hash(fs.readFileSync(original)) === source.sha256, 'Original fixture report drift');
    const originalFixture = read(original).fixture;
    assert(originalFixture.server.uuid === f.uuid && originalFixture.server.id === f.id && originalFixture.name === f.name && originalFixture.egg.id === f.egg, 'Original fixture ownership mismatch');
  }
}
function queueGuard(q) {
  assert(q.activation_pause?.validatorOutput === validator && !q.installer_slot && Array.isArray(q.claims) && !q.claims.some(c => c.status === 'active'), 'Validator pause/lease/installer guard');
  assert(!fs.existsSync(path.join(validator, 'queue.lock')), 'Validator queue.lock exists');
}
function nativeGuard(all) {
  assert(!h.campaignInstallers(all).length, 'Actual installer exists');
  for (const f of fixtures) {
    const matches = all.filter(c => c.Name === '/' + f.uuid);
    if (f.container_id === null) {
      assert(matches.length === 0 && f.status === 'install_failed', 'Absent native container only allowed for preserved failed install');
      continue;
    }
    const c = all.find(c => c.Id === f.container_id);
    assert(c && c.Name === '/' + f.uuid && !c.State.Running && ['exited', 'created'].includes(c.State.Status), 'Owned fixture not natively parked');
    assert(all.filter(c => c.Name === '/' + f.uuid).length === 1, 'Ambiguous fixture container');
  }
  assert(!all.some(c => c.State.Running && c.HostConfig.NetworkMode === 'voltra-parity-20261029' && !['/voltra-parity-20261029-postgres', '/voltra-parity-20261029-wings'].includes(c.Name)), 'Unexpected campaign workload');
  const cap = h.hostCapacity();
  const activationBudget = review.activation_headroom;
  let ram = h.policy.host_free_memory_bytes;
  let disk = h.policy.host_free_disk_bytes + h.policy.physical_disk_reserve_mib * 1024 ** 2;
  if (activationBudget) {
    assert(activationBudget.scope === 'Parked validator panel activation only; no installer or game admission'
      && Number.isSafeInteger(activationBudget.host_free_memory_bytes) && activationBudget.host_free_memory_bytes >= 16 * 1024 ** 3
      && Number.isSafeInteger(activationBudget.host_free_disk_bytes) && activationBudget.host_free_disk_bytes >= 32 * 1024 ** 3,
    'Invalid reviewed activation headroom');
    ram = activationBudget.host_free_memory_bytes; disk = activationBudget.host_free_disk_bytes;
  }
  assert(cap.ram >= ram && cap.disk >= disk, 'Physical reserves insufficient');
}
function jobsGuard(p) {
  assert(!p.jobs.length, 'Validator process jobs active');
  for (const expected of review.protected_processes) assert(p.processes.some(x => equal(x, expected)), 'Protected process changed');
}
async function inventory() {
  const result = [], seen = new Set();
  for (let page = 1; ; page++) {
    assert(page <= 1000, 'Server pagination overflow');
    const r = await api('/api/application/servers?per_page=1000&page=' + page);
    assert(Array.isArray(r.data), 'Server inventory schema');
    for (const row of r.data) { assert(!seen.has(row.attributes.uuid), 'Repeated server page'); seen.add(row.attributes.uuid); result.push(row.attributes); }
    const pagination = r.meta?.pagination;
    if (pagination) { assert(pagination.current_page === page && Number.isInteger(pagination.total_pages), 'Pagination schema'); if (page >= pagination.total_pages) break; }
    else { assert(r.data.length < 1000, 'Unprovable unpaginated inventory'); break; }
  }
  return result.sort((a, b) => a.uuid.localeCompare(b.uuid));
}
async function guards() {
  queueGuard(read(queuePath)); fixtureReports();
  const all = h.containers().sort((a, b) => a.Id.localeCompare(b.Id)); nativeGuard(all);
  // Docker emits Mounts from an unordered map. Compare the complete mount set by destination.
  for (const c of all) c.Mounts?.sort((a, b) => a.Destination.localeCompare(b.Destination));
  const processes = processInventory(); jobsGuard(processes);
  const servers = await inventory();
  assert(servers.length === fixtures.length, 'Unreviewed actual server');
  for (const s of servers) assert(fixtures.some(f => ['uuid', 'id', 'name', 'egg', 'node', 'status'].every(k => f[k] === s[k])), 'Actual server differs from owned report');
  await api('/healthz'); await api('/api/admin/nodes/1/system-information');
  const creds = read(confined(runtime, 'wings-private.json'));
  assert((await get('http://127.0.0.1:18099/api/remote/servers', { Authorization: 'Bearer ' + creds.token_id + '.' + creds.token })).status === 200 && (await get('http://127.0.0.1:18099/api/remote/servers')).status === 401, 'Wings callback authentication failed');
  assert(Array.isArray(review.public_health) && review.public_health.length > 0, 'Reviewed public health required');
  for (const p of review.public_health) { const r = await get(p.url); assert(r.status === p.status && hash(r.bytes) === p.sha256, 'Public/preview health mismatch'); }
  return { servers, containers: all, protected_processes: processes.processes.filter(p => review.protected_processes.some(x => x.pid === p.pid)), protected_listeners: processes.listeners.filter(x => x.port !== 18099) };
}
function database() {
  const dump = h.docker(['exec', 'voltra-parity-20261029-postgres', 'pg_dump', '-U', 'campaign', '-d', 'campaign', '--data-only']);
  const blocks = [...dump.replace(/\r\n/g, '\n').matchAll(/COPY ([^\n]+)\n([\s\S]*?)\\\.\n/g)];
  const tables = blocks.map(m => {
    const rows = m[2].trimEnd().split('\n').filter(Boolean).sort();
    const record = { table: m[1], count: rows.length, sha256: hash(JSON.stringify(rows)) };
    if (m[1] === 'public.console_log_collectors (server_id, lease_owner, lease_until, connected, last_event_at) FROM stdin;') {
      assert(review.collector_lease_policy === 'Allow native collector owner, expiry and connection state renewal; preserve server membership and last_event_at', 'Explicit transient collector review required');
      const stable = rows.map(row => { const cells = row.split('\t'); assert(cells.length === 5, 'Collector schema mismatch'); return [cells[0], cells[4]]; }).sort((a,b)=>a[0].localeCompare(b[0]));
      record.preservation_sha256 = hash(JSON.stringify(stable));
    }
    return record;
  }).sort((a, b) => a.table.localeCompare(b.table));
  assert(tables.length === 199 && new Set(tables.map(t => t.table)).size === 199, 'Expected exact 199 DB tables');
  return { tables, contents: dump };
}
function sameDatabase(a, b) {
  const stable = rows => rows.map(({preservation_sha256, ...row}) => ({...row, sha256: preservation_sha256 ?? row.sha256}));
  return equal(stable(a), stable(b));
}
assert(Array.isArray(review.protected_processes) && review.protected_processes.length >= 2, 'Protected preview process review required');
assert(JSON.parse(h.docker(['context', 'inspect', 'desktop-linux']))[0].Endpoints.docker.Host === 'npipe:////./pipe/dockerDesktopLinuxEngine', 'Docker engine mismatch');
const old = read(rootRecord);
assert(equal(old, read(processRecord)) && ['pid', 'executable', 'binary_sha256', 'source_fingerprint'].every(k => old[k] === review.runtime_identity[k]), 'Recorded current runtime differs from review');
assert(typeof review.runtime_identity.start_time === 'string' && (!old.start_time || old.start_time === review.runtime_identity.start_time), 'Reviewed live creation time required');
old.start_time = review.runtime_identity.start_time;
assert(typeof old.frontend === 'string' && path.resolve(old.frontend) === path.resolve(predecessor.frontend.output), 'Exact predecessor process WEB_DIR required');
if (!resume) identity(old);
else {
  assert(equal(read(path.join(out, 'review.json')), review) && equal(read(path.join(out, 'candidate.json')), candidate), 'Resume inputs drift');
  identity(read(path.join(out, 'pending-process.json')));
}
const queueBytes = fs.readFileSync(queuePath), envBytes = fs.readFileSync(envPath);
const before = resume ? read(path.join(out, 'before.json')) : await guards(), dbBefore = resume ? read(path.join(out, 'database-before.json')) : database();
if (!resume) {
fs.mkdirSync(out, { recursive: false, mode: 0o700 });
for (const [name, bytes] of Object.entries({ 'root.json': Buffer.from(JSON.stringify(old)), 'original-root.json': fs.readFileSync(rootRecord), 'process.json': fs.readFileSync(processRecord), 'env.json': envBytes, 'queue.json': queueBytes, 'review.json': reviewBytes, 'candidate.json': candidateBytes })) fs.writeFileSync(path.join(out, name), bytes, { flag: 'wx', mode: 0o600 });
write(path.join(out, 'before.json'), before); write(path.join(out, 'database-before.json'), dbBefore);
}
const dumpName = '/tmp/validator-activation-' + randomUUID() + '.dump';
let changed = resume, rollbackHealthy = false;
let stage = 'backup';
try {
  if (!resume) {
  h.docker(['exec', 'voltra-parity-20261029-postgres', 'pg_dump', '-U', 'campaign', '-d', 'campaign', '-Fc', '-f', dumpName]);
  h.docker(['cp', 'voltra-parity-20261029-postgres:' + dumpName, path.join(out, 'campaign.dump')]);
  assert(fs.statSync(path.join(out, 'campaign.dump')).size > 1024, 'DB backup empty');
  const restored = h.docker(['exec', 'voltra-parity-20261029-postgres', 'pg_restore', '--data-only', '--file=-', dumpName]);
  assert(restored.includes('COPY '), 'Backup unreadable');
  verifyArtifacts(); snapshot(candidate); snapshot(predecessor);
  const preStop = await guards(), preStopDb = database();
  write(path.join(out, 'pre-stop.json'), preStop); write(path.join(out, 'database-pre-stop.json'), preStopDb);
  assert(equal(preStop, before), 'Pre-stop inventory drift');
  assert(sameDatabase(preStopDb.tables, dbBefore.tables), 'Pre-stop DB drift');
  // Synchronous transaction: check native state, process jobs, holds and live identity again before stop.
  // No queue edits: transact atomically serializes exclusion; the original validator hold survives.
  transact(queuePath, q => {
    queueGuard(q); assert(equal(q, read(path.join(out, 'queue.json'))), 'Queue changed');
    fixtureReports(); nativeGuard(h.containers()); jobsGuard(processInventory()); identity(old); verifyArtifacts();
    assert(hash(fs.readFileSync(envPath)) === hash(envBytes) && hash(fs.readFileSync(queuePath)) === hash(queueBytes), 'Private environment/queue byte drift');
    stage = 'launch'; changed = true; ps('activate');
  });
  } else {
    assert(hash(envBytes) === hash(fs.readFileSync(path.join(out, 'env.json'))) && hash(queueBytes) === hash(fs.readFileSync(path.join(out, 'queue.json'))), 'Resume environment/queue drift');
    assert(equal(await guards(), before) && sameDatabase(database().tables, dbBefore.tables), 'Resume preservation mismatch');
  }
  stage = 'new-identity'; const actual = read(path.join(out, 'pending-process.json')); identity(actual);
  assert(actual.binary_sha256 === candidate.backend.binary_sha256 && path.resolve(actual.executable) === path.resolve(candidate.backend.binary), 'Activated identity mismatch');
  stage = 'new-guards'; const after = await guards(); assert(equal(before, after), 'Server/protected inventory drift');
  stage = 'new-database'; const dbAfter = database(); assert(sameDatabase(dbAfter.tables, dbBefore.tables), 'Database rows changed');
  stage = 'served-files';
  for (let i = 0; i < files.length; i += 8) {
    const checked = await Promise.allSettled(files.slice(i, i + 8).map(async f => {
      const urlPath = f.path === 'index.html' ? '' : f.path.split('/').map(encodeURIComponent).join('/');
      const r = await get('http://127.0.0.1:18099/' + urlPath);
      if (r.status !== 200 || hash(r.bytes) !== f.sha256) write(path.join(out, 'served-mismatch-' + randomUUID() + '.json'), {path:f.path,status:r.status,expected:f.sha256,actual:hash(r.bytes),bytes:r.bytes.length});
      assert(r.status === 200 && hash(r.bytes) === f.sha256, 'Served frontend hash mismatch: ' + f.path);
    }));
    assert(checked.every(r => r.status === 'fulfilled'), 'Served frontend hash mismatch');
  }
  const index = await get('http://127.0.0.1:18099/'); assert(index.status === 200 && hash(index.bytes) === candidate.frontend.index_sha256, 'Served index mismatch');
  assert(hash(fs.readFileSync(envPath)) === hash(envBytes) && equal(read(queuePath), read(path.join(out, 'queue.json'))), 'Private env/validator hold changed');
  verifyArtifacts(); write(path.join(out, 'after.json'), after); write(path.join(out, 'database-after.json'), dbAfter);
  // Runtime receipts only; candidate pointers and dispatch/validator holds are intentionally untouched.
  fs.writeFileSync(rootRecord, JSON.stringify(actual, null, 2)); fs.writeFileSync(processRecord, JSON.stringify(actual, null, 2));
  write(path.join(out, 'ready.json'), { status: 'healthy-validator-held', pid: actual.pid, candidate_sha256: hash(candidateBytes), review_sha256: hash(reviewBytes), database_tables: 199, frontend_files: files.length, validator_hold_preserved: true, native_acceptance: false, publication: false });
  console.log('Activation healthy; validator hold preserved. Receipt: ' + out);
} catch (error) {
  write(path.join(out, 'private-exception.json'), {stage,name:error.name,code:error.code,message:error.message,stack:error.stack});
  if (changed) {
    try {
      // DB restore is deliberately not automatic: activation is forbidden to issue lifecycle/DB writes.
      // The exact dump remains available for separately reviewed disaster recovery.
      ps('rollback'); const restored = read(path.join(out, 'restored-process.json')); identity(restored);
      assert(restored.binary_sha256 === old.binary_sha256 && restored.executable === old.executable, 'Rollback snapshot mismatch');
      assert(equal(await guards(), before) && sameDatabase(database().tables, dbBefore.tables), 'Rollback preservation failed');
      assert(hash(fs.readFileSync(envPath)) === hash(envBytes), 'Rollback env mismatch');
      fs.writeFileSync(rootRecord, JSON.stringify(restored, null, 2)); fs.writeFileSync(processRecord, JSON.stringify(restored, null, 2)); rollbackHealthy = true;
    } catch (rollbackError) { write(path.join(out, 'rollback-failure.json'), {guard:rollbackError.safeGuard ?? null}); }
  }
  write(path.join(out, 'failure.json'), { status: 'blocked', changed, rollback_positively_healthy: rollbackHealthy, validator_hold_preserved: true, database_backup: 'campaign.dump', guard: error.safeGuard ?? null, diagnostics: 'Inspect private logs locally; no secret-bearing exception output.' });
  console.error('Activation blocked; validator hold preserved. Inspect private receipt directory.'); process.exitCode = 1;
}
}
// Child-process exceptions can include private stderr. Never print their messages or stacks.
main().catch(error => { console.error('Activation admission failed; no hold was cleared. ' + (error.safeGuard ?? 'Review private inputs and guard contract.')); process.exitCode = 1; });
