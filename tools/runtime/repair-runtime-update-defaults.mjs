// Stage an additive control for reviewed adapters whose daemon transform
// requires AUTO_UPDATE. Does not change any existing upstream variable.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {ensureRuntimeUpdateControl} from './runtime-update-control.mjs';
const profiles=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const reviewed=[
 'aloft/egg-aloft.json',
 'empyrion/egg-empyrion--galactic-survival.json',
 'space_engineers/torch/egg-space-engineers--torch-server.json',
 'subnautica_nitrox_mod/egg-subnautica.json',
];
const staged={};
for(const path of reviewed){
 const original=profiles[path];assert(original.egg.features.includes('voltra_steam_template'));
 if(original.egg.variables.some(v=>v.env_variable==='AUTO_UPDATE'))continue;
 const profile=structuredClone(original);
 ensureRuntimeUpdateControl(profile.egg);
 assert.deepEqual(profile.egg.variables.slice(0,-1),original.egg.variables);
 staged[path]=profile;
}
fs.mkdirSync('.local/runtime-defaults',{recursive:true});
fs.writeFileSync('.local/runtime-defaults/profiles.json',JSON.stringify(staged,null,2)+'\n');
console.log(JSON.stringify({staged:Object.keys(staged),scope:'Additive AUTO_UPDATE control only; all original metadata and verification retained.'},null,2));
