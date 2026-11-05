import fs from 'node:fs';
import crypto from 'node:crypto';
const dir='artifacts/game-parity-20261029/resume-wave4-hytale',base='internal/panel/game_library/scripts/';
fs.mkdirSync(dir,{recursive:true});
const recipe='hytale/egg-hytale.json',profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
const hashes={};
let script=profile.egg.scripts.installation.script;
script=script.replace(/cat > \.voltra\/([\w_]+\.py) <<'VOLTRA_SOURCE'\n[\s\S]*?\nVOLTRA_SOURCE\n/g,(match,name)=>{
 const file=name.replaceAll('_','-'),bytes=fs.readFileSync(base+file);hashes[base+file]=crypto.createHash('sha256').update(bytes).digest('hex');
 return `cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${bytes.toString()}\nVOLTRA_SOURCE\n`;
});
const wrapper=fs.readFileSync(base+'hytale-runtime.py');hashes[base+'hytale-runtime.py']=crypto.createHash('sha256').update(wrapper).digest('hex');
script=script.replace('python3 .voltra/bundle_debian_python.py',`cat > .voltra/hytale_runtime.py <<'VOLTRA_SOURCE'\n${wrapper.toString()}\nVOLTRA_SOURCE\npython3 .voltra/bundle_debian_python.py`);
profile.egg.scripts.installation.script=script;
profile.egg.startup=profile.egg.startup.replace('.voltra/publisher_runtime.py','.voltra/hytale_runtime.py');
profile.revision='hytale-resume-wave4-preflight-v1';
fs.writeFileSync(dir+'/fragment.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync(dir+'/helper-hashes.json',JSON.stringify(hashes,null,2)+'\n');
console.log('Staged exact Hytale fragment. Canonical profiles unchanged.');
