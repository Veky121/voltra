import fs from 'node:fs';
const recipe='gta/gtac/egg-grand-theft-auto-connected.json';
const profile=structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
let script=profile.egg.scripts.installation.script;
for(const name of ['gtac-install.py','gtac-runtime.py']) {
  const start=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n`;
  const offset=script.indexOf(start),end=script.indexOf('\nVOLTRA_SOURCE',offset+start.length);
  if(offset<0||end<0)throw Error('Missing canonical emission '+name);
  script=script.slice(0,offset+start.length)+fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8').trimEnd()+script.slice(end);
}
if(!script.includes('python3 .voltra/bundle-debian-python.py'))throw Error('Missing Python bundle boundary');
script=script.replace('python3 .voltra/bundle-debian-python.py','python3 .voltra/gtac-install.py --preflight\npython3 .voltra/bundle-debian-python.py');
profile.egg.scripts.installation.script=script;
profile.revision='gtac-wave45-source-only';profile.verification='not_verified';
profile.detail='Source-only installer preflight and missing-only legacy migration; current native acceptance pending.';
const out='artifacts/game-parity-20261029/wave45-gtac';fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/profile.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
console.log('Staged unapplied GTAC profile');
