import fs from 'node:fs';import assert from 'node:assert/strict';import {refreshHelpers} from './refresh-profile-helpers.mjs';
const recipe='astroneer/egg-astroneer-dedicated-server.json';const old=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
assert(old.setup_validation?.some(r=>r.environment==='PUBLIC_IP'&&r.type==='public_ipv4'));
const sources=new Map(['astroneer-parity','astroneer-rcon','native-console'].map(n=>[n.replaceAll('-','_'),fs.readFileSync(`internal/panel/game_library/scripts/${n}.py`,'utf8')]));
const result=refreshHelpers({[recipe]:old},sources);assert.deepEqual(result.profiles[recipe].egg.variables,old.egg.variables);
fs.writeFileSync('artifacts/game-parity-20261029/astroneer-resume-wave1-profile.json',JSON.stringify(result.profiles,null,2)+'\n');
console.log(JSON.stringify({profile:recipe,metadata_present:true,refresh_changes:result.changes}));
