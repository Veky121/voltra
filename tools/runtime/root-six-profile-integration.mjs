import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const dir='artifacts/game-parity-20261029/root-six-profile-integration';
fs.mkdirSync(dir,{recursive:true});
const target='internal/panel/game_library/overrides.json';
const original=fs.readFileSync(target), before=JSON.parse(original);
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries;
const inputs=['hytale-layout/fragment.json','brickadia-wave3-profile.json','iw4x-owner/profile.json','icarus-owner-20261030/profile.json','dayz-resume-profile.json','assetto-ai-owner-20261030/profile.json'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const merged=structuredClone(before), receipts=[];
for(const input of inputs){
 const file='artifacts/game-parity-20261029/'+input, bytes=fs.readFileSync(file);
 for(const [recipe,p] of Object.entries(JSON.parse(bytes))){
  const upstream=catalog.find(e=>e.path===recipe);assert.equal(p.upstream_sha256,upstream.sha256);
  // Existing accepted adapters may already have conditional validation rules.
  // Require an exact complete existing array or the original ordered prefix.
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  assert(equal(p.egg.variables,before[recipe].egg.variables)||equal(p.egg.variables.slice(0,upstream.egg.variables.length),upstream.egg.variables),'Ordered controls changed: '+recipe);
  const embedded=[];
  for(const m of p.egg.scripts.installation.script.matchAll(/cat > \.voltra\/([\w_.-]+) <<'(VOLTRA_[A-Z0-9_]+)'\n([\s\S]*?)\n\2/g)){
   if(m[2].includes('LICENSE'))continue;
   const alias={'brickadia_parity_wave3.py':'brickadia-file-authority.py','unreal_building_release.json':'unreal-building-release.json'};
   const candidates=[alias[m[1]]||m[1],m[1].replaceAll('_','-')].map(n=>'internal/panel/game_library/scripts/'+n);
   const source=candidates.find(f=>fs.existsSync(f));assert(source,'Unknown embedded helper '+m[1]);
   const current=fs.readFileSync(source,'utf8');
   assert.equal(m[3].replaceAll('\r\n','\n').trimEnd(),current.replaceAll('\r\n','\n').trimEnd(),'Stale helper '+recipe+': '+source);
   embedded.push({path:source,sha256:hash(fs.readFileSync(source))});
  }
  assert(embedded.length>0,'No verified embeds');
  if(recipe==='hytale/egg-hytale.json'){
   p.settings_documents=['Server/config.json'];
  }
  if(p.settings_documents&&!Array.isArray(p.settings_documents))p.settings_documents=Object.keys(p.settings_documents).map(k=>k.replace(/^\//,'')).sort();
  receipts.push({recipe,input:file,input_sha256:hash(bytes),previous_revision:before[recipe].revision,revision:p.revision,embedded,ordered_controls:'pass'});
  merged[recipe]=p;
 }
}
const allowed=new Set(receipts.map(r=>r.recipe));
for(const key of Object.keys(before))if(!allowed.has(key))assert.deepEqual(merged[key],before[key]);
fs.writeFileSync(dir+'/before.json',original,{flag:'wx'});
fs.writeFileSync(dir+'/verification.json',JSON.stringify({source_only:true,receipts,unrelated_profiles_unchanged:Object.keys(before).length-allowed.size,asa_adopted:false},null,2)+'\n');
assert(fs.readFileSync(target).equals(original),'Concurrent override mutation');
fs.writeFileSync(target+'.six.tmp',JSON.stringify(merged,null,2)+'\n',{flag:'wx'});
fs.renameSync(target+'.six.tmp',target);
console.log(JSON.stringify({integrated:receipts.map(r=>r.recipe),unrelated_profiles_unchanged:Object.keys(before).length-allowed.size}));

