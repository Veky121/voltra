import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { assert, attrs, rows, project, loadJSON, request, runID, Suite } from './common.mjs';

const suite = new Suite('Independent admin controls and real MariaDB through HTTP');
const fixtures = await loadJSON(path.join(project, '.local/runtime-fixtures.json'));
const exec = promisify(execFile), cleanup = [];
const get = async p => (await request('GET', p)).data;
const post = async (p, d = {}) => (await request('POST', p, d)).data;
const patch = async (p, d) => (await request('PATCH', p, d)).data;
const del = async p => request('DELETE', p);
const own = (label, task) => cleanup.unshift({ label, task });
const poll = async (label, predicate, timeout = 60000) => { const deadline = Date.now() + timeout; do { if (await predicate()) return; await new Promise(r => setTimeout(r, 400)); } while (Date.now() < deadline); throw Error(`Timed out waiting for ${label}`); };
let location, node, mount, host, server, allocation, database;
const container = `pteroclone-${runID}`, rootPassword = randomBytes(24).toString('hex');
const docker = async (args, env = {}, timeout = 30000) => (await exec('docker', args, { env: { ...process.env, ...env }, timeout, maxBuffer: 1024 * 1024 })).stdout.trim();
const mysql = async (username, password, sql, db) => docker(['exec', '-e', 'MYSQL_PWD', container, 'mariadb', '-h127.0.0.1', '-P3306', `-u${username}`, '--skip-column-names', '--batch', ...(db ? [db] : []), '-e', sql], { MYSQL_PWD: password });

