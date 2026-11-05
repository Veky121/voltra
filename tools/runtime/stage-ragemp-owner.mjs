import fs from 'node:fs';
import crypto from 'node:crypto';
const recipe='gta/ragemp/egg-rage--m-p.json';
const original=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
const profile=structuredClone(original);
profile.revision='ragemp-strict-preservation-v2';
profile.verification='not_verified';
profile.detail='RageMP-only strict preflight and preservation fixtures; current publisher authorization and served native acceptance blocked.';
profile.egg.startup=profile.egg.startup.replace('.voltra/gta-legacy-runtime.py ragemp','.voltra/ragemp-runtime.py');
let script=profile.egg.scripts.installation.script;
const hashes={};
// Refresh every existing helper embed from current source; never restage another recipe.
script=script.replace(/cat > \.voltra\/([^ ]+) <<'VOLTRA_SOURCE'\n[\s\S]*?\nVOLTRA_SOURCE\n/g,(old,name)=>{
 const source=name==='steam_template.py'?'steam-template.py':name;
 const bytes=fs.readFileSync('internal/panel/game_library/scripts/'+source);
 hashes[source]=crypto.createHash('sha256').update(bytes).digest('hex');
 return `cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${bytes.toString()}\nVOLTRA_SOURCE\n`;
});
for(const name of ['ragemp-runtime.py','ragemp-install.py']){
 const bytes=fs.readFileSync('internal/panel/game_library/scripts/'+name);
 hashes[name]=crypto.createHash('sha256').update(bytes).digest('hex');
 script=script.replace('python3 .voltra/bundle-debian-python.py',`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${bytes.toString()}\nVOLTRA_SOURCE\npython3 .voltra/bundle-debian-python.py`);
}
script=script.replace('python3 .voltra/gta-legacy-install.py ragemp','python3 .voltra/ragemp-install.py');
profile.egg.scripts.installation.script=script;
profile.setup_steps.push('Game listener uses TCP and UDP; game port+1 uses TCP for client packages. Current publisher authorization is a prerequisite. Existing non-binary files remain operator-owned across archive installs. Shared settings parser integration remains pending; no new writable UI is claimed.');
const dir='artifacts/game-parity-20261029/ragemp-owner';fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/profile.pending.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync(dir+'/helper-hashes.json',JSON.stringify(hashes,null,2)+'\n');
console.log('Staged only '+recipe);
