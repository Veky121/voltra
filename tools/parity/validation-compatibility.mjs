import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { assert, attrs, rows, project, reference, loadJSON, request, runID, Suite } from './common.mjs';

const suite = new Suite('Independent valid Laravel rule compatibility for arbitrary PTDL eggs');
const linux = value => `/mnt/${value[0].toLowerCase()}${value.slice(2).replaceAll('\\', '/')}`;
let cases, nest, server, allocation, fixtures;
const eggs = [];
const live = process.env.PARITY_VALIDATE_RUNTIME === '1';
await suite.check('validation.original-laravel-rules', 'eggs', 'Original installed Laravel accepts each valid example and rejects each invalid value without booting the panel or modifying its database', async () => {
  const { stdout } = await promisify(execFile)('wsl', ['-d', 'Ubuntu', '--', 'php', `${linux(project)}/tools/parity/read-validation.php`, linux(reference)], { timeout: 30000 });
  cases = JSON.parse(stdout); for (const example of cases) { assert.equal(example.native_valid_passes, true); assert.equal(example.native_invalid_rejected, true); }
});
await suite.check('validation.native-http-middleware', 'eggs', 'Original HTTP JSON request passes through native TrimStrings and ConvertEmptyStringsToNull before the validator; all live HTTP examples retain their expected validity', async () => {
  assert.ok(cases);
  for (const example of cases) { assert.equal(example.native_http_valid_passes, true, example.name); assert.equal(example.native_http_invalid_rejected, true, example.name); }
  return { cases: cases.length, booted_panel: false, modified_reference_database: false };
});
await suite.check('validation.fixture', 'eggs', 'Create an isolated import-only nest', async () => {
  nest = attrs((await request('POST', '/api/admin/nests', { name: runID, author: 'parity@example.invalid', description: 'Read-only Laravel rule comparison' })).data);
});
if (cases && nest) {
  fixtures = await loadJSON(path.join(project, '.local/runtime-fixtures.json'));
  const original = (await request('GET', `/api/admin/eggs/${fixtures.egg}/export`)).data;
  if (live) await suite.check('validation.runtime-fixture', 'lifecycle', 'Create a separate real daemon server for startup-value validation; shared browser server remains untouched', async () => {
    const existing = rows((await request('GET', `/api/application/nodes/${fixtures.node}/allocations`)).data);
    let port = 44000 + process.pid % 5000; while (existing.some(a => a.port === port)) port++;
    await request('POST', `/api/application/nodes/${fixtures.node}/allocations`, { ip: '0.0.0.0', ports: [String(port)] });
    allocation = rows((await request('GET', `/api/application/nodes/${fixtures.node}/allocations`)).data).find(a => a.ip === '0.0.0.0' && a.port === port);
    assert.ok(allocation);
    server = attrs((await request('POST', '/api/application/servers', { name: runID, user: 1, node_id: fixtures.node, egg: fixtures.egg, docker_image: 'pteroclone-smoke:local', startup: fixtures.startup, environment: {}, allocation: { default: allocation.id }, limits: { memory: 128, swap: 0, disk: 512, io: 500, cpu: 100 }, feature_limits: { allocations: 1, backups: 0, databases: 0 }, start_on_completion: false })).data);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (attrs((await request('GET', `/api/application/servers/${server.id}`)).data).status === null) return;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    throw Error('Validation fixture installation did not complete');
  });
  for (const example of cases) await suite.check(`validation.rule:${example.name}`, 'eggs', 'A valid PTDL document with an original-supported Laravel rule must import and export unchanged', async () => {
    const document = structuredClone(original); document.name = `${runID}-${example.name}`;
    document.variables = [{ name: 'Compatibility rule', description: 'Original Laravel validates the examples', env_variable: 'PARITY_RULE', default_value: example.valid, user_viewable: true, user_editable: true, rules: example.rule },
      ...Object.entries(example.environment ?? {}).map(([key, value]) => ({ name: key, description: 'Dependent rule context', env_variable: key, default_value: value, user_viewable: true, user_editable: true, rules: 'nullable|string' })),
    ];
    const egg = attrs((await request('POST', `/api/admin/nests/${nest.id}/eggs/import`, document)).data);
    eggs.push(egg);
    assert.equal((await request('GET', `/api/admin/eggs/${egg.id}/export`)).data.variables[0].rules, example.rule);
    if (live) {
      assert.ok(server, 'The owned real server fixture must exist before validating values');
      const endpoint = `/api/application/servers/${server.id}`;
      const environment = { ...example.environment, PARITY_RULE: example.valid_http ?? example.valid };
      const expected = example.native_http_valid_normalized_value ?? '';
      await request('PATCH', `${endpoint}/startup`, { egg: egg.id, startup: fixtures.startup, image: 'pteroclone-smoke:local', environment, skip_scripts: true });
      assert.equal(attrs((await request('GET', endpoint)).data).container.environment.PARITY_RULE, expected);
      const invalid = example.invalid_http ?? example.invalid;
      await request('PATCH', `${endpoint}/startup`, { environment: { ...environment, PARITY_RULE: invalid } }, { status: [422] });
      assert.equal(attrs((await request('GET', endpoint)).data).container.environment.PARITY_RULE, expected, 'Rejected invalid data must not overwrite the valid persisted value');
      if (!example.environment) {
        const client = `/api/client/servers/${server.identifier}/startup/variable`;
        await request('PUT', client, { key: 'PARITY_RULE', value: example.valid_http ?? example.valid });
        await request('PUT', client, { key: 'PARITY_RULE', value: invalid }, { status: [422] });
        assert.equal(attrs((await request('GET', endpoint)).data).container.environment.PARITY_RULE, expected);
      }
    }
    return { original_valid_accepted: true, original_invalid_rejected: true, original_comparison_layer: 'Installed native HTTP JSON middleware and Laravel validator', native_http_normalization_tested: true, live_application_value_checks: live, live_client_value_checks: live && !example.environment };
  });
}
await suite.check('validation.cleanup', 'cleanup', 'Delete only the owned validation server, allocation, imported eggs and nest', async () => {
  if (server) await request('DELETE', `/api/application/servers/${server.id}/force`);
  if (allocation) await request('DELETE', `/api/application/nodes/${fixtures.node}/allocations/${allocation.id}`);
  for (const egg of eggs) await request('DELETE', `/api/admin/eggs/${egg.id}`);
  if (nest) await request('DELETE', `/api/admin/nests/${nest.id}`);
});
await suite.finish('validation-compatibility.json');
