import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const image=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{encoding:'utf8'});if(image.status)throw Error('Existing Python helper image required');
const result=spawnSync('docker',['run','--rm','--network','none','--memory','256m','--mount',`type=bind,source=${path.resolve('.')},target=/workspace,readonly`,'-w','/workspace',image.stdout.trim(),'python3','-B','tools/runtime/test-among-us.py'],{encoding:'utf8'});console.log(result.stdout+result.stderr);if(result.status)process.exit(result.status);
const profiles=JSON.parse(fs.readFileSync('.local/among-us-games/profiles.json')),catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
for(const [recipe,p] of Object.entries(profiles)){
 const entry=catalog.entries.find(e=>e.path===recipe);assert.equal(p.upstream_sha256,entry.sha256);
 for(const v of entry.egg.variables)assert(p.egg.variables.some(x=>x.env_variable===v.env_variable),'Missing original variable '+v.env_variable);
 for(const file of ['among-us-install.py','among-us-runtime.py','native-release.py','native-config.py','bundle-debian-python.py'])assert(p.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/scripts/'+file,'utf8')),'Stale embedded '+file);
 assert.equal(p.egg.config.stop,'^SIGINT');assert.equal(p.egg.variables.find(v=>v.env_variable==='AUTO_UPDATE').default_value,'0');
}
console.log('Both profiles retain original variables and current embedded helpers.');
