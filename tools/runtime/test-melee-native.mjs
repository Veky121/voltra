import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
let result=spawnSync(process.execPath,['tools/runtime/stage-melee-profiles.mjs'],{windowsHide:true,stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
const profiles=JSON.parse(fs.readFileSync('.local/melee-servers/profiles.json')),catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
for(const [recipe,p]of Object.entries(profiles)){
 const original=catalog.entries.find(e=>e.path===recipe);assert.equal(p.upstream_sha256,original.sha256);
 for(const [key,count] of [...new Set(original.egg.variables.map(v=>v.env_variable))].map(key=>[key,original.egg.variables.filter(v=>v.env_variable===key).length]))assert.equal(p.egg.variables.filter(v=>v.env_variable===key).length,count,recipe+':'+key);
 assert.equal(p.egg.config.startup,original.egg.config.startup);assert.match(p.egg.startup,/melee-native.py run/);assert.match(Object.values(p.egg.docker_images)[0],/@sha256:[a-f0-9]{64}$/);assert.equal(p.verification,'not_verified');
 if(recipe.includes('mordhau'))assert.equal(p.port_rules.length,2);
}
result=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${path.resolve('.')},target=/workspace,readonly`,'-w','/workspace','python:3.13-slim','python3','-B','tools/runtime/test-melee-native.py'],{windowsHide:true,stdio:'inherit'});process.exitCode=result.status??1;