await suite.check('admin.locations-list-delete', 'infrastructure', 'Location collection, exact lookup and deletion persist independently', async () => {
  location = attrs(await post('/api/application/locations', { short: runID, long: 'Independent admin fixture' })); own('location', () => del(`/api/application/locations/${location.id}`));
  assert.ok(rows(await get('/api/application/locations')).some(l => l.id === location.id));
}, ['GET /api/application/locations', 'POST /admin/locations', 'GET /admin/locations/view/{location}']);
await suite.check('admin.node-deployment-rotation', 'infrastructure', 'Node deployment keys authenticate with limited resource scope and offline credential rotation persists safely', async () => {
  node = attrs(await post('/api/application/nodes', { name: runID, location_id: location.id, fqdn: '127.0.0.1', scheme: 'http', memory: 1024, memory_overallocate: 0, disk: 1024, disk_overallocate: 0, daemon_listen: 39891, daemon_sftp: 39892, daemon_base: `/tmp/${runID}` })); own('node', () => del(`/api/application/nodes/${node.id}`));
  const before = attrs(await get(`/api/application/nodes/${node.id}/configuration`));
  await request('POST', `/api/admin/nodes/${node.id}/reset-token`, {}, { status: [502] });
  const after = attrs(await get(`/api/application/nodes/${node.id}/configuration`)); assert.notEqual(after.token_id, before.token_id); assert.notEqual(after.token, before.token);
  const deployment = await post(`/api/admin/nodes/${node.id}/deploy-token`); assert.equal(deployment.node, node.id); assert.ok(deployment.token);
  try {
    const headers = { Authorization: `Bearer ${deployment.token}` };
    assert.equal(attrs((await request('GET', `/api/application/nodes/${node.id}`, undefined, { headers })).data).id, node.id);
    await request('GET', '/api/application/users', undefined, { headers, status: [403] });
  } finally {
    const keys = rows(await get('/api/admin/api-keys')).filter(k => k.description === `Node ${node.id} deployment key`);
    for (const key of keys) await del(`/api/admin/api-keys/${key.identifier}`);
  }
}, ['POST /admin/nodes/new', 'POST /admin/nodes/view/{node}/settings/token']);
await suite.check('admin.allocation-alias-bulk-delete', 'infrastructure', 'Admin alias and bulk allocation removal change exactly the selected rows', async () => {
  await post(`/api/application/nodes/${node.id}/allocations`, { ip: '127.0.0.1', ports: ['39893-39895'] });
  const all = rows(await get(`/api/application/nodes/${node.id}/allocations`));
  await patch(`/api/admin/nodes/${node.id}/allocations/${all[0].id}`, { alias: 'alias.example.invalid' });
  assert.equal(rows(await get(`/api/application/nodes/${node.id}/allocations`)).find(a => a.id === all[0].id).alias, 'alias.example.invalid');
  await request('DELETE', `/api/admin/nodes/${node.id}/allocations`, { allocations: all.map(a => a.id) });
  assert.equal(rows(await get(`/api/application/nodes/${node.id}/allocations`)).length, 0);
}, ['POST /admin/nodes/view/{node}/allocation/alias', 'DELETE /admin/nodes/view/{node}/allocations', 'POST /admin/nodes/view/{node}/allocation/remove']);
await suite.check('admin.mount-associations', 'infrastructure', 'Mount node/egg association controls add, list and remove actual relations', async () => {
  mount = attrs(await post('/api/admin/mounts', { name: runID, description: 'Relation fixture', source: '/tmp', target: `/mnt/${runID}`, read_only: true, user_mountable: false })); own('mount', () => del(`/api/admin/mounts/${mount.id}`));
  const unsynced = await request('POST', `/api/admin/mounts/${mount.id}/nodes`, { nodes: [node.id] }, { status: [502] }); assert.equal(unsynced.data.errors[0].code, 'MountSyncFailed');
  await post(`/api/admin/mounts/${mount.id}/eggs`, { eggs: [fixtures.egg] });
  assert.equal(rows(await get(`/api/admin/mounts/${mount.id}/nodes`))[0].id, node.id); assert.equal(rows(await get(`/api/admin/mounts/${mount.id}/eggs`))[0].id, fixtures.egg);
  await request('DELETE', `/api/admin/mounts/${mount.id}/nodes/${node.id}`, undefined, { status: [502] }); await del(`/api/admin/mounts/${mount.id}/eggs/${fixtures.egg}`);
  assert.equal(rows(await get(`/api/admin/mounts/${mount.id}/nodes`)).length, 0); assert.equal(rows(await get(`/api/admin/mounts/${mount.id}/eggs`)).length, 0);
}, ['POST /admin/mounts/{mount}/nodes', 'POST /admin/mounts/{mount}/eggs', 'DELETE /admin/mounts/{mount}/nodes/{node_id}', 'DELETE /admin/mounts/{mount}/eggs/{egg_id}']);
await suite.check('admin.settings-validate-persist', 'infrastructure', 'General and advanced settings persist valid edits and reject invalid values atomically', async () => {
  const before = attrs(await get('/api/admin/settings')); const key = 'pterodactyl:guzzle:timeout';
  try {
    await patch('/api/admin/settings', { [key]: before[key] === 29 ? 28 : 29 }); assert.notEqual(attrs(await get('/api/admin/settings'))[key], before[key]);
    await request('PATCH', '/api/admin/settings', { [key]: 0, 'app:name': `${runID}-must-not-save` }, { status: [400, 422] });
    assert.equal(attrs(await get('/api/admin/settings'))['app:name'], before['app:name']);
    const publicSettings = attrs(await get('/api/admin/settings')); assert.ok(!('mail:password' in publicSettings)); assert.ok(!('secret_access_key' in publicSettings['backups.s3']));
  } finally { await patch('/api/admin/settings', { [key]: before[key] }); }
}, ['GET /admin/settings', 'PATCH /admin/settings', 'GET /admin/settings/advanced', 'PATCH /admin/settings/advanced']);

