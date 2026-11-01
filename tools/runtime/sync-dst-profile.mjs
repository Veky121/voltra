// Refresh only the exact DST script bodies; preserve every profile field.
import fs from 'node:fs';
const file='internal/panel/game_library/overrides.json';
const profiles=JSON.parse(fs.readFileSync(file,'utf8'));
const profile=profiles['dont_starve/egg-don-t-starve-together.json'];
let script=profile.egg.scripts.installation.script.replaceAll('\r\n','\n');
for (const [source,target] of [['dst-config.py','dst_config.py'],['dst-install.py','dst_install.py'],['dst-runtime.py','dst_runtime.py']]) {
 const start=`cat > .voltra/${target} <<'VOLTRA_SOURCE'\n`;
 const offset=script.indexOf(start);
 if(offset<0)throw new Error('Missing emitted helper '+target);
 const end=script.indexOf('\nVOLTRA_SOURCE',offset+start.length);
 if(end<0)throw new Error('Missing heredoc terminator '+target);
 script=script.slice(0,offset+start.length)+fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8').replaceAll('\r\n','\n').trimEnd()+'\n'+script.slice(end);
}
const preflight="PYTHONPATH=.voltra python3 -c \"from pathlib import Path; import os; from dst_config import configure; from dst_install import worldgen; configure(Path.cwd(), os.environ, dry_run=True); worldgen(Path.cwd(), os.environ, dry_run=True)\"\n";
if(!script.includes(preflight)) {
 const bundle='python3 .voltra/bundle_debian_python.py\n';
 if(!script.includes(bundle))throw new Error('Missing bundle boundary');
 script=script.replace(bundle,preflight+bundle);
}
profile.egg.scripts.installation.script=script;
const output=JSON.stringify(profiles,null,2)+'\n';
if(fs.readFileSync(file,'utf8')!==output)fs.writeFileSync(file,output);
console.log('DST scripts refreshed; metadata preserved');
