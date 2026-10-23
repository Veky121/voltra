import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, rows } from '../../tools/parity/common.mjs';
import { canonicalEgg } from '../../tools/parity/egg-corpus.mjs';

test('reports redact bearer credentials and database URLs', () => {
  const detail = sanitize('Bearer topsecret postgres://user:secret@localhost/db password: supersecret token=anothersecret');
  for (const secret of ['topsecret', 'user:secret', 'supersecret', 'anothersecret']) assert.ok(!detail.includes(secret));
});
test('HTML fallback must never be mistaken for an empty API collection', () => {
  assert.throws(() => rows('<!DOCTYPE html>fallback page'));
  assert.throws(() => rows({ object: 'list', data: null }));
});
test('egg comparison ignores serialization whitespace but preserves install script bytes and config behavior', () => {
  const egg = { meta: { version: 'PTDL_v2' }, name: 'Test', config: { files: '{"x":1}', startup: '{}', logs: '{}', stop: 'stop' }, scripts: { installation: { script: 'first\r\nsecond\n' } } };
  const normalized = structuredClone(egg); normalized.config.files = '{\n  "x": 1\n}';
  assert.deepEqual(canonicalEgg(normalized), canonicalEgg(egg));
  normalized.scripts.installation.script = 'first\nsecond\n';
  assert.notDeepEqual(canonicalEgg(normalized), canonicalEgg(egg));
  normalized.scripts.installation.script = egg.scripts.installation.script;
  normalized.config.files = '{"x":2}';
  assert.notDeepEqual(canonicalEgg(normalized), canonicalEgg(egg));
});
test('v1 image conversion and legacy variable options have explicit expected semantics', () => {
  const value = canonicalEgg({ meta: { version: 'PTDL_v1' }, images: ['image:first', 'image:second'], variables: [{ name: 'Example', env_variable: 'TEST', default_value: 1, options: ['user_viewable'] }] });
  assert.deepEqual(value.docker_images, { 'image:first': 'image:first', 'image:second': 'image:second' });
  assert.equal(value.variables[0].default_value, '1'); assert.equal(value.variables[0].user_viewable, true); assert.equal(value.variables[0].user_editable, false);
});
