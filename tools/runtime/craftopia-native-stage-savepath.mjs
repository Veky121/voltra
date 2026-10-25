import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash}from'node:crypto';
const dir='.local/craftopia-native-savepath',profiles=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),raw=fs.readFileSync('internal/panel/game_library/scripts/crafting-runtime.py','utf8'),out={};
fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/crafting-runtime.py',raw);
for(const key of ['craftopia/egg-craftopia.json','cubic_odyssey/egg-cubic-odyssey.json','romestead/egg-romestead.json']){
 const p=structuredClone(profiles[key]),before=structuredClone(p),re=/(cat > \.voltra\/crafting_runtime\.py <<'([^']+)'\r?\n)([\s\S]*?)(\r?\n\2)/;
 assert(re.test(p.egg.scripts.installation.script));p.egg.scripts.installation.script=p.egg.scripts.installation.script.replace(re,(_,head,delimiter,body,tail)=>head+raw+tail);
 const check=structuredClone(p);check.egg.scripts.installation.script=before.egg.scripts.installation.script;assert.deepEqual(check,before);out[key]=p;
}
fs.writeFileSync(dir+'/profiles.json',JSON.stringify(out,null,2)+'\n');
console.log({stage:dir+'/profiles.json',profiles:Object.keys(out),raw_sha256:createHash('sha256').update(raw).digest('hex'),stage_sha256:createHash('sha256').update(fs.readFileSync(dir+'/profiles.json')).digest('hex'),metadata_unchanged:true});
