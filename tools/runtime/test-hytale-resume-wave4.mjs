import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const dir='artifacts/game-parity-20261029/resume-wave4-hytale',recipe='hytale/egg-hytale.json';
const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
const staged=JSON.parse(fs.readFileSync(dir+'/fragment.json'))[recipe];
assert.deepEqual(staged.egg.variables,current.egg.variables,'Every ordered control including defaults/rules/permissions must survive');
assert.deepEqual(staged.defaults,current.defaults);
assert.deepEqual(staged.port_rules,current.port_rules);
assert.deepEqual(staged.egg.config,current.egg.config);
const hashes=JSON.parse(fs.readFileSync(dir+'/helper-hashes.json'));
assert(Object.keys(hashes).length>=11,'Expected current dependency bundle plus Hytale wrapper');
for(const [file,hash] of Object.entries(hashes)){
 const bytes=fs.readFileSync(file);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),hash);
 assert(staged.egg.scripts.installation.script.includes(bytes.toString()),'Stale/missing embedded helper '+file);
}
assert(staged.egg.startup.endsWith('.voltra/hytale_runtime.py'));
console.log('PASS: ordered controls, defaults, port rules, lifecycle config, and all current helper bytes preserved.');
