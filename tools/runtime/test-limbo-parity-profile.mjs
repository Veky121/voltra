import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {stageLimbo, recipe} from './stage-limbo-parity-profile.mjs';
test('single recipe preserves original ordered controls and Java, pins and native lifecycle', () => {
  const all = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
  const before = JSON.stringify(all);
  const result = stageLimbo(all, fs.readFileSync('internal/panel/game_library/scripts/limbo-parity-install.py','utf8'));
  assert.deepEqual(Object.keys(result), [recipe]);
  const egg = result[recipe].egg, original = all[recipe].egg;
  assert.deepEqual(egg.variables, original.variables);
  assert.deepEqual(egg.docker_images, original.docker_images);
  assert.deepEqual(egg.voltra, original.voltra);
  assert.equal(egg.config.startup, original.config.startup);
  assert.equal(egg.config.stop, 'stop');
  assert.equal(egg.config.files, '{}');
  assert.ok(egg.scripts.installation.script.includes('a2de91fcaa2255aed8a111b8786f370213423c7798eee778c00d016d83aa65d2'));
  assert.equal(JSON.stringify(all), before);
  // Duplicate rows must remain distinct, even if future upstream eggs add them.
  all[recipe].egg.variables.push(structuredClone(all[recipe].egg.variables[0]));
  assert.deepEqual(stageLimbo(all, 'fixture')[recipe].egg.variables, all[recipe].egg.variables);
});
test('integrated wrapper refresh is idempotent and preserves current metadata', () => {
  const all = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
  const wrapper = fs.readFileSync('internal/panel/game_library/scripts/limbo-parity-install.py','utf8');
  const current = all[recipe];
  const staged = stageLimbo(all, wrapper)[recipe];
  assert.deepEqual(staged, current);
  const refreshed = stageLimbo({[recipe]: staged}, wrapper + '\n# owned source refresh fixture')[recipe];
  const script = refreshed.egg.scripts.installation.script;
  assert.equal(script.split('python3 .voltra/limbo-parity-install.py').length, 2);
  assert.equal(script.split('test ! -L .voltra/limbo-parity-install.py').length, 2);
  assert.ok(script.includes('# owned source refresh fixture'));
  const restored = structuredClone(refreshed);
  restored.egg.scripts.installation.script = current.egg.scripts.installation.script;
  assert.deepEqual(restored, current);
  assert.deepEqual(stageLimbo({[recipe]:refreshed}, wrapper + '\n# owned source refresh fixture')[recipe], refreshed);
});
test('unexpected terminal commands refuse rather than reordering or duplicating them', () => {
  const all = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
  all[recipe].egg.scripts.installation.script += '\necho unreviewed tail\n';
  assert.throws(() => stageLimbo(all, 'fixture'), /terminal wrapped/);
});
