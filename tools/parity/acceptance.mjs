import { generateKeyPairSync } from 'node:crypto';
import { assert, artifact, attrs, rows, request, runID, Suite } from './common.mjs';

const suite = new Suite('HTTP behavior and authorization');
const prefix = runID.replaceAll('-', '_');
const cleanup = [];
let account, user, location, node, mount, key, appKey;
const endpoint = (method, route) => `${method} ${route}`;
const check = (id, feature, description, fn, routes = []) => suite.check(id, feature, description, fn, routes);
async function get(route, options) { return (await request('GET', route, undefined, options)).data; }
async function create(route, data, options) { return (await request('POST', route, data, options)).data; }
async function patch(route, data, options) { return (await request('PATCH', route, data, options)).data; }
async function remove(route, options) { return request('DELETE', route, undefined, options); }
function ownDelete(route) {
  const native = route.match(/^\/api\/application\/(users|nodes|locations)\/\d+$/);
  const cleanupTask = async () => {
    await remove(route);
    if (native) await request('GET', route, undefined, { status: [404] });
  };
  cleanupTask.sourceRoutes = native ? [`DELETE /api/application/${native[1]}/{${({ users: 'user', nodes: 'node', locations: 'location' })[native[1]]}}`] : [];
  cleanup.unshift(cleanupTask);
}
function noCredentials(value) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /"(?:token_hash|daemon_token|password|remember_token)"\s*:/, 'Response leaked a credential field');
}

