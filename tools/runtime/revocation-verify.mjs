import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import WebSocket from '../../../pterodactyl-vite/node_modules/ws/wrapper.mjs';

const base = 'http://127.0.0.1:8088';
const fixture = JSON.parse(await readFile('.local/runtime-fixtures.json', 'utf8'));
const env = Object.fromEntries((await readFile('.local/runtime.env', 'utf8')).split(/\r?\n/).filter(x => x.includes('=')).map(x => [x.slice(0, x.indexOf('=')).trim(), x.slice(x.indexOf('=') + 1).trim()]));
const database = new URL(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const report = { tested_at: new Date().toISOString(), scope: 'Dedicated disposable server and users; actual Wings websocket authentication and revocation', results: [], cleanup: [] };
const sockets = new Set();
let server, allocation, owner, subuser;
const attr = x => x?.attributes ?? x;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sqlQuote = x => `'${String(x).replaceAll("'", "''")}'`;
function query(sql) {
  return execFileSync('docker', ['exec', 'pteroclone-postgres', 'psql', '-U', decodeURIComponent(database.username), '-d', database.pathname.slice(1), '-At', '-c', sql], { encoding: 'utf8', timeout: 10000 }).trim();
}
async function raw(method, path, body, user) {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Dev-User-ID': String(user) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
}
async function api(method, path, body, user) {
  const response = await raw(method, path, body, user);
  if (!response.ok) throw Error(`${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : await response.json();
}
async function until(fn, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await pause(100); }
  throw Error(`Timeout waiting for ${description}`);
}
async function save() { await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/runtime-revocation.json', JSON.stringify(report, null, 2)); }
async function check(name, fn) {
  const started = Date.now();
  try { const evidence = await fn(); report.results.push({ name, passed: true, duration_ms: Date.now() - started, ...evidence }); console.log(`PASS ${name}`); }
  catch (error) { report.results.push({ name, passed: false, duration_ms: Date.now() - started, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); throw error; }
  finally { await save(); }
}
const client = suffix => `/api/client/servers/${server.uuid}${suffix}`;
function queueState(userUUID) {
  return JSON.parse(query(`SELECT COALESCE(json_agg(json_build_object('id',id,'node_id',node_id,'generation',generation,'attempts',attempts,'completed',completed_at IS NOT NULL)),'[]'::json) FROM daemon_revocations WHERE server_uuid=${sqlQuote(server.uuid)} AND user_uuid=${sqlQuote(userUUID)}`));
}
async function completed(userUUID) {
  await until(() => { const jobs = queueState(userUUID); return jobs.length > 0 && jobs.every(x => x.completed); }, 'durable revocation completion');
  return queueState(userUUID);
}
async function directSocket(token) {
  const node = attr(await api('GET', `/api/application/nodes/${fixture.node}`));
  const scheme = node.scheme === 'https' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://127.0.0.1:${node.daemon_listen}/api/servers/${server.uuid}/ws`, { origin: base });
  const result = { socket, events: [], closed: false };
  sockets.add(socket);
  socket.on('message', data => { try { result.events.push(JSON.parse(String(data))); } catch {} });
  socket.on('close', code => { result.closed = true; result.closeCode = code; sockets.delete(socket); });
  socket.on('error', () => { result.transportError = true; });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', () => reject(Error('Direct Wings websocket transport rejected'))); setTimeout(() => reject(Error('Wings websocket open timeout')), 10000).unref(); });
  socket.send(JSON.stringify({ event: 'auth', args: [token] }));
  await until(() => result.closed || result.events.some(x => ['auth success', 'jwt error', 'daemon error'].includes(x.event)), 'Wings auth response');
  return result;
}
async function authenticated(user) {
  const data = (await api('GET', client('/websocket'), undefined, user.id)).data;
  const claims = JSON.parse(Buffer.from(data.token.split('.')[1], 'base64url').toString());
  if (claims.user_uuid !== user.uuid || claims.server_uuid !== server.uuid) throw Error('Panel token targets wrong user/server');
  const connection = await directSocket(data.token);
  if (!connection.events.some(x => x.event === 'auth success')) throw Error('Actual Wings did not authenticate issued token');
  const marker = `revocation-${run}-${user.id}`;
  connection.socket.send(JSON.stringify({ event: 'send command', args: [marker] }));
  await until(() => connection.events.some(x => x.event === 'console output' && x.args?.some(text => text.includes(marker))), 'authorized real console command');
  return { connection, token: data.token };
}
async function proveRemoved(user, before, mutate) {
  await mutate();
  const response = await raw('GET', client('/resources'), undefined, user.id);
  if (response.status !== 404) throw Error(`Former member panel access returned ${response.status}, expected 404`);
  await until(() => before.connection.closed, 'worker closing existing actual Wings websocket');
  const jobs = await completed(user.uuid);
  const replay = await directSocket(before.token);
  if (replay.events.some(x => x.event === 'auth success')) throw Error('Saved pre-revocation token reauthenticated directly with Wings');
  const denied = replay.events.find(x => x.event === 'jwt error' && x.args?.some(text => /denylist/i.test(text)));
  if (!denied) throw Error('Saved token denial did not prove native Wings denylist');
  replay.socket.close();
  return { panel_status_immediate: response.status, existing_websocket_closed: true, existing_close_code: before.connection.closeCode, saved_token_direct_wings_denied: true, native_denylist_error: true, durable_jobs: jobs };
}

try {
  await check('dedicated_fixture_install_and_real_container_start', async () => {
    owner = attr(await api('POST', '/api/application/users', { username: `revokeowner${run}`, email: `revokeowner${run}@example.invalid`, first_name: 'Revocation', last_name: 'Owner' }));
    subuser = attr(await api('POST', '/api/application/users', { username: `revokesub${run}`, email: `revokesub${run}@example.invalid`, first_name: 'Revocation', last_name: 'Subuser' }));
    const existing = (await api('GET', `/api/application/nodes/${fixture.node}/allocations?per_page=100`)).data.map(attr);
    const port = Array.from({ length: 80 }, (_, i) => 25700 + i).find(p => !existing.some(x => x.port === p));
    if (!port) throw Error('No unused dedicated allocation port');
    await api('POST', `/api/application/nodes/${fixture.node}/allocations`, { ip: '0.0.0.0', ports: [String(port)] });
    allocation = (await api('GET', `/api/application/nodes/${fixture.node}/allocations?per_page=100`)).data.map(attr).find(x => x.port === port);
    if (!allocation || allocation.assigned) throw Error('Dedicated allocation was assigned unexpectedly');
    server = attr(await api('POST', '/api/application/servers', { name: `Revocation dedicated proof ${run}`, user: owner.id, node_id: fixture.node, egg: fixture.egg, allocation: { default: allocation.id }, docker_image: 'pteroclone-smoke:local', startup: fixture.startup, environment: {}, limits: { memory: 128, swap: 0, disk: 512, io: 500, cpu: 100 }, feature_limits: { databases: 0, allocations: 1, backups: 0 } }));
    await writeFile('.local/revocation-fixtures.json', JSON.stringify({ server: { id: server.id, uuid: server.uuid }, allocation: allocation.id, owner: owner.id, subuser: subuser.id }, null, 2));
    await until(async () => { const value = attr(await api('GET', `/api/application/servers/${server.id}`)); return value.status === null && value.container.installed === 1; }, 'dedicated installation', 90000);
    await api('POST', client('/power'), { signal: 'start' });
    await until(async () => attr(await api('GET', client('/resources'))).current_state === 'running', 'dedicated container running', 45000);
    return { server_id: server.id, server_uuid: server.uuid, node_id: fixture.node, allocation_id: allocation.id, owner_id: owner.id, subuser_id: subuser.id };
  });
  let subSocket;
  await check('subuser_real_wings_token_and_console_command', async () => {
    await api('POST', client('/users'), { email: subuser.email, permissions: ['websocket.connect', 'control.console'] });
    await completed(subuser.uuid);
    await pause(1100);
    subSocket = await authenticated(subuser);
    return { actual_wings_auth_success: true, actual_container_console_command: true };
  });
  await check('subuser_removal_disconnects_and_denies_saved_wings_token', () => proveRemoved(subuser, subSocket, () => api('DELETE', client(`/users/${subuser.uuid}`))));
  let ownerSocket;
  await check('owner_real_wings_token_and_console_command', async () => {
    ownerSocket = await authenticated(owner);
    return { actual_wings_auth_success: true, actual_container_console_command: true };
  });
  await check('ownership_reassignment_disconnects_and_denies_saved_wings_token', () => proveRemoved(owner, ownerSocket, () => api('PATCH', `/api/application/servers/${server.id}/details`, { user: 1 })));
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.terminate();
  for (const [name, operation] of [
    ['dedicated_server', async () => { if (server) await api('DELETE', `/api/application/servers/${server.id}`); }],
    ['dedicated_allocation', async () => { if (allocation) await api('DELETE', `/api/application/nodes/${fixture.node}/allocations/${allocation.id}`); }],
    ['dedicated_subuser_account', async () => { if (subuser) await api('DELETE', `/api/application/users/${subuser.id}`); }],
    ['dedicated_owner_account', async () => { if (owner) await api('DELETE', `/api/application/users/${owner.id}`); }],
  ]) {
    try { await operation(); report.cleanup.push({ name, passed: true }); }
    catch (error) { report.cleanup.push({ name, passed: false, error: error.message }); process.exitCode = 1; }
  }
  report.passed = !report.error && report.results.every(x => x.passed) && report.cleanup.every(x => x.passed);
  await save();
  console.log(JSON.stringify({ passed: report.passed, checks: report.results.length, artifact: 'artifacts/runtime-revocation.json', cleanup_complete: report.cleanup.every(x => x.passed) }));
}
