import fs from 'node:fs';
import crypto from 'node:crypto';
const key='svencoop/egg-sven-co-op.json';
const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[key];
const profile=structuredClone(canonical);
let script=profile.egg.scripts.installation.script;
const file='internal/panel/game_library/scripts/source-third-runtime.py';
const marker="cat > .voltra/source_third_runtime.py <<'VOLTRA_SOURCE'\n";
const start=script.indexOf(marker),end=script.indexOf('\nVOLTRA_SOURCE\n',start+marker.length);
if(start<0||end<0)throw Error('Missing exact Sven helper boundary');
const source=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
profile.egg.scripts.installation.script=script.slice(0,start)+marker+source+'\nVOLTRA_SOURCE\n'+script.slice(end+'\nVOLTRA_SOURCE\n'.length);
for(const v of profile.egg.variables){
 if(v.env_variable==='SC_NAME')v.rules=v.rules.replace('max:128','max:40');
 if(v.env_variable==='SC_PASSWORD')v.rules=v.rules.replace('max:128','max:20');
}
// Assert the staged diff contains only the assigned helper and two bounds.
const expected=structuredClone(profile);
expected.egg.scripts.installation.script=canonical.egg.scripts.installation.script;
for(const v of expected.egg.variables)if(['SC_NAME','SC_PASSWORD'].includes(v.env_variable))v.rules=canonical.egg.variables.find(x=>x.env_variable===v.env_variable).rules;
if(JSON.stringify(expected)!==JSON.stringify(canonical))throw Error('Unowned metadata changed');
const out='artifacts/game-parity-20261029/wave37-svencoop-repair';fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/profiles.json',JSON.stringify({[key]:profile},null,2)+'\n');
console.log('Staged exact Sven fragment; canonical overrides untouched. helper sha256 '+crypto.createHash('sha256').update(source).digest('hex'));
