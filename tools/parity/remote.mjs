import path from 'node:path';
import { assert, attrs, rows, project, loadJSON, request, runID, Suite } from './common.mjs';

const suite = new Suite('Independent daemon machine authentication and protocol isolation');
const f = await loadJSON(path.join(project, '.local/runtime-fixtures.json'));
const original = await loadJSON(path.join(project, '.local/runtime-server.json'));
const get = async (p, options) => (await request('GET', p, undefined, options)).data;
let location, node, headers, otherHeaders;
await suite.check('remote.fixture-credentials', 'lifecycle', 'Generate machine credentials for a separate empty node and retrieve existing node credentials only in memory', async () => {
  const good = attrs(await get(`/api/application/nodes/${f.node}/configuration`)); headers = { Authorization: `Bearer ${good.token_id}.${good.token}` };
  location = attrs((await request('POST', '/api/application/locations', { short: runID, long: 'Remote protocol isolation' })).data);
  node = attrs((await request('POST', '/api/application/nodes', { name: runID, location_id: location.id, fqdn: '127.0.0.1', scheme: 'http', memory: 1024, memory_overallocate: 0, disk: 1024, disk_overallocate: 0, daemon_listen: 39871, daemon_sftp: 39872 })).data);
  const other = attrs(await get(`/api/application/nodes/${node.id}/configuration`)); otherHeaders = { Authorization: `Bearer ${other.token_id}.${other.token}` };
});
if (headers && otherHeaders) {
  await suite.check('remote.server-list-pagination', 'lifecycle', 'Authenticated daemon list uses numeric pagination and native server recovery envelopes', async () => {
    const response = await get('/api/remote/servers?per_page=1&page=1', { headers });
    assert.ok(Array.isArray(response.data)); assert.equal(response.data.length, 1); assert.equal(response.meta.per_page, 1); assert.equal(typeof response.meta.total, 'number');
    assert.ok(response.data[0].settings.uuid); assert.ok(response.data[0].process_configuration);
  }, ['GET /api/remote/servers']);
  await suite.check('remote.server-config-install-protocol', 'lifecycle', 'Daemon recovery and installer endpoints return real server UUID, process rules and unchanged installation script', async () => {
    const config = await get(`/api/remote/servers/${original.uuid}`, { headers }); assert.equal(config.settings.uuid, original.uuid); assert.ok(config.process_configuration);
    const installer = await get(`/api/remote/servers/${original.uuid}/install`, { headers });
    const egg = await get(`/api/admin/eggs/${f.egg}/export`); assert.equal(installer.script, egg.scripts.installation.script); assert.equal(installer.container_image, egg.scripts.installation.container);
  }, ['GET /api/remote/servers/{uuid}', 'GET /api/remote/servers/{uuid}/install']);
  await suite.check('remote.empty-node-reset', 'lifecycle', 'Daemon reset and pagination affect only the authenticated empty node', async () => {
    await request('POST', '/api/remote/servers/reset', {}, { headers: otherHeaders });
    const response = await get('/api/remote/servers', { headers: otherHeaders }); assert.deepEqual(response.data, []); assert.equal(response.meta.total, 0);
  }, ['POST /api/remote/servers/reset']);
  await suite.check('remote.cross-node-access-denied', 'lifecycle', 'Another valid node cannot read server configuration/install scripts or forge installation completion', async () => {
    for (const [method, route, body] of [['GET', `/api/remote/servers/${original.uuid}`], ['GET', `/api/remote/servers/${original.uuid}/install`], ['POST', `/api/remote/servers/${original.uuid}/install`, { successful: false }]]) {
      await request(method, route, body, { headers: otherHeaders, status: [403] });
    }
  });
  await suite.check('remote.forged-activity-ignored', 'lifecycle', 'A node cannot append activity to another node server', async () => {
    const event = `server:parity-forged-${runID}`;
    await request('POST', '/api/remote/activity', { data: [{ event, server: original.uuid, timestamp: new Date().toISOString(), metadata: { parity: true } }] }, { headers: otherHeaders });
    assert.ok(!rows(await get(`/api/client/servers/${original.identifier}/activity?filter[event]=${event}`)).some(a => a.event === event));
  }, ['POST /api/remote/activity']);
  await suite.check('remote.invalid-token-denied', 'lifecycle', 'Malformed, modified and missing daemon credentials cannot use a browser admin identity fallback', async () => {
    for (const authorization of ['', 'Bearer malformed', `${headers.Authorization}-modified`]) {
      await request('GET', '/api/remote/servers', undefined, { headers: { Authorization: authorization, 'X-Dev-User-ID': '1' }, status: [401, 403] });
    }
  });
  await suite.check('remote.sftp-password-rejected', 'lifecycle', 'Machine-authenticated SFTP rejects password authentication and unknown identities', async () => {
    await request('POST', '/api/remote/sftp/auth', { type: 'password', username: `missing.${original.identifier}`, password: 'not-a-password' }, { headers, status: [400, 403, 422] });
  }, ['POST /api/remote/sftp/auth']);
}
await suite.check('remote.cleanup', 'cleanup', 'Remove only the isolated empty node and location', async () => {
  if (node) await request('DELETE', `/api/application/nodes/${node.id}`);
  if (location) await request('DELETE', `/api/application/locations/${location.id}`);
});
await suite.finish('remote.json');