await check('account.default-admin', 'accounts', 'Loopback opens a real persisted administrator without a login redirect', async () => {
  account = attrs(await get('/api/client/account'));
  assert.ok(account.id > 0); assert.equal(account.admin ?? account.root_admin, true); noCredentials(account);
}, ['GET /api/client/account']);
await check('account.invalid-bearer', 'accounts', 'An invalid machine key cannot fall back to the development administrator', async () => {
  await request('GET', '/api/application/users', undefined, { headers: { Authorization: 'Bearer deliberately-invalid-parity-key' }, status: [401] });
});
await check('account.permissions-catalog', 'accounts', 'Permissions endpoint exposes every upstream fine-grained permission', async () => {
  const { readFile } = await import('node:fs/promises');
  const { reference } = await import('./common.mjs');
  const path = await import('node:path');
  const source = await readFile(path.join(reference, 'app/Models/Permission.php'), 'utf8');
  const expected = [...source.matchAll(/public const ACTION_\w+\s*=\s*'([^']+)'/g)].map(m => m[1]);
  const groups = attrs(await get('/api/client/permissions')).permissions;
  const actual = Object.entries(groups).flatMap(([group, value]) => Object.keys(value.keys).map(k => `${group}.${k}`));
  assert.deepEqual(actual.sort(), expected.sort()); return { permissions: expected.length };
}, ['GET /api/client/permissions']);
await check('users.create-read', 'accounts', 'Create a passwordless account and persist its profile and external ID', async () => {
  user = attrs(await create('/api/application/users', { username: prefix, email: `${prefix}@example.invalid`, first_name: 'Parity', last_name: 'Fixture', external_id: runID, root_admin: false }));
  assert.ok(user.id > 0); ownDelete(`/api/application/users/${user.id}`);
  const actual = attrs(await get(`/api/application/users/${user.id}`));
  assert.equal(actual.username, prefix); assert.equal(actual.external_id, runID); noCredentials(actual);
}, ['POST /api/application/users', 'GET /api/application/users/{user}']);
if (user) {
  await check('users.external-lookup', 'accounts', 'External account lookup resolves the created account', async () => {
    assert.equal(attrs(await get(`/api/application/users/external/${encodeURIComponent(runID)}`)).id, user.id);
  }, ['GET /api/application/users/external/{external_id}']);
  await check('users.update-read', 'accounts', 'Profile updates survive a separate request', async () => {
    await patch(`/api/application/users/${user.id}`, { username: prefix, email: `${prefix}@example.invalid`, first_name: 'Updated', last_name: 'Fixture' });
    const actual = attrs(await get(`/api/application/users/${user.id}`));
    assert.equal(actual.first_name ?? actual.name_first, 'Updated');
  }, ['PATCH /api/application/users/{user}']);
  await check('users.include-servers', 'accounts', 'Application account include returns a server relationship with the expected envelope', async () => {
    const actual = attrs(await get(`/api/application/users/${user.id}?include=servers`));
    assert.deepEqual(rows(actual.relationships.servers), []);
  });
  await check('users.non-admin-denied', 'accounts', 'A real non-admin account cannot call administrative CRUD APIs', async () => {
    const opts = { userID: user.id, status: [403] };
    await request('GET', '/api/application/users', undefined, opts);
    await request('GET', '/api/admin/settings', undefined, opts);
  });
  await check('users.identity-header', 'accounts', 'Development identity switches to the exact persisted user', async () => {
    assert.equal(attrs(await get('/api/client/account', { userID: user.id })).id, user.id);
  });
  await check('users.duplicate-rejected', 'accounts', 'Duplicate accounts are validation errors rather than database errors', async () => {
    await request('POST', '/api/application/users', { username: prefix, email: `${prefix}@example.invalid`, first_name: 'Duplicate', last_name: 'Fixture' }, { status: [400, 409, 422] });
  });
  await check('users.disabled-denied', 'accounts', 'Disabling an account immediately prevents its API access', async () => {
    await patch(`/api/application/users/${user.id}`, { username: prefix, email: `${prefix}@example.invalid`, first_name: 'Updated', last_name: 'Fixture', disabled: true });
    try { await request('GET', '/api/client/account', undefined, { userID: user.id, status: [403] }); }
    finally { await patch(`/api/application/users/${user.id}`, { username: prefix, email: `${prefix}@example.invalid`, first_name: 'Updated', last_name: 'Fixture', disabled: false }); }
  });
} else suite.blocked('users-dependent', 'accounts', 'Account creation failed.');
await check('users.filter-sort-pagination', 'accounts', 'Account listing supports upstream filter, sorting and page metadata', async () => {
  const list = await get(`/api/application/users?filter[username]=${encodeURIComponent(prefix)}&sort=-id&per_page=1&page=1`);
  const found = rows(list); assert.equal(found.length, 1); assert.equal(found[0].username, prefix);
  assert.equal(list.meta.pagination.per_page, 1); assert.ok(list.meta.pagination.total >= 1);
}, ['GET /api/application/users']);
await check('keys.client-create-auth', 'accounts', 'A newly created client key authenticates as its owner and cannot use admin APIs', async () => {
  const response = await create('/api/client/account/api-keys', { description: runID, allowed_ips: [] });
  key = { ...attrs(response), secret: response.meta?.secret_token };
  assert.ok(key.identifier); assert.ok(key.secret); ownDelete(`/api/client/account/api-keys/${key.identifier}`);
  const headers = { Authorization: `Bearer ${key.secret}` };
  assert.equal(attrs(await get('/api/client/account', { headers })).id, account.id);
  await request('GET', '/api/application/users', undefined, { headers, status: [403] });
}, ['POST /api/client/account/api-keys']);
await check('keys.list-secret-hidden', 'accounts', 'Client credential list never returns reusable tokens or token hashes', async () => {
  const list = await get('/api/client/account/api-keys');
  assert.ok(rows(list).some(k => k.identifier === key?.identifier)); noCredentials(list);
  assert.doesNotMatch(JSON.stringify(list), /secret_token/);
}, ['GET /api/client/account/api-keys']);
await check('keys.ip-restriction', 'accounts', 'Client machine keys reject requests outside configured source ranges', async () => {
  const response = await create('/api/client/account/api-keys', { description: runID, allowed_ips: ['192.0.2.0/24'] });
  const k = attrs(response); ownDelete(`/api/client/account/api-keys/${k.identifier}`);
  await request('GET', '/api/client/account', undefined, { headers: { Authorization: `Bearer ${response.meta.secret_token}` }, status: [403] });
});
await check('keys.application-scopes', 'accounts', 'Read-only application key reads its resource and rejects mutations and unrelated resources', async () => {
  const response = await create('/api/admin/api-keys', { description: runID, permissions: { users: 1 }, allowed_ips: [] });
  appKey = { ...attrs(response), secret: response.meta?.secret_token }; assert.ok(appKey.secret);
  ownDelete(`/api/admin/api-keys/${appKey.identifier}`);
  const headers = { Authorization: `Bearer ${appKey.secret}` };
  rows(await get('/api/application/users', { headers }));
  await request('GET', '/api/application/nodes', undefined, { headers, status: [403] });
  await request('POST', '/api/application/users', {}, { headers, status: [403] });
  await request('GET', '/api/client/account', undefined, { headers, status: [403] });
  const included = attrs(await get(`/api/application/users/${user.id}?include=servers`, { headers }));
  assert.ok(!included.relationships?.servers || included.relationships.servers.object === 'null');
});
await check('keys.revoke', 'accounts', 'Revocation rejects a token on the next request', async () => {
  assert.ok(key); await remove(`/api/client/account/api-keys/${key.identifier}`);
  await request('GET', '/api/client/account', undefined, { headers: { Authorization: `Bearer ${key.secret}` }, status: [401] });
}, ['DELETE /api/client/account/api-keys/{identifier}']);
await check('ssh.create-deduplicate-delete', 'accounts', 'SSH keys retain a fingerprint, reject duplicate material, and can be removed', async () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const field = buf => { const length = Buffer.alloc(4); length.writeUInt32BE(buf.length); return Buffer.concat([length, buf]); };
  const encoded = Buffer.concat([field(Buffer.from('ssh-ed25519')), field(raw)]).toString('base64');
  const pub = `ssh-ed25519 ${encoded} ${runID}`;
  const saved = attrs(await create('/api/client/account/ssh-keys', { name: runID, public_key: pub }));
  assert.ok(saved.fingerprint?.startsWith('SHA256:'));
  try {
    assert.ok(rows(await get('/api/client/account/ssh-keys')).some(x => x.fingerprint === saved.fingerprint));
    await request('POST', '/api/client/account/ssh-keys', { name: runID, public_key: pub }, { status: [400, 409, 422] });
  } finally { await create('/api/client/account/ssh-keys/remove', { fingerprint: saved.fingerprint }); }
  assert.ok(!rows(await get('/api/client/account/ssh-keys')).some(x => x.fingerprint === saved.fingerprint));
}, ['GET /api/client/account/ssh-keys', 'POST /api/client/account/ssh-keys', 'POST /api/client/account/ssh-keys/remove']);

