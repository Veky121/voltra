import fs from 'node:fs';
import crypto from 'node:crypto';
const recipe='return_to_moria/egg-the-lord-of-the-rings--return-to-moria.json';
const dir='artifacts/game-parity-20261029/moria-owner';
const base='internal/panel/game_library/scripts/';
const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const fallback=JSON.parse(fs.readFileSync('.local/fantasy-survival-servers/profiles.json'));
const profile=structuredClone(canonical[recipe] || fallback[recipe]);
if(!profile?.egg)throw Error('Missing Moria profile');
const egg=profile.egg;
let script=egg.scripts.installation.script;
script=script.replace('apt-get update', 'if [ "${ACCEPT_WINDOWS_RUNTIME_LICENSES:-false}" != "true" ]; then\n  echo "Explicit Microsoft runtime licence acknowledgement required before installation" >&2\n  exit 1\nfi\napt-get update');
const hashes={};
// Refresh every existing embedded source from the current checkout, without running
// any multi-game stager or mutating the canonical override.
script=script.replace(/cat > \.voltra\/([^\s]+) <<'VOLTRA_SOURCE'\n[\s\S]*?\nVOLTRA_SOURCE\n/g,(block,target)=>{
 const candidates=[target,target.replaceAll('_','-')];
 const source=candidates.find(name=>fs.existsSync(base+name));
 if(!source)throw Error('Cannot refresh embedded source '+target);
 const content=fs.readFileSync(base+source,'utf8');
 hashes[source]=crypto.createHash('sha256').update(content).digest('hex');
 return `cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${content}\nVOLTRA_SOURCE\n`;
});
const wrapper=fs.readFileSync(base+'moria-native.py','utf8');
hashes['moria-native.py']=crypto.createHash('sha256').update(wrapper).digest('hex');
script=script.replace('python3 .voltra/fantasy_survival_servers.py install moria',`cat > .voltra/moria-native.py <<'VOLTRA_MORIA'\n${wrapper}\nVOLTRA_MORIA\npython3 .voltra/moria-native.py install`);
if(!script.includes('VOLTRA_MORIA'))throw Error('Moria installation entrypoint not found');
egg.scripts.installation.script=script;
egg.startup=egg.startup.replace('.voltra/fantasy_survival_servers.py run moria','.voltra/moria-native.py run');
profile.revision='moria-native-authority-20261030';
profile.verification='not_verified';
profile.detail='Source-only Moria preflight and seed-once settings; native acceptance blocked on served integration and explicit runtime licence acknowledgement. Existing readiness quarantine retained.';
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/profile.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync(dir+'/embedded-hashes.json',JSON.stringify(hashes,null,2)+'\n');
console.log(JSON.stringify({recipe,output:dir+'/profile.json',embedded_sources:Object.keys(hashes).length,sha256:crypto.createHash('sha256').update(fs.readFileSync(dir+'/profile.json')).digest('hex')}));
