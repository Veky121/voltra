import path from 'node:path';
import { assert, attrs, rows, project, reference, loadJSON, request, runID, Suite } from './common.mjs';

const suite = new Suite('Independent extended parity with owned real Docker server');
const fixtures = await loadJSON(path.join(project, '.local/runtime-fixtures.json'));
const cleanup = [];
const get = async (p, options) => (await request('GET', p, undefined, options)).data;
const post = async (p, d = {}, options) => (await request('POST', p, d, options)).data;
const patch = async (p, d, options) => (await request('PATCH', p, d, options)).data;
const del = async (p, options) => request('DELETE', p, undefined, options);
const check = (...args) => suite.check(...args);
const own = (label, task) => cleanup.unshift({ label, task });
const poll = async (label, predicate, timeout = 60000) => {
  const deadline = Date.now() + timeout;
  do { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 400)); } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
};
let user, nest, egg, server, mount, allocations = [], client, application;
const startup = `echo VOLTRA_READY; echo "env-proof:$PARITY_VALUE"; while IFS= read -r line; do case "$line" in stop) exit 0;; *) echo "received:$line";; esac; done`;
const document = {
  meta: { version: 'PTDL_v2', update_url: null }, name: `${runID}-egg`, author: 'parity@example.invalid', description: 'Isolated acceptance fixture', features: [],
  docker_images: { Smoke: 'pteroclone-smoke:local', Alternative: 'alpine:3.23' }, file_denylist: ['denied.txt'], startup,
  config: { files: JSON.stringify({ 'config.txt': { parser: 'properties', find: { value: '{{server.build.env.PARITY_VALUE}}' } } }), startup: '{"done":"VOLTRA_READY"}', logs: '{}', stop: 'stop' },
  scripts: { installation: { script: '#!/bin/sh\nset -eu\necho installer-ran > /mnt/server/installed.txt\necho value=initial > /mnt/server/config.txt\n', container: 'alpine:3.23', entrypoint: 'sh' } },
  variables: [
    { name: 'Editable value', description: 'Must match allowed values', env_variable: 'PARITY_VALUE', default_value: 'initial', user_viewable: true, user_editable: true, rules: 'required|string|in:initial,updated,admin' },
    { name: 'Read only value', description: '', env_variable: 'PARITY_FIXED', default_value: 'fixed', user_viewable: true, user_editable: false, rules: 'required|string' },
    { name: 'Hidden value', description: '', env_variable: 'PARITY_HIDDEN', default_value: 'hidden-fixture-value', user_viewable: false, user_editable: false, rules: 'required|string' },
  ],
};