await check('locations.create-read-update', 'infrastructure', 'Location CRUD persists descriptive fields', async () => {
  location = attrs(await create('/api/application/locations', { short: runID, long: 'Parity temporary location' }));
  assert.ok(location.id > 0); ownDelete(`/api/application/locations/${location.id}`);
  await patch(`/api/application/locations/${location.id}`, { short: runID, long: 'Updated location' });
  assert.equal(attrs(await get(`/api/application/locations/${location.id}`)).long, 'Updated location');
}, ['POST /api/application/locations', 'GET /api/application/locations/{location}', 'PATCH /api/application/locations/{location}']);
if (location) {
  await check('nodes.create-read-update', 'infrastructure', 'Node CRUD persists limits and daemon connection configuration', async () => {
    node = attrs(await create('/api/application/nodes', { name: runID, location_id: location.id, fqdn: '127.0.0.1', scheme: 'http', memory: 4096, disk: 4096, memory_overallocate: 0, disk_overallocate: 0, upload_size: 100, daemon_listen: 39999, daemon_sftp: 39998, daemon_base: `/tmp/${runID}`, public: true, behind_proxy: false }));
    assert.ok(node.id > 0); ownDelete(`/api/application/nodes/${node.id}`); noCredentials(node);
    // Reference NodeUpdateService saves first, then reports an unreachable daemon.
    const updated = await request('PATCH', `/api/application/nodes/${node.id}`, { name: runID, location_id: location.id, fqdn: '127.0.0.1', scheme: 'http', memory: 4096, disk: 4096, memory_overallocate: 0, disk_overallocate: 0, daemon_listen: 39999, daemon_sftp: 39998, description: 'Updated parity node' }, { status: [502] });
    assert.equal(updated.data.errors[0].code, 'NodeConfigurationNotPersisted');
    assert.equal(attrs(await get(`/api/application/nodes/${node.id}`)).description, 'Updated parity node');
  }, ['POST /api/application/nodes', 'GET /api/application/nodes/{node}', 'PATCH /api/application/nodes/{node}']);
}
if (node) {
  await check('nodes.location-includes', 'infrastructure', 'Node and location includes resolve the actual related objects', async () => {
    const n = attrs(await get(`/api/application/nodes/${node.id}?include=location,allocations,servers`));
    assert.equal(attrs(n.relationships.location).id, location.id);
    assert.deepEqual(rows(n.relationships.allocations), []); assert.deepEqual(rows(n.relationships.servers), []);
    const l = attrs(await get(`/api/application/locations/${location.id}?include=nodes`));
    assert.ok(rows(l.relationships.nodes).some(n => n.id === node.id));
  });
  await check('nodes.include-scopes', 'infrastructure', 'Included location/allocation/server resources respect application key permissions', async () => {
    const response = await create('/api/admin/api-keys', { description: runID, permissions: { nodes: 1 }, allowed_ips: [] });
    const k = attrs(response); ownDelete(`/api/admin/api-keys/${k.identifier}`);
    const headers = { Authorization: `Bearer ${response.meta.secret_token}` };
    const actual = attrs(await get(`/api/application/nodes/${node.id}?include=location,allocations,servers`, { headers }));
    for (const relation of ['location', 'allocations', 'servers']) {
      assert.ok(!actual.relationships?.[relation] || actual.relationships[relation].object === 'null', `Application key without ${relation} scope leaked a related resource`);
    }
  });
  await check('nodes.configuration', 'infrastructure', 'Generated Wings configuration refers to the node and panel with machine credentials', async () => {
    const response = await get(`/api/application/nodes/${node.id}/configuration`);
    const config = attrs(response);
    assert.equal(config.uuid, node.uuid); assert.ok(config.token_id); assert.ok(config.token); assert.ok(config.remote);
    assert.equal(config.api.port, 39999); assert.equal(config.system.sftp.bind_port, 39998);
  }, ['GET /api/application/nodes/{node}/configuration']);
  await check('allocations.range-create', 'infrastructure', 'Allocation ranges create all requested ports with aliases', async () => {
    await create(`/api/application/nodes/${node.id}/allocations`, { ip: '127.0.0.1', alias: 'parity.invalid', ports: ['34010-34012'] });
    const actual = rows(await get(`/api/application/nodes/${node.id}/allocations`));
    assert.deepEqual(actual.map(a => a.port).sort(), [34010, 34011, 34012]);
    assert.ok(actual.every(a => a.alias === 'parity.invalid'), 'Native application allocation DTO must expose alias');
  }, ['POST /api/application/nodes/{node}/allocations', 'GET /api/application/nodes/{node}/allocations']);
  await check('allocations.duplicate-ignore', 'infrastructure', 'Overlapping allocation batches retain existing rows and add only novel ports, matching upstream insertIgnore', async () => {
    // Reference Services/Allocations/AssignmentService.php calls insertIgnore.
    await create(`/api/application/nodes/${node.id}/allocations`, { ip: '127.0.0.1', ports: ['34012-34014'] });
    const actual = rows(await get(`/api/application/nodes/${node.id}/allocations`));
    assert.deepEqual(actual.map(a => a.port).sort(), [34010, 34011, 34012, 34013, 34014]);
    assert.equal(actual.find(a => a.port === 34012).alias, 'parity.invalid');
  });
  await check('allocations.invalid-range', 'infrastructure', 'Invalid/out-of-range ports are validation errors', async () => {
    await request('POST', `/api/application/nodes/${node.id}/allocations`, { ip: '127.0.0.1', ports: ['65536'] }, { status: [400, 422] });
  });
  await check('allocations.delete', 'infrastructure', 'Unassigned allocation deletion persists', async () => {
    const actual = rows(await get(`/api/application/nodes/${node.id}/allocations`));
    for (const allocation of actual) await remove(`/api/application/nodes/${node.id}/allocations/${allocation.id}`);
    assert.equal(rows(await get(`/api/application/nodes/${node.id}/allocations`)).length, 0);
  }, ['DELETE /api/application/nodes/{node}/allocations/{allocation}']);
}
await check('mounts.create-update-delete', 'infrastructure', 'Mount definitions persist read-only and source/target settings', async () => {
  mount = attrs(await create('/api/admin/mounts', { name: runID, description: 'Parity temporary mount', source: `/tmp/${runID}`, target: `/mnt/${runID}`, read_only: true, user_mountable: false }));
  assert.ok(mount.id > 0); ownDelete(`/api/admin/mounts/${mount.id}`);
  await patch(`/api/admin/mounts/${mount.id}`, { description: 'Updated mount', read_only: false });
  const actual = attrs(await get(`/api/admin/mounts/${mount.id}`));
  assert.equal(actual.description, 'Updated mount'); assert.equal(actual.read_only, false);
});
await check('remote.unauthenticated-denied', 'lifecycle', 'Remote machine APIs always require daemon authentication even in no-login mode', async () => {
  for (const [method, route, data] of [['GET','/api/remote/servers'], ['POST','/api/remote/servers/reset', {}], ['POST','/api/remote/sftp/auth', {}], ['POST','/api/remote/activity', {}]]) {
    await request(method, route, data, { status: [401, 403] });
  }
});

