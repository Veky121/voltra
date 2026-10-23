import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';
const image=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{encoding:'utf8',windowsHide:true});if(image.status)throw Error('Existing fixture Python image required');
const result=spawnSync('docker',['run','--rm','--network','none','--memory','256m','--mount',`type=bind,source=${path.resolve('.')},target=/workspace,readonly`,'-w','/workspace',image.stdout.trim(),'python3','-B','tools/runtime/test-minecraft-special.py'],{encoding:'utf8',windowsHide:true});console.log(result.stdout+result.stderr);if(result.status)process.exit(result.status);
const profiles=JSON.parse(fs.readFileSync('.local/minecraft-special/profiles.json')),catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));assert.equal(Object.keys(profiles).length,4);
for(const[path,p]of Object.entries(profiles)){
 const original=catalog.entries.find(x=>x.path===path);assert.equal(p.upstream_sha256,original.sha256);
 for(const variable of original.egg.variables)assert(p.egg.variables.some(v=>v.env_variable===variable.env_variable),'Lost original '+variable.env_variable);
 for(const name of['minecraft-special-runtime.py','native-config.py','limbo-install.py','native-release.py','native-zip-release.py','minecraft-special-install.py','minecraft-special-releases.json'])assert(p.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')),'Stale embedded '+name);
 if(path.includes('cuberite')||path.includes('mcgalaxy'))assert(!p.egg.features.length);else assert(p.egg.voltra.java_config.enabled);
 for(const rule of p.port_rules)assert(rule.exclude_primary&&rule.allocated_value);
}
console.log('Four exact Minecraft services preserve every original control and current shared helper sources.');