await check('extended.fixture-user', 'accounts', 'Create an isolated non-admin server owner', async () => {
  user = attrs(await post('/api/application/users', { username: runID.replaceAll('-', '_'), email: `${runID}@example.invalid`, first_name: 'Independent', last_name: 'Owner', external_id: runID }));
  own('user', () => del(`/api/application/users/${user.id}`)); assert.ok(user.id > 0);
});
await check('extended.account-profile', 'accounts', 'A passwordless account updates its own profile with an installed language without admin privileges', async () => {
  await patch('/api/client/account', { first_name: 'Changed', last_name: 'Profile', language: 'en' }, { userID: user.id });
  const account = attrs(await get('/api/client/account', { userID: user.id })); assert.equal(account.first_name, 'Changed'); assert.equal(account.language, 'en');
});
await check('extended.account-activity', 'collaboration', 'Own API-key mutation produces account activity visible to its actor', async () => {
  const response = await post('/api/client/account/api-keys', { description: runID, allowed_ips: [] }, { userID: user.id }); const key = attrs(response);
  await del(`/api/client/account/api-keys/${key.identifier}`, { userID: user.id });
  const events = rows(await get('/api/client/account/activity', { userID: user.id }));
  assert.ok(events.some(e => String(e.event).startsWith('user:')));
}, ['GET /api/client/account/activity']);
await check('extended.nest-crud-relations', 'eggs', 'Nest update, lookup, collection and relation envelopes preserve actual data', async () => {
  nest = attrs(await post('/api/admin/nests', { name: `${runID}-nest`, author: 'parity@example.invalid', description: 'Initial' }));
  own('nest', () => del(`/api/admin/nests/${nest.id}`));
  await patch(`/api/admin/nests/${nest.id}`, { name: `${runID}-updated`, description: 'Changed' });
  assert.equal(attrs(await get(`/api/application/nests/${nest.id}`)).description, 'Changed');
  assert.ok(rows(await get('/api/application/nests')).some(n => n.id === nest.id));
  assert.deepEqual(rows(await get(`/api/application/nests/${nest.id}/eggs`)), []);
}, ['GET /api/application/nests', 'GET /api/application/nests/{nest}', 'GET /api/application/nests/{nest}/eggs', 'POST /admin/nests/new', 'PATCH /admin/nests/view/{nest}', 'GET /admin/nests/view/{nest}']);
await check('extended.egg-import-update-variable-crud', 'eggs', 'Egg import, metadata, scripts and variable controls mutate persisted definitions', async () => {
  egg = attrs(await post(`/api/admin/nests/${nest.id}/eggs/import`, document)); own('egg', () => del(`/api/admin/eggs/${egg.id}`));
  await patch(`/api/admin/eggs/${egg.id}`, { name: `${runID}-updated-egg` });
  await patch(`/api/admin/eggs/${egg.id}/scripts`, { script_install: document.scripts.installation.script, script_entry: 'sh', script_container: 'alpine:3.23' });
  const temp = attrs(await post(`/api/admin/eggs/${egg.id}/variables`, { name: 'Temporary', description: 'Created', env_variable: 'PARITY_TEMP', default_value: 'x', rules: 'nullable|string|max:10', user_viewable: true, user_editable: true }));
  await patch(`/api/admin/eggs/${egg.id}/variables/${temp.id}`, { name: 'Updated temporary', default_value: 'y' });
  assert.equal(rows(await get(`/api/admin/eggs/${egg.id}/variables`)).find(v => v.id === temp.id).default_value, 'y');
  await del(`/api/admin/eggs/${egg.id}/variables/${temp.id}`);
  const exported = await get(`/api/admin/eggs/${egg.id}/export`); assert.equal(exported.variables.length, 3); assert.equal(exported.name, `${runID}-updated-egg`);
}, ['POST /admin/nests/import', 'PATCH /admin/nests/egg/{egg}', 'PATCH /admin/nests/egg/{egg}/scripts', 'GET /admin/nests/egg/{egg}/variables', 'POST /admin/nests/egg/{egg}/variables', 'PATCH /admin/nests/egg/{egg}/variables/{variable}', 'DELETE /admin/nests/egg/{egg}/variables/{variable}', 'GET /admin/nests/egg/{egg}/export']);
await check('extended.egg-direct-create-delete', 'eggs', 'Direct editor creation is separate from importing an egg share document', async () => {
  const direct = attrs(await post(`/api/admin/nests/${nest.id}/eggs`, { name: `${runID}-direct`, author: 'parity@example.invalid', docker_images: { Smoke: 'pteroclone-smoke:local' }, startup, config_files: {}, config_startup: {}, config_logs: {}, config_stop: 'stop' }));
  assert.equal(attrs(await get(`/api/admin/eggs/${direct.id}`)).name, `${runID}-direct`); await del(`/api/admin/eggs/${direct.id}`);
  await request('GET', `/api/admin/eggs/${direct.id}`, undefined, { status: [404] });
}, ['POST /admin/nests/egg/new', 'DELETE /admin/nests/egg/{egg}']);
await check('extended.owned-allocations', 'infrastructure', 'Provision exactly three free allocations for the isolated server', async () => {
  const existing = rows(await get(`/api/application/nodes/${fixtures.node}/allocations`)); const ports = new Set(existing.map(a => a.port));
  let start = 35000 + (process.pid % 5000); while ([start, start + 1, start + 2].some(p => ports.has(p))) start += 3;
  await post(`/api/application/nodes/${fixtures.node}/allocations`, { ip: '0.0.0.0', ports: [String(start), String(start + 1), String(start + 2)] });
  allocations = rows(await get(`/api/application/nodes/${fixtures.node}/allocations`)).filter(a => [start, start + 1, start + 2].includes(a.port) && a.ip === '0.0.0.0'); assert.equal(allocations.length, 3);
  own('allocations', async () => { for (const a of allocations) await del(`/api/application/nodes/${fixtures.node}/allocations/${a.id}`); });
});
const createOwnedServer = async () => {
  const created = attrs(await post('/api/application/servers', { name: runID, external_id: runID, user: user.id, node_id: fixtures.node, nest_id: nest.id, egg: egg.id, docker_image: 'pteroclone-smoke:local', startup, environment: { PARITY_VALUE: 'initial', PARITY_FIXED: 'fixed', PARITY_HIDDEN: 'hidden-fixture-value' }, allocation: { default: allocations[0].id }, limits: { memory: 128, swap: 0, disk: 512, io: 500, cpu: 100 }, feature_limits: { allocations: 3, databases: 3, backups: 3 }, start_on_completion: false }));
  own(`server-${created.id}`, async () => { await del(`/api/application/servers/${created.id}/force`); });
  return created;
};
await check('extended.server-create-install', 'lifecycle', 'Application server create provisions a real Docker installation and authenticated completion callback', async () => {
  server = await createOwnedServer(); application = `/api/application/servers/${server.id}`; client = `/api/client/servers/${server.identifier}`;
  await poll('installation callback', async () => attrs(await get(application)).status === null);
  assert.equal((await request('GET', `${client}/files/contents?file=/installed.txt`)).data, 'installer-ran\n');
}, ['POST /api/application/servers', 'GET /api/application/servers/{server}', 'POST /admin/servers/new', 'GET /api/remote/servers/{uuid}', 'GET /api/remote/servers/{uuid}/install', 'POST /api/remote/servers/{uuid}/install']);
if (server) {
  await check('extended.server-list-external-includes', 'lifecycle', 'Server filtering/external lookup/includes resolve the created server and public related resources', async () => {
    const list = await get(`/api/application/servers?filter[external_id]=${runID}&per_page=1`); assert.equal(rows(list)[0].id, server.id); assert.equal(list.meta.pagination.per_page, 1);
    assert.equal(attrs(await get(`/api/application/servers/external/${runID}`)).id, server.id);
    const result = attrs(await get(`${application}?include=user,node,location,nest,egg,allocations,variables,databases,subusers,transfer`));
    assert.equal(attrs(result.relationships.user).id, user.id); assert.equal(attrs(result.relationships.egg).id, egg.id); assert.equal(rows(result.relationships.variables).length, 3);
    assert.ok(!JSON.stringify(result.relationships.node).includes('daemon_token'));
  }, ['GET /api/application/servers', 'GET /api/application/servers/external/{external_id}']);
  await check('extended.startup-visible-editable', 'operations', 'Startup exposes only visible variables, preserves read-only flags, and validates values before persistence', async () => {
    const options = { userID: user.id }; const initial = await get(`${client}/startup`, options); const vars = rows(initial);
    assert.deepEqual(vars.map(v => v.env_variable).sort(), ['PARITY_FIXED', 'PARITY_VALUE']); assert.equal(vars.find(v => v.env_variable === 'PARITY_FIXED').is_editable, false);
    await request('PUT', `${client}/startup/variable`, { key: 'PARITY_VALUE', value: 'updated' }, options);
    assert.equal(rows(await get(`${client}/startup`, options)).find(v => v.env_variable === 'PARITY_VALUE').server_value, 'updated');
    for (const [key, value] of [['PARITY_VALUE', 'invalid'], ['PARITY_FIXED', 'changed'], ['PARITY_HIDDEN', 'changed']]) await request('PUT', `${client}/startup/variable`, { key, value }, { ...options, status: [400, 403, 422] });
    assert.equal(rows(await get(`${client}/startup`, options)).find(v => v.env_variable === 'PARITY_VALUE').server_value, 'updated');
  }, ['GET /api/client/servers/{server}/startup', 'PUT /api/client/servers/{server}/startup/variable']);
  await check('extended.server-details-build', 'lifecycle', 'Application details/build edits persist server identity and resource/feature limits', async () => {
    await patch(`${application}/details`, { name: `${runID}-details`, description: 'Changed description', user: user.id, external_id: `${runID}-changed` });
    await patch(`${application}/build`, { limits: { memory: 192, swap: 0, disk: 640, io: 500, cpu: 75 }, feature_limits: { allocations: 3, databases: 3, backups: 3 } });
    const actual = attrs(await get(application)); assert.equal(actual.name, `${runID}-details`); assert.equal(actual.limits.memory, 192); assert.equal(actual.limits.cpu, 75); assert.equal(actual.description, 'Changed description');
  }, ['PATCH /api/application/servers/{server}/details', 'PATCH /api/application/servers/{server}/build', 'PATCH /admin/servers/view/{server}/details', 'POST /admin/servers/view/{server}/build']);
  await check('extended.application-startup-environment', 'lifecycle', 'Admin startup edits apply validated environment values including hidden/read-only fields', async () => {
    await patch(`${application}/startup`, { egg: egg.id, startup, image: 'pteroclone-smoke:local', environment: { PARITY_VALUE: 'admin', PARITY_FIXED: 'admin-fixed', PARITY_HIDDEN: 'admin-hidden' }, skip_scripts: false });
    const actual = attrs(await get(application)); assert.equal(actual.container.environment.PARITY_VALUE, 'admin'); assert.equal(actual.container.environment.PARITY_FIXED, 'admin-fixed');
    await request('PATCH', `${application}/startup`, { environment: { PARITY_VALUE: 'invalid' } }, { status: [400, 422] });
    assert.equal(attrs(await get(application)).container.environment.PARITY_VALUE, 'admin');
  }, ['PATCH /api/application/servers/{server}/startup', 'POST /admin/servers/view/{server}/startup']);
  await check('extended.client-settings', 'operations', 'Owner renames the server, selects an allowed image, and rejects arbitrary images', async () => {
    await post(`${client}/settings/rename`, { name: `${runID}-client`, description: 'Owner edited' }, { userID: user.id });
    assert.equal(attrs(await get(client)).description, 'Owner edited');
    await request('PUT', `${client}/settings/docker-image`, { docker_image: 'pteroclone-smoke:local' }, { userID: user.id });
    await request('PUT', `${client}/settings/docker-image`, { docker_image: 'invalid.example/arbitrary:image' }, { userID: user.id, status: [400, 422] });
  }, ['POST /api/client/servers/{server}/settings/rename', 'PUT /api/client/servers/{server}/settings/docker-image']);
  await check('extended.network-primary-notes-release', 'operations', 'Network allocations assign, persist notes, switch primary and release former primary', async () => {
    const settings = attrs(await get('/api/admin/settings')); const setting = 'pterodactyl:client_features:allocations:enabled';
    await patch('/api/admin/settings', { [setting]: true });
    try {
    const initial = rows(await get(`${client}/network/allocations`)); assert.equal(initial.length, 1);
    const added = attrs(await post(`${client}/network/allocations`)); assert.ok(added.id !== initial[0].id);
    await post(`${client}/network/allocations/${added.id}`, { notes: runID });
    assert.equal(rows(await get(`${client}/network/allocations`)).find(a => a.id === added.id).notes, runID);
    await post(`${client}/network/allocations/${added.id}/primary`);
    assert.equal(rows(await get(`${client}/network/allocations`)).find(a => a.id === added.id).is_default, true);
    await request('DELETE', `${client}/network/allocations/${added.id}`, undefined, { status: [400, 422] });
    await del(`${client}/network/allocations/${initial[0].id}`); assert.equal(rows(await get(`${client}/network/allocations`)).length, 1);
    } finally { await patch('/api/admin/settings', { [setting]: settings[setting] }); }
  }, ['GET /api/client/servers/{server}/network/allocations', 'POST /api/client/servers/{server}/network/allocations', 'POST /api/client/servers/{server}/network/allocations/{allocation}', 'POST /api/client/servers/{server}/network/allocations/{allocation}/primary', 'DELETE /api/client/servers/{server}/network/allocations/{allocation}']);
  await check('extended.node-system-server-lists', 'infrastructure', 'Real node system data and node server lists agree with the running daemon and panel', async () => {
    const info = await get(`/api/admin/nodes/${fixtures.node}/system-information`); assert.equal(typeof info.architecture, 'string'); assert.ok(info.cpu_count > 0);
    assert.ok(rows(await get(`/api/admin/nodes/${fixtures.node}/servers`)).some(s => s.id === server.id));
    assert.ok(rows(await get('/api/application/nodes')).some(n => n.id === fixtures.node));
    const deployable = rows(await get(`/api/application/nodes/deployable?location_ids[]=${fixtures.location}&memory=192&disk=640`)); assert.ok(deployable.some(n => n.id === fixtures.node));
  }, ['GET /api/application/nodes', 'GET /api/application/nodes/deployable', 'GET /admin/nodes/view/{node}/servers', 'GET /admin/nodes/view/{node}/system-information']);
  await check('extended.files-pull-rename-delete', 'operations', 'Wings rejects internal download targets and pulls exact bytes from a pinned public source before rename/delete', async () => {
      // Reference router/downloader blocks internal IPs unless explicitly allowlisted.
      await request('POST', `${client}/files/pull`, { url: 'http://127.0.0.1:8088/', directory: '/', filename: `${runID}.txt`, foreground: true }, { status: [400] });
      const url = 'https://raw.githubusercontent.com/pterodactyl/panel/e98678c5a1d07a74036660a459d87a4eb7c105c1/LICENSE.md';
      const expectedResponse = await fetch(url, { signal: AbortSignal.timeout(15000) }); assert.equal(expectedResponse.status, 200); const expected = await expectedResponse.text();
      await post(`${client}/files/pull`, { url, directory: '/', filename: `${runID}.txt`, use_header: false, foreground: true });
      await poll('downloaded file', async () => { try { return (await request('GET', `${client}/files/contents?file=/${runID}.txt`)).data === expected; } catch { return false; } });
      await request('PUT', `${client}/files/rename`, { root: '/', files: [{ from: `${runID}.txt`, to: `${runID}-renamed.txt` }] });
      assert.equal((await request('GET', `${client}/files/contents?file=/${runID}-renamed.txt`)).data, expected);
      await post(`${client}/files/delete`, { root: '/', files: [`${runID}-renamed.txt`] });
  }, ['POST /api/client/servers/{server}/files/pull']);
  await check('extended.suspension-enforced', 'lifecycle', 'Suspending the real server changes daemon state and blocks owner power before unsuspension', async () => {
    await post(`${application}/suspend`); assert.equal(attrs(await get(application)).suspended, true);
    await request('POST', `${client}/power`, { signal: 'start' }, { userID: user.id, status: [400, 403, 409, 422] });
    await post(`${application}/unsuspend`); assert.equal(attrs(await get(application)).status, null);
  }, ['POST /api/application/servers/{server}/suspend', 'POST /api/application/servers/{server}/unsuspend', 'POST /admin/servers/view/{server}/manage/suspension']);
  await check('extended.reinstall-client-admin', 'lifecycle', 'Both owner and admin reinstall paths execute the real installer again', async () => {
    for (const [route, options] of [[`${client}/settings/reinstall`, { userID: user.id }], [`${application}/reinstall`, {}]]) {
      await request('POST', `${client}/files/write?file=/installed.txt`, 'changed', { headers: { 'Content-Type': 'text/plain' } });
      await post(route, {}, options);
      await poll('real reinstall callback and installed content', async () => {
        try { return attrs(await get(application)).status === null && (await request('GET', `${client}/files/contents?file=/installed.txt`)).data === 'installer-ran\n'; } catch { return false; }
      });
    }
  }, ['POST /api/client/servers/{server}/settings/reinstall', 'POST /api/application/servers/{server}/reinstall', 'POST /admin/servers/view/{server}/manage/reinstall']);
  await check('extended.schedules-manual-delays-failure', 'collaboration', 'Real task execution preserves delays and continue-on-failure semantics', async () => {
    const power = async signal => { await post(`${client}/power`, { signal }); await poll(signal, async () => attrs(await get(`${client}/resources`)).current_state === (signal === 'stop' || signal === 'kill' ? 'offline' : 'running')); };
    await power('stop');
    for (const continueOnFailure of [false, true]) {
      const schedule = attrs(await post(`${client}/schedules`, { name: `${runID}-${continueOnFailure}`, minute: '*', hour: '*', day_of_month: '*', month: '*', day_of_week: '*', is_active: false, only_when_online: false }));
      const route = `${client}/schedules/${schedule.id}`;
      try {
        await post(`${route}/tasks`, { action: 'command', payload: 'fails-while-offline', time_offset: 1, continue_on_failure: continueOnFailure });
        await post(`${route}/tasks`, { action: 'power', payload: 'start', time_offset: 1, continue_on_failure: false });
        const start = Date.now(); await post(`${route}/execute`);
        await poll('schedule last run', async () => { const actual = attrs(await get(route)); return actual.last_run_at && !actual.is_processing; });
        const state = attrs(await get(`${client}/resources`)).current_state;
        // Native ProcessScheduleService dispatchNow runs the first manual task
        // immediately. Only the next task's one-second offset must elapse.
        if (continueOnFailure) { assert.ok(Date.now() - start >= 900); await poll('continued power task running', async () => attrs(await get(`${client}/resources`)).current_state === 'running'); }
        else assert.equal(state, 'offline');
        if (continueOnFailure) await power('stop');
      } finally { await del(route); await request('GET', route, undefined, { status: [404] }); }
    }
  }, ['POST /api/client/servers/{server}/schedules/{schedule}/execute', 'DELETE /api/client/servers/{server}/schedules/{schedule}']);
  await check('extended.server-delete-release', 'lifecycle', 'Normal deletion removes the real server and releases its allocations', async () => {
    await del(application); await request('GET', application, undefined, { status: [404] });
    const actual = rows(await get(`/api/application/nodes/${fixtures.node}/allocations`));
    for (const a of allocations) assert.equal(actual.find(x => x.id === a.id).assigned, false);
  }, ['DELETE /api/application/servers/{server}', 'POST /admin/servers/view/{server}/delete']);
  await check('extended.force-delete', 'lifecycle', 'Forced deletion has a working independent path and releases its allocation', async () => {
    const second = await createOwnedServer(); await poll('second installation', async () => attrs(await get(`/api/application/servers/${second.id}`)).status === null);
    await del(`/api/application/servers/${second.id}/force`); await request('GET', `/api/application/servers/${second.id}`, undefined, { status: [404] });
  }, ['DELETE /api/application/servers/{server}/{force?}']);
} else suite.blocked('extended.server-dependent', 'lifecycle', 'Real isolated server creation failed.');

for (const { label, task } of cleanup) await check(`extended.cleanup.${label}`, 'cleanup', 'Remove only the exact owned fixture', async () => { try { await task(); } catch (e) { if (!/received 404/.test(e.message)) throw e; } });
await suite.finish('extended.json');
