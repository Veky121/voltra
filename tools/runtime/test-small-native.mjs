import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const image=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{encoding:'utf8'});if(image.status)throw Error('Existing Python helper image required');
const result=spawnSync('docker',['run','--rm','--network','none','--memory','256m','--mount',`type=bind,source=${path.resolve('.')},target=/workspace,readonly`,'-w','/workspace',image.stdout.trim(),'python3','-B','tools/runtime/test-small-native.py'],{encoding:'utf8'});console.log(result.stdout+result.stderr);if(result.status)process.exit(result.status);
const profiles=JSON.parse(fs.readFileSync('.local/small-games/profiles.json')),catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),base='internal/panel/game_library/scripts/';
for(const [recipe,profile] of Object.entries(profiles)){
 const original=catalog.entries.find(x=>x.path===recipe);assert.equal(profile.upstream_sha256,original.sha256);
 for(const variable of original.egg.variables)assert(profile.egg.variables.some(x=>x.env_variable===variable.env_variable),recipe+' lost '+variable.env_variable);
 for(const name of ['small-native-install.py','small-native-runtime.py','native-config.py','native-release.py','native-console.py','steam-template.py'])assert(profile.egg.scripts.installation.script.includes(fs.readFileSync(base+name,'utf8')),recipe+' stale '+name);
 if(recipe.startsWith('openrct2/'))assert(profile.egg.scripts.installation.script.includes(fs.readFileSync(base+'openrct2-runtime.py','utf8')));
 else assert(profile.egg.scripts.installation.script.includes(fs.readFileSync(base+'cs2d-console.lua','utf8')));
 assert.equal(profile.egg.variables.find(x=>x.env_variable==='AUTO_UPDATE').default_value,'0');
}
console.log('Both native profiles preserve original variables and embed current launcher sources.');
