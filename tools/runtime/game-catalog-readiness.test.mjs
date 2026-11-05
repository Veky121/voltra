import test from 'node:test';
import assert from 'node:assert/strict';
import {literalHeredocs, safeSettingsDocument, variablePreservation, declaredDocumentPaths, readinessPresent, compilePythonModules} from './game-catalog-readiness.mjs';
import {empyrionReadyPattern, stageEmpyrionReadiness} from './game-catalog-readiness-ready.mjs';

test('literal helpers extracted without executing shell or crossing delimiter', () => {
  const shell = `cat > '.voltra/first.py' <<'ONE'\nprint('fixture')\nONE\ncat > .voltra/second.sh <<'TWO'\necho fixture\nTWO\n`;
  assert.deepEqual(literalHeredocs(shell), [{file: '.voltra/first.py', source: "print('fixture')"}, {file: '.voltra/second.sh', source: 'echo fixture'}]);
});

test('declared documents reject traversal interpolation and plugin roots', () => {
  assert.equal(safeSettingsDocument('native/Config.ini'), true);
  for (const file of ['/native.ini', '../native.ini', 'a/../native.ini', 'a//b.ini', 'plugins/config.yml', 'mods/config.ini', 'a\\b.ini', '{{CONFIG}}.ini', 'a\0.ini', 'a/$CONFIG.ini']) assert.equal(safeSettingsDocument(file), false, file);
});

test('current relative-list metadata and legacy map paths agree, done arrays valid', () => {
  const relative = ['server.cfg', 'native/Game.ini'];
  assert.deepEqual(declaredDocumentPaths(relative), relative);
  assert.deepEqual(declaredDocumentPaths({'/server.cfg': 'ini', '/native/Game.ini': 'ini'}), ['native/Game.ini', 'server.cfg']);
  assert.equal(readinessPresent('{"done":["Network revision name:","Map generated, starting game"]}'), true);
  assert.equal(readinessPresent({done: 'Server started'}), true);
  for (const value of ['{}', {done: []}, {done: ['']}, {done: [true]}, 'invalid']) assert.equal(readinessPresent(value), false);
});

test('Python compiler catches Foundry multiline break without executing source', () => {
  // Exact malformed regex shape captured from the old Foundry embed lines23-24.
  const brokenFoundry = "import re\nfor line in []:\n    match = re.match(r'^\\s*([^#;=\\s]+)\\s*=(.*)\n, line)\n";
  const result = compilePythonModules([
    {recipe: 'fixture/foundry', file: 'foundry-factory.py', source: brokenFoundry},
    {recipe: 'fixture/safe', file: 'safe.py', source: 'raise RuntimeError("must not execute")\n'},
    {recipe: 'fixture/utf8-bom', file: 'bom.py', source: '\ufeffraise RuntimeError("file BOM must compile without execution")\n'},
  ]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].recipe, 'fixture/foundry');
  assert.equal(result.errors[0].line, 3);
});

test('preservation retains duplicate occurrences and sequence without logging values', () => {
  const original = [{env_variable: 'A', default_value: 'sensitive-fixture'}, {env_variable: 'A', default_value: 'second'}, {env_variable: 'B'}];
  const missing = variablePreservation(original, [original[0], original[2]]);
  assert.deepEqual(missing.missing, [{environment: 'A', occurrence: 2}]);
  assert.equal(missing.original_order_preserved, false);
  const changed = variablePreservation(original, [{env_variable: 'EXTRA'}, ...original.map(x => ({...x, rules: 'new'}))]);
  assert.equal(changed.original_order_preserved, true);
  assert.equal(changed.missing.length, 0);
  assert.equal(changed.metadata_reviews.length, 3);
  assert.equal(JSON.stringify(changed).includes('sensitive-fixture'), false);
});

test('Empyrion listener marker matches native log shape, not launcher or admin channel', () => {
  const ready = new RegExp(empyrionReadyPattern);
  for (const line of ['27-19:23:02.743 -LOG- Unity network started listening on port 30000', '27-20:53:25.785 16_53 -LOG- Server started listening on port 29999', '18-20.22.27.309 16_22 -LOG- Server started listening on port 30030']) assert.equal(ready.test(line), true);
  for (const line of ['wine: initialized prefix', 'Server started', '27-19:23:02.743 -LOG- Telnet server started on port 30004', '27-19:23:02.743 -LOG- Now listening for PfServers on port 30003', '27-19:23:02.743 -ERR- Error starting dedicated server', '27-19:23:02.743 -LOG- Server started listening on port 30000 failed']) assert.equal(ready.test(line), false);
  const profile = {egg: {config: {startup: '{}', stop: '^SIGTERM'}, variables: [{env_variable: 'ORIGINAL', default_value: 'fixture'}]}, setup_steps: ['Original'], verification: 'not_verified'};
  const next = stageEmpyrionReadiness(profile);
  assert.deepEqual(next.egg.variables, profile.egg.variables);
  assert.equal(next.egg.config.stop, profile.egg.config.stop);
  assert.equal(next.verification, profile.verification);
});
