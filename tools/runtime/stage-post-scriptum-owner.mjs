import fs from 'node:fs';
const recipe='post_scriptum/egg-post-scriptum.json';
const dir='artifacts/game-parity-20261029/post-scriptum-owner-next';
const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const original=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===recipe);
const profile=structuredClone(canonical[recipe]);
const helper=fs.readFileSync('internal/panel/game_library/scripts/post-scriptum-owner-runtime.py','utf8');
// Embed only this variant's helper, leaving every existing shared body unchanged.
profile.egg.scripts.installation.script += `\ncat > .voltra/post_scriptum_owner_runtime.py <<'VOLTRA_POST_SCRIPTUM_OWNER'\n${helper}\nVOLTRA_POST_SCRIPTUM_OWNER\n`;
profile.egg.startup=profile.egg.startup.replace('.voltra/tactical_runtime.py','.voltra/post_scriptum_owner_runtime.py');
const originals=new Set(original.egg.variables.map(v=>v.env_variable));
profile.egg.variables=[...structuredClone(original.egg.variables),...profile.egg.variables.filter(v=>!originals.has(v.env_variable))];
profile.revision='post-scriptum-native-authority-source-v1';
profile.setup_steps[1]='Server.cfg is native authority. Existing keys, duplicate rows and comments remain byte-for-byte; environment controls seed missing keys only. Runtime settings and allocations still own launch arguments. Native settings dispatcher integration is pending root review.';
profile.detail='Source-only native config retention and runtime preflight; no native acceptance or activation.';
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(`${dir}/profile-fragment.json`,JSON.stringify({[recipe]:profile},null,2)+'\n');
if(JSON.stringify(profile.egg.variables.slice(0,original.egg.variables.length))!==JSON.stringify(original.egg.variables))throw Error('Original controls changed');
console.log('Staged exact Post Scriptum fragment; original ordered variables/defaults/permissions preserved.');
