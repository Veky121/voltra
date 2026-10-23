import { execFile } from 'node:child_process';
import path from 'node:path';
import { assert, attrs, loadJSON, project, reference, request, runID, Suite } from './common.mjs';

const suite = new Suite('Native DTO required fields, scalar types and bounds');
const linux = value => '/mnt/' + value[0].toLowerCase() + value.slice(2).replaceAll('\\', '/');
const cases = [
  { id: 'username-short', kind: 'users', field: 'username', value: 'z' },
  { id: 'username-trailing-symbol', kind: 'users', field: 'username', value: runID + '_' },
  { id: 'first-name-required', kind: 'users', field: 'first_name', present: false },
  { id: 'last-name-required', kind: 'users', field: 'last_name', present: false },
  { id: 'language-unavailable', kind: 'users', field: 'language', value: 'not-an-installed-language' },
  { id: 'external-id-string', kind: 'users', field: 'external_id', value: { fixture: runID } },
  { id: 'location-long-192', kind: 'locations', field: 'long', value: 'x'.repeat(192) },
  ...['scheme', 'memory_overallocate', 'disk_overallocate', 'daemon_listen', 'daemon_sftp'].map(field => ({ id: 'node-required-' + field, kind: 'nodes', field, present: false })),
  { id: 'database-host-port-required', kind: 'database-hosts', field: 'port', present: false },
  { id: 'nest-name-characters', kind: 'nests', field: 'name', value: runID + '!' },
  ...['startup', 'config_stop', 'config_files', 'config_logs', 'config_startup'].map(field => ({ id: 'egg-required-' + field, kind: 'eggs', field, present: false })),
  { id: 'variable-default-present', kind: 'variables', field: 'default_value', present: false },
  { id: 'variable-name-string', kind: 'variables', field: 'name', value: 123 },
];
const numericCases = [
  { id: 'native-node-fraction-overallocate', kind: 'nodes', field: 'memory_overallocate', value: 0.5 },
  { id: 'native-node-numericstring-port', kind: 'nodes', field: 'daemon_sftp', value: '2022' },
];
const positiveCases = [
  { id: 'user-unicode-first-name', kind: 'users', field: 'first_name', value: '界'.repeat(100), positive: true },
  { id: 'user-unicode-last-name', kind: 'users', field: 'last_name', value: '界'.repeat(100), positive: true },
  { id: 'location-unicode-short', kind: 'locations', field: 'short', value: '界'.repeat(30), positive: true },
  { id: 'location-unicode-long', kind: 'locations', field: 'long', value: '界'.repeat(100), positive: true },
  { id: 'node-numericstring-port', kind: 'nodes', field: 'daemon_sftp', value: '2022', positive: true },
  { id: 'database-host-numericstring-port', kind: 'database-hosts', field: 'port', value: '3306', positive: true },
  { id: 'variable-unicode-name', kind: 'variables', field: 'name', value: '界'.repeat(100), positive: true },
];
const owned = [];
const own = endpoint => owned.unshift(endpoint);
let location, nest, egg;
await suite.check('dto.original-field-rules', 'validation', 'Read-only original request/model rules reject invalid cases and accept numeric strings/fractional over-allocation after native JSON middleware', async () => {
  const output = await new Promise((resolve, reject) => {
    const child = execFile('wsl', ['-d', 'Ubuntu', '--', 'php', linux(project) + '/tools/parity/read-dto.php', linux(reference)], { timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.end(JSON.stringify([...cases, ...numericCases, ...positiveCases]));
  });
  const oracle = JSON.parse(output);
  for (const example of cases) assert.equal(oracle.find(c => c.id === example.id).native_passes, false, example.id);
  for (const example of [...numericCases, ...positiveCases]) assert.equal(oracle.find(c => c.id === example.id).native_passes, true, example.id);
  return { cases: oracle, database_presence_constraints_tested: false, reference_database_modified: false };
});
await suite.check('dto.fixtures', 'validation', 'Create independent metadata fixtures without provisioning game servers', async () => {
  location = attrs((await request('POST', '/api/application/locations', { short: runID, long: 'DTO fixture' })).data);
  own('/api/application/locations/' + location.id);
  nest = attrs((await request('POST', '/api/admin/nests', { name: runID, author: 'parity@example.invalid' })).data);
  own('/api/admin/nests/' + nest.id);
  const fixtures = await loadJSON(path.join(project, '.local/runtime-fixtures.json'));
  const doc = (await request('GET', '/api/admin/eggs/' + fixtures.egg + '/export')).data;
  doc.name = runID;
  egg = attrs((await request('POST', '/api/admin/nests/' + nest.id + '/eggs/import', doc)).data);
  own('/api/admin/eggs/' + egg.id);
});
const httpCases = [...cases, ...positiveCases];
if (location && nest && egg) for (let index = 0; index < httpCases.length; index++) {
  const example = httpCases[index];
  const feature = ['users'].includes(example.kind) ? 'accounts' : ['eggs', 'variables', 'nests'].includes(example.kind) ? 'eggs' : 'infrastructure';
  await suite.check('dto.' + example.id, feature, (example.positive ? 'Accept native-valid ' : 'Reject native-invalid ') + example.kind + '.' + example.field + (example.positive ? ' with persisted field fidelity' : ' with 422 before creating a row'), async () => {
    const unique = runID + '-' + index;
    let endpoint, removePrefix, body;
    switch (example.kind) {
      case 'users':
        endpoint = removePrefix = '/api/application/users';
        body = { username: unique, email: unique + '@example.invalid', first_name: 'DTO', last_name: 'Fixture' }; break;
      case 'locations':
        endpoint = removePrefix = '/api/application/locations'; body = { short: unique, long: 'Fixture' }; break;
      case 'nodes':
        endpoint = removePrefix = '/api/application/nodes';
        body = { name: unique, location_id: location.id, fqdn: '127.0.0.1', scheme: 'http', memory: 256, memory_overallocate: 0, disk: 512, disk_overallocate: 0, daemon_listen: 19999, daemon_sftp: 12999 }; break;
      case 'database-hosts':
        endpoint = removePrefix = '/api/admin/database-hosts'; body = { name: unique, host: '127.0.0.1', port: 3306, username: 'dto_fixture', password: null }; break;
      case 'nests':
        endpoint = removePrefix = '/api/admin/nests'; body = { name: unique, author: 'parity@example.invalid' }; break;
      case 'eggs':
        endpoint = '/api/admin/nests/' + nest.id + '/eggs'; removePrefix = '/api/admin/eggs';
        body = { name: unique, author: 'parity@example.invalid', docker_images: { Smoke: 'pteroclone-smoke:local' }, startup: 'echo READY', config_stop: 'stop', config_startup: '{}', config_logs: '{}', config_files: '{}' }; break;
      case 'variables':
        endpoint = removePrefix = '/api/admin/eggs/' + egg.id + '/variables';
        body = { name: 'DTO variable', description: '', env_variable: 'DTO_' + index, default_value: 'x', rules: 'nullable|string', user_viewable: false, user_editable: false }; break;
    }
    if (example.present === false) delete body[example.field]; else body[example.field] = example.value;
    const result = await request('POST', endpoint, body, { status: [200, 201, 202, 204, 400, 404, 409, 422, 500, 502] });
    if (result.status < 300 && attrs(result.data)?.id) own(removePrefix + '/' + attrs(result.data).id);
    assert.equal(result.status, example.positive ? 201 : 422, 'Native ' + (example.positive ? 'valid' : 'invalid') + ' input returned ' + result.status);
    if (example.positive) assert.equal(attrs(result.data)[example.field], example.field === 'port' || example.field === 'daemon_sftp' ? Number(example.value) : example.value);
  });
}
await suite.check('dto.cleanup', 'cleanup', 'Delete only exact successful DTO fixture IDs, including rows wrongly accepted by an older binary', async () => {
  const failures = [];
  for (const endpoint of owned) try { await request('DELETE', endpoint); } catch (error) { failures.push(error.message); }
  assert.deepEqual(failures, []);
});
await suite.finish('dto.json');
