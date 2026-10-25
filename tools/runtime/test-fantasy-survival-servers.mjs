import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const image=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{encoding:'utf8',windowsHide:true});if(image.status)throw Error('Existing offline Python image required');
const p=spawnSync('docker',['run','--rm','--network','none','--memory','256m','--mount',`type=bind,source=${path.resolve('.')},target=/workspace,readonly`,'-w','/workspace',image.stdout.trim(),'python3','-B','tools/runtime/test-fantasy-survival-servers.py'],{encoding:'utf8',windowsHide:true});console.log(p.stdout+p.stderr);if(p.status)process.exit(p.status);
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),profiles=JSON.parse(fs.readFileSync('.local/fantasy-survival-servers/profiles.json'));
assert.equal(Object.keys(profiles).length,3);
for(const[recipe,profile]of Object.entries(profiles)){
 const original=catalog.entries.find(e=>e.path===recipe).egg;
 for(const variable of original.variables){const next=profile.egg.variables.find(v=>v.env_variable===variable.env_variable);assert(next,'Missing '+variable.env_variable);for(const key of ['default_value','rules','user_viewable','user_editable'])assert.deepEqual(next[key],variable[key],recipe+' '+variable.env_variable+' '+key);}
 assert.equal(profile.verification,'not_verified');assert.equal(profile.egg.config.stop,'^C');assert.equal(profile.required_ports,1);
 for(const file of ['steam-template.py','native-console.py','native-config.py','fantasy-survival-servers.py'])assert(profile.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/scripts/'+file,'utf8')),'Stale helper '+file);
 if(recipe.startsWith('smalland'))for(const key of ['DeploymentId','DedicatedServerClientId','DedicatedServerClientSecret','DedicatedServerPrivateKey']){const field=profile.egg.variables.find(v=>v.env_variable==='SMALLAND_EOS_'+key);assert(field);assert.equal(field.user_viewable,false);assert.equal(field.user_editable,false);const expected=original.startup.match(new RegExp('-ini:Engine:\\[EpicOnlineServices\\]:'+key+'=([^\\s]*)'))[1];assert.equal(field.default_value,expected);}
}
console.log('Original values/visibility/rules, exact helpers and source-only status PASS; no native game proof.');
