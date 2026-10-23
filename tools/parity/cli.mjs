import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { assert, attrs, rows, project, artifact, loadJSON, request, runID, Suite } from './common.mjs';

const suite = new Suite('Independent compiled operational CLI and persisted behavior');
const execute = promisify(execFile), env = { ...process.env };
for (const line of (await readFile(path.join(project, '.local/runtime.env'), 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/); if (match) env[match[1]] = match[2];
}
const binary = path.join(artifact, 'bin', process.platform === 'win32' ? 'parity-panel.exe' : 'parity-panel');
await mkdir(path.dirname(binary), { recursive: true });
const cli = async args => {
  const { stdout } = await execute(binary, args, { cwd: project, env, timeout: 60000, maxBuffer: 1024 * 1024 });
  for (const secret of [env.DATABASE_URL, env.ENCRYPTION_KEY]) if (secret) assert.ok(!stdout.includes(secret), 'CLI must not expose deployment secrets');
  return JSON.parse(stdout);
};
const get = async p => (await request('GET', p)).data;
const post = async (p, d) => (await request('POST', p, d)).data;
const del = async p => request('DELETE', p);
const poll = async predicate => { const end = Date.now() + 60000; do { if (await predicate()) return; await new Promise(r => setTimeout(r, 400)); } while (Date.now() < end); throw Error('Timed out waiting for real daemon state'); };
let location, node, user, server, allocation;
await suite.check('cli.compile', 'operations_admin', 'Compile the current CLI entry point without changing the running service', async () => {
  await execute('go', ['build', '-o', binary, './cmd/panel'], { cwd: project, env, timeout: 120000 });
});
await suite.check('cli.health-info', 'operations_admin', 'A separate compiled process connects to PostgreSQL and returns sanitized deployment diagnostics', async () => {
  assert.equal((await cli(['health'])).status, 'ok');
  const info = await cli(['p:info']); assert.ok(info.database ?? info.runtime ?? info.go ?? info.version ?? info.app);
  const database = await cli(['p:environment:database']); assert.ok(database);
  return { commands: ['p:info', 'p:environment:database'] };
});
await suite.check('cli.user-crud', 'operations_admin', 'CLI account create/update/delete produces persisted HTTP-visible changes and safe deletion previews', async () => {
  user = attrs(await cli(['p:user:make', `--username=${runID.replaceAll('-', '_')}`, `--email=${runID}@example.invalid`, '--name-first=CLI', '--name-last=Fixture', '--no-password']));
  assert.equal(attrs(await get(`/api/application/users/${user.id}`)).username, user.username);
  await cli(['p:user:update', `--user=${user.id}`, '--name-first=Changed']); assert.equal(attrs(await get(`/api/application/users/${user.id}`)).first_name, 'Changed');
  assert.equal((await cli(['p:user:delete', `--user=${user.id}`])).dry_run, true); assert.equal(attrs(await get(`/api/application/users/${user.id}`)).id, user.id);
  assert.ok(rows(await cli(['p:user:list'])).some(u => u.id === user.id));
  await cli(['p:user:delete', `--user=${user.id}`, '--force']); await request('GET', `/api/application/users/${user.id}`, undefined, { status: [404] });
  return { commands: ['p:user:make', 'p:user:delete'] };
});
await suite.check('cli.location-node-config', 'operations_admin', 'CLI location/node provisioning and private config agree with HTTP records', async () => {
  location = attrs(await cli(['p:location:make', `--short=${runID}`, '--long=CLI fixture']));
  node = attrs(await cli(['p:node:make', `--name=${runID}`, `--locationId=${location.id}`, '--fqdn=127.0.0.1', '--maxMemory=1024', '--maxDisk=1024', '--daemonListeningPort=39881']));
  const list = await cli(['p:node:list', '--format=json']); assert.ok(list.some(n => n.id === node.id));
  const config = await cli(['p:node:configuration', String(node.id), '--format=json']); assert.equal(config.uuid, node.uuid); assert.ok(config.token); assert.ok(config.token_id);
  assert.equal((await cli(['p:location:delete', `--short=${runID}`])).dry_run, true);
  await del(`/api/application/nodes/${node.id}`); await cli(['p:location:delete', `--short=${runID}`, '--force']); await request('GET', `/api/application/locations/${location.id}`, undefined, { status: [404] });
  return { commands: ['p:location:make', 'p:location:delete', 'p:node:make', 'p:node:list', 'p:node:configuration'] };
});
await suite.check('cli.bulk-power-real-daemon', 'operations_admin', 'CLI bulk selection previews safely and explicit execution changes only an owned real server', async () => {
  const f = await loadJSON(path.join(project, '.local/runtime-fixtures.json'));
  const existing = rows(await get(`/api/application/nodes/${f.node}/allocations`)); let port = 45000 + process.pid % 1000; while (existing.some(a => a.port === port)) port++;
  await post(`/api/application/nodes/${f.node}/allocations`, { ip: '0.0.0.0', ports: [String(port)] }); allocation = rows(await get(`/api/application/nodes/${f.node}/allocations`)).find(a => a.port === port);
  let failure, evidence;
  try {
    server = attrs(await post('/api/application/servers', { name: runID, user: 1, node_id: f.node, egg: f.egg, docker_image: 'pteroclone-smoke:local', startup: f.startup, environment: {}, allocation: { default: allocation.id }, limits: { memory: 128, swap: 0, disk: 512, io: 500, cpu: 100 }, feature_limits: { allocations: 1, databases: 0, backups: 0 } }));
    await poll(async () => attrs(await get(`/api/application/servers/${server.id}`)).status === null);
    const preview = await cli(['p:server:bulk-power', 'start', `--servers=${server.id}`]); assert.equal(preview.dry_run, true); assert.equal(preview.selected, 1);
    const resource = `/api/client/servers/${server.identifier}/resources`; assert.equal(attrs(await get(resource)).current_state, 'offline');
    const started = await cli(['p:server:bulk-power', 'start', `--servers=${server.id}`, '--force']); assert.equal(started.servers[0].success, true); await poll(async () => attrs(await get(resource)).current_state === 'running');
    await cli(['p:server:bulk-power', 'stop', `--servers=${server.id}`, '--force']); await poll(async () => attrs(await get(resource)).current_state === 'offline');
    evidence = { commands: ['p:server:bulk-power'] };
  } catch (error) { failure = error; }
  finally {
    // A failed create can persist its row before an unrelated later side effect fails.
    if (!server) server = rows(await get(`/api/application/servers?filter[name]=${encodeURIComponent(runID)}&per_page=100`)).find(s => s.name === runID);
    for (const resource of [server ? `/api/application/servers/${server.id}/force` : null, allocation ? `/api/application/nodes/${f.node}/allocations/${allocation.id}` : null].filter(Boolean)) {
      try { await del(resource); } catch (error) { failure = new Error(`${failure ? `${failure.message}; ` : ''}cleanup: ${error.message}`); }
    }
  }
  if (failure) throw failure;
  return evidence;
});
await suite.check('cli.cleanup', 'cleanup', 'Remove only owned CLI metadata and the temporary binary', async () => {
  for (const [resource, value] of [['nodes', node], ['locations', location], ['users', user]]) if (value) {
    try { await del(`/api/application/${resource}/${value.id}`); } catch (e) { if (!/received 404/.test(e.message)) throw e; }
  }
  await rm(binary, { force: true });
});
await suite.finish('cli.json');
