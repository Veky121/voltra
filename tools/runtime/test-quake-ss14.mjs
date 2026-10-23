import {spawnSync} from 'node:child_process';import path from 'node:path';import fs from 'node:fs';import assert from 'node:assert/strict';
const r=spawnSync('docker',['run','--rm','--network','none','--cap-drop','ALL','--mount',`type=bind,source=${path.resolve('.')},target=/repo,readonly`,'python:3.13-slim','python3','-B','/repo/tools/runtime/test-quake-ss14.py'],{stdio:'inherit',windowsHide:true});process.exitCode=r.status??1;
if(r.status===0){
 const generated=spawnSync(process.execPath,['tools/runtime/sync-quake-ss14-profiles.mjs'],{stdio:'inherit'});if(generated.status)throw Error('Stage generation failed');
 const profiles=JSON.parse(fs.readFileSync('.local/quake-ss14/profiles.json')),catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
 for(const [recipe,profile]of Object.entries(profiles)){
  const original=catalog.entries.find(x=>x.path===recipe);assert.equal(profile.upstream_sha256,original.sha256);
  for(const variable of original.egg.variables)assert(profile.egg.variables.some(x=>x.env_variable===variable.env_variable),'Original control lost: '+variable.env_variable);
  for(const helper of ['quake-ss14-runtime','quake-ss14-query','quake-ss14-install','source-install','steam-template','native-console','native-release','native-zip-release','bundle-debian-python'])assert(profile.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/scripts/'+helper+'.py','utf8')),'Stale embedded helper '+helper);
 }
 assert.deepEqual(profiles['spacestation_14/egg-spacestation14.json'].platforms,['linux/amd64','linux/arm64']);console.log('Both original control sets, architecture metadata and current source embeddings match.');
}
