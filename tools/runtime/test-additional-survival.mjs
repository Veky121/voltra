import fs from'node:fs';import{spawnSync}from'node:child_process';import assert from'node:assert/strict';
const profiles=JSON.parse(fs.readFileSync('.local/additional-survival/profiles.json'));
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
for(const[key,profile]of Object.entries(profiles)){
 const entry=catalog.entries.find(e=>e.path===key);assert.equal(profile.upstream_sha256,entry.sha256);
 for(const variable of entry.egg.variables)assert(profile.egg.variables.some(v=>v.env_variable===variable.env_variable),'Missing original '+variable.env_variable);
 for(const feature of entry.egg.features||[])assert(profile.egg.features.includes(feature),'Missing original feature '+feature);
 for(const file of ['steam-template.py','bundle-debian-python.py','native-config.py','additional-survival-install.py',key.startsWith('barotrauma/')?'barotrauma-runtime.py':'enshrouded-runtime.py',key.startsWith('barotrauma/')?'native-console.py':'enshrouded-proton.py'])assert(profile.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/scripts/'+file,'utf8')),'Stale embedded '+file);
}
const root=process.cwd().replaceAll('\\','/');
const result=spawnSync('docker',['run','--rm','-i','--network','none','--memory','192m','--cpus','1','-e','PYTHONDONTWRITEBYTECODE=1','--mount',`type=bind,source=${root}/internal/panel/game_library/scripts,target=/source,readonly`,'python:3.13-slim','python3','-'],{input:fs.readFileSync('tools/runtime/test-additional-survival.py','utf8'),encoding:'utf8',timeout:60000});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error)throw result.error;process.exitCode=result.status??1;
