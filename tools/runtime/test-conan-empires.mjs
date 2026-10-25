import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';
const image=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{encoding:'utf8',windowsHide:true});if(image.status)throw Error('Existing fixture Python image required');
const result=spawnSync('docker',['run','--rm','--network','none','--memory','256m','--mount',`type=bind,source=${path.resolve('.')},target=/workspace,readonly`,'-w','/workspace',image.stdout.trim(),'python3','-B','tools/runtime/test-conan-empires.py'],{encoding:'utf8',windowsHide:true});console.log(result.stdout+result.stderr);if(result.status)process.exit(result.status);
const profiles=JSON.parse(fs.readFileSync('.local/conan-empires/profiles.json')),catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));assert.equal(Object.keys(profiles).length,3);
for(const[key,p]of Object.entries(profiles)){
 const original=catalog.entries.find(x=>x.path===key);assert.equal(p.upstream_sha256,original.sha256);
 for(const v of original.egg.variables)assert(p.egg.variables.some(candidate=>candidate.env_variable===v.env_variable),'Lost original '+v.env_variable);
 for(const name of['conan-empires.py','ark-family.py','native-config.py','steam-template.py','bundle-debian-python.py',...(key.startsWith('myth_')?['enshrouded-proton.py']:[])])assert(p.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')),'Stale embedded '+name);
 assert.equal(p.egg.config.files,'{}');assert.equal(p.egg.config.stop,'^SIGTERM');assert(p.egg.features.includes('voltra_steam_template'));
 if(key.includes('enhanced'))assert(!p.egg.features.includes('voltra_typed_wine'));
}
console.log('Three exact Conan/MoE recipes retain every original variable and current shared helper sources. Native game acceptance remains separate.');