await suite.check('database.real-mariadb-fixture', 'collaboration', 'Start an isolated MariaDB and provision a private host without exposing credentials', async () => {
  await docker(['run', '-d', '--rm', '--name', container, '-p', '127.0.0.1:53316:3306', '-e', 'MARIADB_ROOT_PASSWORD', '-e', 'MARIADB_ROOT_HOST=%', 'mariadb:11.8'], { MARIADB_ROOT_PASSWORD: rootPassword }, 60000); own('mariadb', () => docker(['rm', '-f', container]));
  await poll('MariaDB readiness', async () => { try { return await mysql('root', rootPassword, 'SELECT 1') === '1'; } catch { return false; } });
  host = attrs(await post('/api/admin/database-hosts', { name: runID, host: '127.0.0.1', port: 53316, username: 'root', password: rootPassword, node_id: fixtures.node, max_databases: 10 })); own('host', () => del(`/api/admin/database-hosts/${host.id}`));
  assert.ok(!('password' in host)); assert.equal(host.username, 'root');
  await post(`/api/admin/database-hosts/${host.id}/test`);
  await patch(`/api/admin/database-hosts/${host.id}`, { name: `${runID}-updated` }); assert.equal(attrs(await get(`/api/admin/database-hosts/${host.id}`)).name, `${runID}-updated`);
}, ['POST /admin/databases', 'GET /admin/databases/view/{host}', 'PATCH /admin/databases/view/{host}']);
await suite.check('database.owned-real-server', 'lifecycle', 'Create a separate real server to test database and schedule effects', async () => {
  const existing = rows(await get(`/api/application/nodes/${fixtures.node}/allocations`)); let port = 44000 + process.pid % 1000; while (existing.some(a => a.port === port)) port++;
  await post(`/api/application/nodes/${fixtures.node}/allocations`, { ip: '0.0.0.0', ports: [String(port)] }); allocation = rows(await get(`/api/application/nodes/${fixtures.node}/allocations`)).find(a => a.port === port); own('allocation', () => del(`/api/application/nodes/${fixtures.node}/allocations/${allocation.id}`));
  server = attrs(await post('/api/application/servers', { name: runID, user: 1, node_id: fixtures.node, egg: fixtures.egg, docker_image: 'pteroclone-smoke:local', startup: fixtures.startup, environment: {}, allocation: { default: allocation.id }, limits: { memory: 128, swap: 0, disk: 512, io: 500, cpu: 100 }, feature_limits: { allocations: 1, databases: 3, backups: 3 } })); own('server', () => del(`/api/application/servers/${server.id}/force`));
  await poll('server install', async () => attrs(await get(`/api/application/servers/${server.id}`)).status === null);
});
if (server && host) {
  const client = `/api/client/servers/${server.identifier}`, application = `/api/application/servers/${server.id}`;
  await suite.check('database.client-create-connect-rotate', 'collaboration', 'Client database provisioning creates working SQL credentials, rotation invalidates old password and preserves table data', async () => {
    database = attrs(await post(`${client}/databases`, { database: 'parity_client', remote: '%' })); own('database-client', () => del(`${client}/databases/${database.id}`));
    let password = attrs(database.relationships.password).password; assert.ok(password); assert.equal(database.host.port, 53316);
    await mysql(database.username, password, 'CREATE TABLE proof(value integer); INSERT INTO proof VALUES(42);', database.name);
    assert.equal(await mysql(database.username, password, 'SELECT value FROM proof', database.name), '42');
    assert.ok(rows(await get(`${client}/databases`)).some(d => d.id === database.id));
    const rotated = attrs(await post(`${client}/databases/${database.id}/rotate-password`)); const nextPassword = attrs(rotated.relationships.password).password; assert.notEqual(nextPassword, password);
    await assert.rejects(() => mysql(database.username, password, 'SELECT 1', database.name)); password = nextPassword;
    assert.equal(await mysql(database.username, password, 'SELECT value FROM proof', database.name), '42');
    await del(`${client}/databases/${database.id}`); await assert.rejects(() => mysql(database.username, password, 'SELECT 1', database.name));
    assert.equal(await mysql('root', rootPassword, `SELECT count(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${database.name}'`), '0');
  }, ['GET /api/client/servers/{server}/databases', 'POST /api/client/servers/{server}/databases', 'POST /api/client/servers/{server}/databases/{database}/rotate-password', 'DELETE /api/client/servers/{server}/databases/{database}']);
  await suite.check('database.application-create-read-reset-delete', 'collaboration', 'Application API database controls create actual grants and password reset invalidates previous credentials', async () => {
    const db = attrs(await post(`${application}/databases`, { database: 'parity_application', remote: '%', host: host.id, max_connections: 2 })); own(`database-${db.id}`, () => del(`${application}/databases/${db.id}`));
    assert.ok(rows(await get(`${application}/databases`)).some(d => d.id === db.id));
    const actual = attrs(await get(`${application}/databases/${db.id}?include=password,host`)); assert.equal(actual.database, db.database); assert.equal(actual.max_connections, 2);
    assert.equal(attrs(actual.relationships.host).id, host.id); assert.ok(!('password' in attrs(actual.relationships.host)));
    const password = attrs(actual.relationships.password).password; assert.equal(await mysql(actual.username, password, 'SELECT 1', actual.database), '1');
    await post(`${application}/databases/${db.id}/reset-password`); await assert.rejects(() => mysql(actual.username, password, 'SELECT 1', actual.database));
    await del(`${application}/databases/${db.id}`); await request('GET', `${application}/databases/${db.id}`, undefined, { status: [404] });
  }, ['GET /api/application/servers/{server}/databases', 'POST /api/application/servers/{server}/databases', 'GET /api/application/servers/{server}/databases/{database}', 'POST /api/application/servers/{server}/databases/{database}/reset-password', 'DELETE /api/application/servers/{server}/databases/{database}', 'POST /admin/servers/view/{server}/database', 'PATCH /admin/servers/view/{server}/database', 'DELETE /admin/servers/view/{server}/database/{database}/delete']);
  await suite.check('schedules.backup-action-real-callback', 'collaboration', 'A scheduled backup task creates and completes an actual Wings archive', async () => {
    assert.equal(attrs(await get('/api/admin/settings'))['backups.default'], 'wings', 'Avoid concurrent S3 settings changes');
    const before = rows(await get(`${client}/backups`)).map(b => b.uuid);
    const schedule = attrs(await post(`${client}/schedules`, { name: runID, minute: '*', hour: '*', day_of_month: '*', month: '*', day_of_week: '*', is_active: false, only_when_online: false }));
    try {
      await post(`${client}/schedules/${schedule.id}/tasks`, { action: 'backup', payload: '', time_offset: 0, continue_on_failure: false }); await post(`${client}/schedules/${schedule.id}/execute`);
      let created;
      await poll('scheduled completed backup', async () => { created = rows(await get(`${client}/backups`)).find(b => !before.includes(b.uuid)); return created?.is_successful === true; });
      assert.ok(created.bytes > 0); await del(`${client}/backups/${created.uuid}`);
    } finally { await del(`${client}/schedules/${schedule.id}`); }
  }, ['GET /api/client/servers/{server}/backups']);
  if (process.env.PARITY_RUN_CRON === '1') await suite.check('schedules.automatic-cron-real-power', 'collaboration', 'An active cron schedule runs automatically at its due minute and changes the real daemon power state', async () => {
    await post(`${client}/power`, { signal: 'stop' }); await poll('offline before automatic schedule', async () => attrs(await get(`${client}/resources`)).current_state === 'offline');
    const schedule = attrs(await post(`${client}/schedules`, { name: `${runID}-automatic`, minute: '*', hour: '*', day_of_month: '*', month: '*', day_of_week: '*', is_active: true, only_when_online: false }));
    try {
      await post(`${client}/schedules/${schedule.id}/tasks`, { action: 'power', payload: 'start', time_offset: 0, continue_on_failure: false });
      await poll('automatic cron execution and daemon running', async () => attrs(await get(`${client}/schedules/${schedule.id}`)).last_run_at && attrs(await get(`${client}/resources`)).current_state === 'running', 90000);
    } finally { await del(`${client}/schedules/${schedule.id}`); }
  });
}
for (const { label, task } of cleanup) await suite.check(`admin.cleanup.${label}`, 'cleanup', 'Remove only the exact owned fixture', async () => { try { await task(); } catch (e) { if (!/received 404/.test(e.message)) throw e; } });
await suite.finish('admin-database.json');
