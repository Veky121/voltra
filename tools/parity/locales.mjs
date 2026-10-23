import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assert, reference, project, request, Suite } from './common.mjs';

const suite = new Suite('Independent original PHP locale data compatibility');
let original;
await suite.check('locales.authoritative-reference', 'ui', 'Load original PHP translation arrays directly without booting or modifying Laravel', async () => {
  const root = `/mnt/${reference[0].toLowerCase()}${reference.slice(2).replaceAll('\\', '/')}/resources/lang/en`;
  const reader = `/mnt/${project[0].toLowerCase()}${project.slice(2).replaceAll('\\', '/')}/tools/parity/read-locales.php`;
  const { stdout } = await promisify(execFile)('wsl', ['-d', 'Ubuntu', '--', 'php', reader, root], { timeout: 30000 });
  original = JSON.parse(stdout); assert.ok(Object.keys(original).length >= 7);
  // Product branding intentionally differs from the upstream translation.
  original.strings.copyright = '&copy; :year Voltra';
});
const translate = value => typeof value === 'string' ? value.replace(/:([\w.-]+\w)([^\w:]?|$)/gm, '{{$1}}$2') : Array.isArray(value) ? value.map(translate) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, translate(v)])) : value;
if (original) for (const [namespace, expected] of Object.entries(original)) await suite.check(`locales.original-${namespace}`, 'ui', 'Locale JSON preserves original translations and Laravel placeholder semantics', async () => {
  const response = await request('GET', `/locales/locale.json?locale=en&namespace=${namespace}`);
  assert.deepEqual(response.data, { en: { [namespace]: translate(expected) } });
  assert.match(response.headers.get('cache-control'), /max-age=3600/); assert.ok(response.headers.get('etag'));
}, ['GET /locales/locale.json']);
await suite.check('locales.etag-conditional', 'ui', 'Browser conditional requests return304 with matching ETag and no response bytes', async () => {
  const route = '/locales/locale.json?locale=en&namespace=activity'; const initial = await request('GET', route);
  const conditional = await request('GET', route, undefined, { headers: { 'If-None-Match': initial.headers.get('etag') }, status: [304] }); assert.equal(conditional.data, '');
});
await suite.check('locales.input-validation', 'ui', 'Locale endpoint rejects missing or unsafe names before accessing translation files', async () => {
  for (const query of ['', '?locale=en', '?locale=../../&namespace=activity', '?locale=en&namespace=../../secrets', '?locale=english&namespace=activity']) {
    await request('GET', `/locales/locale.json${query}`, undefined, { status: [400, 422] });
  }
});
await suite.check('locales.missing-native-empty', 'ui', 'Absent locale/namespace returns the original native empty-array envelope', async () => {
  const response = await request('GET', '/locales/locale.json?locale=zz&namespace=nonexistent'); assert.deepEqual(response.data, { zz: { nonexistent: [] } });
});
await suite.finish('locales.json');
