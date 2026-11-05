import fs from 'node:fs';
import crypto from 'node:crypto';
const recipe='novalife_amboise/egg-nova--life--amboise.json';
const out='artifacts/game-parity-20261029/novalife-owner-next';
const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profiles=canonical.profiles ?? canonical;
const profile=structuredClone(profiles[recipe]);
if(!profile?.egg) throw Error('Exact integrated profile missing');
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const original=catalog.entries.find(e=>e.path===recipe);
if(JSON.stringify(profile.egg.variables.slice(0,original.egg.variables.length))!==JSON.stringify(original.egg.variables)) throw Error('Original ordered controls drifted');
const base='internal/panel/game_library/scripts/';
const sources=['steam-template.py','native-config.py','native-console.py','fantasy-worlds-runtime.py','fantasy-worlds-install.py','fantasy-worlds-wine.py','fantasy-worlds-wine-build.py','sandbox-servers.py','sandbox-servers-release.py','sandbox-servers-defaults.json','novalife-owner-next.py'];
const hashes={};
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
for(const file of sources){const bytes=fs.readFileSync(base+file);hashes[base+file]=crypto.createHash('sha256').update(bytes).digest('hex');script+=`cat > .voltra/${file.replaceAll('-','_')} <<'VOLTRA_NOVA_SOURCE'\n${bytes.toString('utf8')}\nVOLTRA_NOVA_SOURCE\n`;}
script+='python3 .voltra/novalife_owner_next.py nova install\n';
profile.egg.scripts.installation.script=script;
profile.egg.startup='exec python3 .voltra/novalife_owner_next.py nova run';
profile.revision='novalife-owner-next-native-authority-v1';
profile.verification='not_verified';
profile.detail='Pending source-only Nova-specific native-file authority and strict update preflight. Native readiness, save/stop and current publisher acquisition remain unverified. Existing resource defaults remain provisional.';
profile.setup_steps.push('Existing Servers/<SERVER_NAME>/Config/server.json owns list name, slots and native settings. Original environment defaults seed missing files only. Native ports must agree with selected allocations; conflicts refuse before updates. Unity logs use stdout.');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/profile.pending.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync(out+'/source-hashes.json',JSON.stringify(hashes,null,2)+'\n');
console.log('Staged exactly '+recipe+'; canonical overrides unchanged.');

