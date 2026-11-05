import fs from 'node:fs';
const out='artifacts/game-parity-20261029/resonite-owner';
fs.mkdirSync(out,{recursive:true});
const recipe='resonite/egg-resonite.json';
const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profile=structuredClone(canonical[recipe]);
if(!profile?.egg)throw Error('Missing canonical Resonite profile');
profile.revision='resonite-owner-source-v2';
profile.verification='not_verified';
profile.egg.startup='exec python3 .voltra/resonite_owner.py runtime';
profile.egg.config.startup=JSON.stringify({done:'World Running'});
let script='#!/bin/bash\nset -euo pipefail\ncd /mnt/server\n';
// All code is emitted into a temporary directory first. Preflight runs before
// writing runtime helpers to the volume; acquisition remains unavailable.
script+='stage=$(mktemp -d)\ntrap \'rm -rf -- "$stage"\' EXIT\n';
const sources=['resonite-owner.py','steam-template.py','native-console.py','virtual-worlds-runtime.py','virtual-worlds-install.py','virtual-worlds-releases.json'];
for(const source of sources){
 const filename=source.replaceAll('-','_');
 script+=`cat > "$stage/${filename}" <<'VOLTRA_RESONITE_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_RESONITE_SOURCE\n`;
}
script+='python3 "$stage/resonite_owner.py" install\n';
profile.egg.scripts.installation.script=script;
profile.detail='Source candidate only. Installer refuses before acquisition or volume writes; private transport unavailable. Existing operator payload runtime uses shared supervisor after Resonite preflight. No native acceptance.';
fs.writeFileSync(out+'/profile.pending.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync(out+'/packaging.json',JSON.stringify({sources: sources.map(source=>({source:'internal/panel/game_library/scripts/'+source,emitted:source.replaceAll('-','_')}))},null,2)+'\n');
console.log('Staged Resonite only; canonical controls preserved.');
