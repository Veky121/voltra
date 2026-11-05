import fs from 'node:fs';
import crypto from 'node:crypto';
const recipe='portal_knights/egg-portal-knights.json';
const base='internal/panel/game_library/scripts/';
const out='artifacts/game-parity-20261029/portal-knights-owner-next';
const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profile=structuredClone(canonical[recipe]);
const original=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===recipe).egg;
// Original ordered controls, including credential requirements, remain exact.
profile.egg.variables=[...structuredClone(original.variables),...profile.egg.variables.filter(v=>!original.variables.some(o=>o.env_variable===v.env_variable))];
const hashes={};
let script=profile.egg.scripts.installation.script.replace(/cat > \.voltra\/([^\s]+) <<'VOLTRA_FANTASY_SOURCE'\n[\s\S]*?\nVOLTRA_FANTASY_SOURCE\n/g,(_,name)=>{
 const source=name.replaceAll('_','-');
 const bytes=fs.readFileSync(base+source); hashes[base+source]=crypto.createHash('sha256').update(bytes).digest('hex');
 return `cat > .voltra/${name} <<'VOLTRA_FANTASY_SOURCE'\n${bytes.toString()}\nVOLTRA_FANTASY_SOURCE\n`;
});
const helper=fs.readFileSync(base+'portal-knights-owner-next.py','utf8');
const embed=`cat > .voltra/portal_knights_owner_next.py <<'VOLTRA_PORTAL_NEXT'\n${helper}\nVOLTRA_PORTAL_NEXT\npython3 .voltra/portal_knights_owner_next.py --preflight\n`;
script=script.replace('export DEBIAN_FRONTEND=noninteractive\n',embed+'export DEBIAN_FRONTEND=noninteractive\n');
profile.egg.scripts.installation.script=script;
profile.egg.startup='exec python3 .voltra/portal_knights_owner_next.py';
profile.revision='portal-knights-owner-next-native-authority-v1';
profile.verification='not_verified';
profile.detail='Pending source-only Portal adapter. Native JSON is authoritative after initial seed. Allocation/bind/private-console mismatches refuse before update. Original credential rules remain unchanged; uploaded-mode UI prerequisite integration remains pending. Resources remain provisional.';
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/profile.pending.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync(out+'/shared-input-hashes.json',JSON.stringify(hashes,null,2)+'\n');
console.log('Staged exact Portal profile; canonical overrides unchanged.');