const serverID = process.env.PARITY_SERVER;
if (serverID) {
  const server = `/api/client/servers/${encodeURIComponent(serverID)}`;
  let schedule;
  await check('server.profile', 'lifecycle', 'Client server object retains limits, ownership, allocations and status fields', async () => {
    const s = attrs(await get(server)); assert.ok(s.identifier); assert.ok(s.uuid); assert.ok(s.limits); assert.ok(s.feature_limits); assert.ok(s.relationships.allocations);
  }, ['GET /api/client/servers/{server}']);
  await check('server.include-scopes', 'lifecycle', 'Application server includes do not bypass unrelated resource scopes', async () => {
    const response = await create('/api/admin/api-keys', { description: runID, permissions: { servers: 1 }, allowed_ips: [] });
    const k = attrs(response); ownDelete(`/api/admin/api-keys/${k.identifier}`);
    const headers = { Authorization: `Bearer ${response.meta.secret_token}` };
    const actual = attrs(await get(`/api/application/servers/${encodeURIComponent(serverID)}?include=user,node,location,egg,nest,allocations,subusers,databases`, { headers }));
    for (const relation of ['user', 'node', 'location', 'egg', 'nest', 'allocations', 'subusers', 'databases']) {
      assert.ok(!actual.relationships?.[relation] || actual.relationships[relation].object === 'null', `Application key without ${relation} scope leaked a related resource`);
    }
  });
  await check('server.unauthorized-account', 'accounts', 'An unrelated account cannot read a server or any protected child endpoint', async () => {
    assert.ok(user);
    for (const suffix of ['', '/files/list', '/backups', '/schedules', '/users', '/startup', '/databases', '/websocket']) {
      await request('GET', `${server}${suffix}`, undefined, { userID: user.id, status: [403, 404] });
    }
  });
  await check('schedules.create-read', 'collaboration', 'Valid inactive cron schedule persists the cron and next run time', async () => {
    schedule = attrs(await create(`${server}/schedules`, { name: runID, minute: '*/5', hour: '*', day_of_month: '*', month: '*', day_of_week: '*', is_active: false, only_when_online: true }));
    assert.ok(schedule.id > 0); ownDelete(`${server}/schedules/${schedule.id}`);
    const actual = attrs(await get(`${server}/schedules/${schedule.id}`));
    assert.equal(actual.name, runID); assert.equal(actual.cron.minute, '*/5'); assert.ok(actual.next_run_at); assert.equal(actual.is_active, false);
  }, ['POST /api/client/servers/{server}/schedules', 'GET /api/client/servers/{server}/schedules/{schedule}']);
  await check('schedules.invalid-cron', 'collaboration', 'Invalid cron fields reject creation without a partial schedule', async () => {
    const before = rows(await get(`${server}/schedules`)).length;
    await request('POST', `${server}/schedules`, { name: runID, minute: '99', hour: '*', day_of_month: '*', month: '*', day_of_week: '*', is_active: false }, { status: [400, 422] });
    assert.equal(rows(await get(`${server}/schedules`)).length, before);
  }, ['GET /api/client/servers/{server}/schedules']);
  if (schedule) {
    const scheduleURL = `${server}/schedules/${schedule.id}`;
    await check('schedule.tasks-order-update-delete', 'collaboration', 'Tasks retain deterministic order after insertion, updates and deletion', async () => {
      const a = attrs(await create(`${scheduleURL}/tasks`, { action: 'command', payload: 'echo parity_one', time_offset: 0, continue_on_failure: false }));
      const b = attrs(await create(`${scheduleURL}/tasks`, { action: 'power', payload: 'restart', time_offset: 1, sequence_id: 1, continue_on_failure: true }));
      let tasks = rows(attrs(await get(scheduleURL)).relationships.tasks);
      assert.deepEqual(tasks.map(t => t.id), [b.id, a.id]);
      await create(`${scheduleURL}/tasks/${a.id}`, { action: 'command', payload: 'echo parity_updated', time_offset: 2, sequence_id: 1, continue_on_failure: true });
      tasks = rows(attrs(await get(scheduleURL)).relationships.tasks);
      assert.deepEqual(tasks.map(t => t.id), [a.id, b.id]); assert.equal(tasks[0].payload, 'echo parity_updated');
      await remove(`${scheduleURL}/tasks/${a.id}`);
      tasks = rows(attrs(await get(scheduleURL)).relationships.tasks);
      assert.deepEqual(tasks.map(t => t.id), [b.id]); assert.equal(tasks[0].sequence_id, 1);
    }, ['POST /api/client/servers/{server}/schedules/{schedule}/tasks', 'POST /api/client/servers/{server}/schedules/{schedule}/tasks/{task}', 'DELETE /api/client/servers/{server}/schedules/{schedule}/tasks/{task}']);
    await check('schedule.tasks-invalid-action', 'collaboration', 'Unsupported actions and invalid offsets cannot enter the execution queue', async () => {
      await request('POST', `${scheduleURL}/tasks`, { action: 'shell', payload: 'id', time_offset: 0 }, { status: [400, 422] });
      await request('POST', `${scheduleURL}/tasks`, { action: 'command', payload: 'id', time_offset: -1 }, { status: [400, 422] });
    });
    await check('schedules.update', 'collaboration', 'Editing a schedule recomputes cron and persists status', async () => {
      await create(scheduleURL, { name: `${runID}-updated`, minute: '15', hour: '2', day_of_month: '*', month: '*', day_of_week: '1', is_active: false, only_when_online: false });
      const s = attrs(await get(scheduleURL)); assert.equal(s.cron.hour, '2'); assert.equal(s.only_when_online, false);
    }, ['POST /api/client/servers/{server}/schedules/{schedule}']);
  }
  await check('files.roundtrip', 'operations', 'Writing, reading, renaming and deleting real daemon files preserves exact bytes', async () => {
    const filename = `/${runID}.txt`; const renamed = `/${runID}-renamed.txt`; const content = `${runID}\nUnicode: \u00e4\u4e16\u754c\n`;
    await request('POST', `${server}/files/write?file=${encodeURIComponent(filename)}`, content, { headers: { 'Content-Type': 'text/plain' } });
    try {
      assert.equal((await request('GET', `${server}/files/contents?file=${encodeURIComponent(filename)}`)).data, content);
      const listed = rows(await get(`${server}/files/list?directory=/`)); assert.ok(listed.some(f => f.name === filename.slice(1)));
      await request('PUT', `${server}/files/rename`, { root: '/', files: [{ from: filename.slice(1), to: renamed.slice(1) }] });
      assert.equal((await request('GET', `${server}/files/contents?file=${encodeURIComponent(renamed)}`)).data, content);
    } finally { await create(`${server}/files/delete`, { root: '/', files: [filename.slice(1), renamed.slice(1)] }); }
    const listed = rows(await get(`${server}/files/list?directory=/`)); assert.ok(!listed.some(f => [filename.slice(1), renamed.slice(1)].includes(f.name)));
  }, ['POST /api/client/servers/{server}/files/write', 'GET /api/client/servers/{server}/files/contents', 'GET /api/client/servers/{server}/files/list', 'PUT /api/client/servers/{server}/files/rename', 'POST /api/client/servers/{server}/files/delete']);
  await check('subusers.permission-grant-revoke', 'collaboration', 'Read-only subuser grants expose the server but deny file writes and admin operations', async () => {
    assert.ok(user);
    const sub = attrs(await create(`${server}/users`, { email: user.email, permissions: ['file.read'] }));
    const id = sub.uuid ?? sub.identifier ?? user.uuid;
    try {
      rows(await get(`${server}/files/list`, { userID: user.id }));
      await request('POST', `${server}/files/write?file=/${runID}-forbidden.txt`, 'must not write', { userID: user.id, status: [403] });
      await request('POST', `${server}/power`, { signal: 'start' }, { userID: user.id, status: [403] });
      await request('GET', '/api/application/users', undefined, { userID: user.id, status: [403] });
      const visible = rows(await get('/api/client', { userID: user.id })); assert.ok(visible.some(s => s.identifier === serverID || s.uuid === serverID || String(s.id ?? s.internal_id) === serverID));
    } finally { await remove(`${server}/users/${id}`); }
    await request('GET', server, undefined, { userID: user.id, status: [403, 404] });
  }, ['POST /api/client/servers/{server}/users', 'DELETE /api/client/servers/{server}/users/{user}', 'GET /api/client']);
  await check('activity.server-mutations', 'collaboration', 'Server actions append persistent audit events visible through the API', async () => {
    const actual = rows(await get(`${server}/activity`)); assert.ok(actual.length > 0); assert.ok(actual.some(a => String(a.event).startsWith('server:')));
  }, ['GET /api/client/servers/{server}/activity']);
} else {
  suite.blocked('server-dependent-behavior', 'runtime', 'Set PARITY_SERVER to a dedicated rewrite server to test real Wings files, schedules, subusers and access boundaries.');
}

for (let i = 0; i < cleanup.length; i++) {
  await check(`cleanup.${i + 1}`, 'cleanup', 'Delete only a fixture created by this acceptance run', async () => {
    try { await cleanup[i](); } catch (e) { if (!/received 404/.test(e.message)) throw e; }
  }, cleanup[i].sourceRoutes ?? []);
}
await suite.finish('acceptance.json');
