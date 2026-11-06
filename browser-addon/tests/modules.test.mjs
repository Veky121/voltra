import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
// Bundle pure modules in memory so this package needs no package.json/dependencies.
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const {build} = require('esbuild');
const result = await build({stdin: {contents: "export * from './src/modules/fs25.js'; export * from './src/config.js';", resolveDir: new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')}, bundle: true, write: false, format: 'cjs', platform: 'node'});
const sandbox = {exports: {}, module: {exports: {}}, URL};
vm.runInNewContext(result.outputFiles[0].text, sandbox);
const {validateMod, readMod, matchTargets, serverTarget, panelURL, panelPermission, transferProgress} = sandbox.module.exports;
const mod = {module: 'fs25', gameVersion: '25', source: 'https://www.farming-simulator.com/mod.php?mod_id=373433&title=fs2025', url: 'https://cdn26.giants-software.com/modHub/storage/00373433/FS25_haweUlw4000TR.zip', filename: 'FS25_haweUlw4000TR.zip', modVersion: '1.0.0.0'};
test('accepts a current FS25 link and keeps mod version separate', () => {
  assert.equal(validateMod(mod).modVersion, '1.0.0.0');
  assert.equal(validateMod(mod).gameVersion, '25');
});
test('rejects wrong editions, hosts, encoded paths, arbitrary destinations and mismatched files', () => {
  for (const changes of [{gameVersion: '22'}, {filename: '../mod.zip'}, {url: mod.url.replace('cdn26.giants-software.com', 'cdn26.giants-software.com.evil.test')}, {url: mod.url.replace('https:', 'http:')}, {url: mod.url + '?token=secret'}, {url: mod.url.replace('FS25_', '%46S25_')}, {source: 'https://evil.test/mod.php?mod_id=1'}]) assert.throws(() => validateMod({...mod, ...changes}));
});
test('matching ignores running, stopped and starting states', () => {
  const targets = ['running', 'stopped', 'starting'].map(state => ({module: 'fs25', game_version: '25', state}));
  assert.equal(matchTargets(mod, [...targets, {module: 'fs22', game_version: '22'}]).length, 3);
});
test('standard server metadata and permissions determine eligibility without guessing names', () => {
  for (const state of ['running','stopped','starting']) {
    const target = serverTarget({uuid:'s',name:'Farm',egg_features:['voltra_fs25'],state},['file.read','file.create']);
    assert.equal(target.can_install,true);
    assert.equal(target.unavailable,false);
  }
  assert.equal(serverTarget({name:'Farming Simulator 25',egg_features:[]},['*']),null);
  assert.equal(serverTarget({egg_features:['voltra_fs25']},['file.read']).can_install,false);
  assert.equal(serverTarget({egg_features:['voltra_fs25'],is_suspended:true},['*']).unavailable,true);
});
test('credentials require HTTPS except explicit local development', () => {
  assert.equal(panelURL('http://127.0.0.1:18089'), 'http://127.0.0.1:18089');
  assert.equal(panelPermission('http://127.0.0.1:18089'), 'http://127.0.0.1/*');
  for (const input of ['http://panel.test', 'https://user:pass@panel.test', 'https://panel.test/path', 'https://panel.test/?key=secret']) assert.throws(() => panelURL(input));
});
test('bare hosts default to HTTPS and explicit valid schemes are preserved', () => {
  assert.equal(panelURL(' dashboard.njimgang.org '), 'https://dashboard.njimgang.org');
  assert.equal(panelURL('panel.test:8443'), 'https://panel.test:8443');
  assert.equal(panelURL('//panel.test'), 'https://panel.test');
  assert.equal(panelURL('https://panel.test'), 'https://panel.test');
  for (const input of ['', 'bad host', 'ftp://panel.test', 'javascript:alert(1)']) assert.throws(() => panelURL(input));
});
test('extracts ModHub table fields and omits unsupported editions', () => {
  let edition = 'Farming Simulator 25';
  const document = {
    querySelector: () => ({textContent: 'HAWE ULW 4000 TR'}),
    querySelectorAll: selector => selector.includes('table-game-info') ?
      Object.entries({Game: edition, Filename: mod.filename, Version: '1.0.0.0'}).map(([label, value]) => ({querySelectorAll: () => [{textContent: label}, {textContent: value}]})) : [{href: mod.url}],
  };
  assert.equal(readMod(document, mod.source).title, 'HAWE ULW 4000 TR');
  assert.equal(readMod(document, mod.source).modVersion, '1.0.0.0');
  edition = 'Farming Simulator 22';
  assert.equal(readMod(document, mod.source), null);
});
test('unknown transfer totals stay indeterminate', () => {
  assert.equal(transferProgress({received_bytes: 20}), null);
  assert.equal(transferProgress({size_known: true, total_bytes: 100, received_bytes: 30}), 30);
});
test('manifest exposes no website message bridge or broad mandatory hosts', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts.length, 1);
});
