import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const image=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{encoding:'utf8'});
if(image.status)throw Error('Existing offline Python helper image required');
const result=spawnSync('docker',['run','--rm','--network','none','--memory','256m','--mount',`type=bind,source=${path.resolve('.')},target=/workspace,readonly`,'-w','/workspace',image.stdout.trim(),'python3','-B','tools/runtime/test-strategy-survival.py'],{encoding:'utf8'});
console.log(result.stdout+result.stderr);if(result.status)process.exit(result.status);
const profiles=JSON.parse(fs.readFileSync('.local/strategy-survival-games/profiles.json'));
for(const [recipe,profile]of Object.entries(profiles)){
 const game=recipe.split('/')[0],sources=['steam-template.py','bundle-debian-python.py','additional-survival-install.py','native-console.py','strategy-survival-install.py',game+'-runtime.py',...(game==='cryofall'?['native-release.py','among-us-install.py']:['private-nss.py'])];
 for(const source of sources)assert(profile.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')),recipe+' stale '+source);
}
console.log('Both profiles preserve original variables, root verification and current embedded sources.');
