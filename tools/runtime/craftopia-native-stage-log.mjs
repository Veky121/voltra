import fs from'node:fs';import assert from'node:assert/strict';import{createHash}from'node:crypto';
const d=process.argv[2]??'.local/craftopia-native-log';if(!/^\.local\/craftopia-native-log(?:-[a-z0-9]+)?$/.test(d))throw Error('Owned stage path');
const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),base='internal/panel/game_library/scripts/',runtime=fs.readFileSync(base+'crafting-runtime.py','utf8'),relay=fs.readFileSync(base+'native-log.py','utf8'),out={};
fs.mkdirSync(d,{recursive:true});fs.writeFileSync(d+'/crafting-runtime.py',runtime);fs.writeFileSync(d+'/native-log.py',relay);
for(const key of ['craftopia/egg-craftopia.json','cubic_odyssey/egg-cubic-odyssey.json','romestead/egg-romestead.json']){
 const p=structuredClone(canonical[key]),before=structuredClone(p),re=/(cat > \.voltra\/crafting_runtime\.py <<'([^']+)'\r?\n)([\s\S]*?)(\r?\n\2)/;assert(re.test(p.egg.scripts.installation.script));
 p.egg.scripts.installation.script=p.egg.scripts.installation.script.replace(re,(_,head,delimiter,body,tail)=>head+runtime+tail);
 if(key==='craftopia/egg-craftopia.json'){
  assert(!p.egg.scripts.installation.script.includes('cat > .voltra/native_log.py'));
  const marker='python3 .voltra/bundle_debian_python.py';assert.equal(p.egg.scripts.installation.script.split(marker).length,2);
  p.egg.scripts.installation.script=p.egg.scripts.installation.script.replace(marker,"cat > .voltra/native_log.py <<'VOLTRA_CRAFTOPIA_NATIVE_LOG'\n"+relay+'\nVOLTRA_CRAFTOPIA_NATIVE_LOG\n'+marker);
 }
 const check=structuredClone(p);check.egg.scripts.installation.script=before.egg.scripts.installation.script;assert.deepEqual(check,before);
 assert.equal(p.egg.scripts.installation.script.includes('cat > .voltra/native_log.py'),key==='craftopia/egg-craftopia.json');out[key]=p;
}
fs.writeFileSync(d+'/profiles.json',JSON.stringify(out,null,2)+'\n');const hash=b=>createHash('sha256').update(b).digest('hex');
console.log({stage:d+'/profiles.json',stage_sha256:hash(fs.readFileSync(d+'/profiles.json')),runtime_sha256:hash(runtime),relay_sha256:hash(relay),all_other_metadata_unchanged:true});
