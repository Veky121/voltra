import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, attrs, rows, reference, loadJSON, request, runID, Suite } from './common.mjs';

export function canonicalEgg(document) {
  const parse = value => typeof value === 'string' ? JSON.parse(value) : value ?? null;
  const string = value => value === undefined || value === null ? '' : String(value);
  const bool = value => value === true || value === 1 || value === '1' || value === 'true';
  let images = document.docker_images;
  if (document.meta?.version === 'PTDL_v1') images = Object.fromEntries((document.images ?? [document.image ?? 'nil']).map(x => [x, x]));
  const installation = document.scripts?.installation ?? {};
  return {
    name: document.name, author: document.author, description: document.description ?? null,
    features: document.features ?? null, docker_images: images,
    file_denylist: document.file_denylist ?? [], startup: document.startup,
    update_url: document.meta?.update_url ?? null,
    config: { files: parse(document.config?.files), startup: parse(document.config?.startup), logs: parse(document.config?.logs), stop: document.config?.stop ?? null },
    installation: { script: installation.script ?? null, entrypoint: installation.entrypoint ?? 'bash', container: installation.container ?? 'alpine:latest' },
    variables: (document.variables ?? []).map(v => ({
      name: string(v.name), description: string(v.description), env_variable: string(v.env_variable), default_value: string(v.default_value),
      user_viewable: v.options ? v.options.includes('user_viewable') : bool(v.user_viewable),
      user_editable: v.options ? v.options.includes('user_editable') : bool(v.user_editable), rules: string(v.rules), field_type: 'text',
    })),
  };
}

async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(filename));
    else if (entry.name.endsWith('.json')) result.push(filename);
  }
  return result;
}
async function main() {
  const suite = new Suite('Every supplied PTDL egg imports and exports through HTTP');
  const corpus = [];
  const files = (await Promise.all(['game-eggs', 'application-eggs', 'generic-eggs'].map(root => walk(path.join(reference, 'upstream', root))))).flat().sort();
  for (const filename of files) {
    const value = await loadJSON(filename).catch(() => null);
    if (value?.meta?.version?.startsWith('PTDL_')) corpus.push({ filename, value });
  }
  assert.ok(corpus.length >= 321, 'Corpus unexpectedly shrank or is missing.');
  let nest;
  await suite.check('egg-corpus.fixture-nest', 'eggs', 'Create an isolated nest without creating or executing a game server', async () => {
    nest = attrs((await request('POST', '/api/admin/nests', { name: runID, author: 'parity@example.invalid', description: 'Temporary HTTP corpus verification' })).data);
    assert.ok(nest.id > 0);
  });
  if (!nest) {
    suite.blocked('egg-corpus.all', 'eggs', 'Temporary nest creation failed. No corpus egg was exercised.');
  } else {
    for (const { filename, value } of corpus) {
      const source = path.relative(reference, filename).replaceAll('\\', '/');
      await suite.check(`egg-corpus:${source}`, 'eggs', 'Import, retrieve, export and compare scripts/configuration/variables without running the egg', async () => {
        const egg = attrs((await request('POST', `/api/admin/nests/${nest.id}/eggs/import`, value)).data);
        assert.ok(egg.id > 0);
        try {
          const publicEgg = attrs((await request('GET', `/api/application/nests/${nest.id}/eggs/${egg.id}`)).data);
          assert.equal(publicEgg.name, value.name);
          const exported = (await request('GET', `/api/admin/eggs/${egg.id}/export`)).data;
          assert.equal(exported.meta.version, 'PTDL_v2');
          assert.deepEqual(canonicalEgg(exported), canonicalEgg(value));
          return { source, version: value.meta.version, variables: value.variables?.length ?? 0, executable_installation_tested: false };
        } finally { await request('DELETE', `/api/admin/eggs/${egg.id}`); }
      }, ['GET /api/application/nests/{nest}/eggs/{egg}']);
    }
    await suite.check('egg-corpus.empty-after-cleanup', 'cleanup', 'Remove every temporary egg and the dedicated nest', async () => {
      const all = (await request('GET', `/api/admin/nests/${nest.id}/eggs`)).data;
      assert.equal(rows(all).length, 0);
      await request('DELETE', `/api/admin/nests/${nest.id}`);
      await request('GET', `/api/admin/nests/${nest.id}`, undefined, { status: [404] });
    });
  }
  await suite.finish('egg-corpus.json');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
