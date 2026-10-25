import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
let result=spawnSync(process.execPath,['tools/runtime/stage-zombie-profiles.mjs'],{windowsHide:true,stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
const profiles=JSON.parse(fs.readFileSync('.local/zombie-servers/profiles.json')),catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
for(const [path,p]of Object.entries(profiles)){
 const source=catalog.entries.find(entry=>entry.path===path);assert.equal(p.upstream_sha256,source.sha256);assert.equal(p.verification,'not_verified');assert.equal(p.egg.config.startup,source.egg.config.startup);
 for(const v of source.egg.variables){const actual=p.egg.variables.find(item=>item.env_variable===v.env_variable);for(const key of ['default_value','user_viewable','user_editable','env_variable','name'])assert.equal(actual[key],v[key],`${path}:${v.env_variable}:${key}`);if(!['STEAM_USER','STEAM_PASS'].includes(v.env_variable)||!path.startsWith('dayz/'))assert.equal(actual.rules,v.rules);}
 assert.match(Object.values(p.egg.docker_images)[0],/@sha256:[a-f0-9]{64}$/);
 assert.ok(p.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/scripts/native-console.py','utf8')),'Current shared supervisor must be embedded');
 assert.ok(p.egg.scripts.installation.script.includes('stop_signal=signal.SIGINT'),'Original Ctrl-C requires explicit native SIGINT');
}
result=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${path.resolve('.')},target=/workspace,readonly`,'-w','/workspace','python:3.13-slim','python3','-B','tools/runtime/test-zombie-native.py'],{windowsHide:true,stdio:'inherit'});process.exitCode=result.status??1;
