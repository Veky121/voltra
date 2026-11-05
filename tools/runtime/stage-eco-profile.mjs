import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const key='eco/egg-eco.json';
const scripts='internal/panel/game_library/scripts';
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
export function stageEco(canonical, readSource){
  const profile=structuredClone(canonical);
  const hashes={};
  let count=0;
  profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace(
    /cat > \.voltra\/([\w.-]+) <<'([A-Z_]+)'\r?\n[\s\S]*?\r?\n\2(?=\r?\n|$)/g,
    (_,name,delimiter)=>{
      const sourceName=name==='steam_template.py'?'steam-template.py':name;
      const source=readSource(sourceName).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
      assert.ok(!source.split('\n').includes(delimiter),'Unsafe heredoc delimiter');
      hashes[sourceName]=digest(source);
      count++;
      return `cat > .voltra/${name} <<'${delimiter}'\n${source.replace(/\n$/,'')}\n${delimiter}`;
    });
  assert.ok(count>=8,'Missing canonical helper heredocs');
  const helper=readSource('eco-runtime.py').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  if(!hashes['eco-runtime.py']){
    assert.ok(profile.egg.scripts.installation.script.includes('python3 .voltra/automation-sims.py install eco'));
    profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace('python3 .voltra/automation-sims.py install eco',`cat > .voltra/eco-runtime.py <<'VOLTRA_ECO_SOURCE'\n${helper.replace(/\n$/,'')}\nVOLTRA_ECO_SOURCE\npython3 .voltra/eco-runtime.py install`);
    hashes['eco-runtime.py']=digest(helper);
  }
  profile.egg.startup=profile.egg.startup.replace('automation-sims.py run eco','eco-runtime.py run');
  assert.ok(profile.egg.startup.includes('eco-runtime.py run'));
  assert.equal(profile.egg.config.files,'{}');
  assert.equal(profile.egg.config.stop,'^SIGTERM');
  assert.deepEqual(profile.egg.variables,canonical.egg.variables,'Canonical controls/defaults/permissions must not drift');
  profile.revision='eco-native-authority-v4';
  profile.verification='not_verified';
  profile.detail='Current helper sources embedded and hashed; Eco storage restore and native authority fixtures tested. Candidate native behavior requires matching served identity.';
  return {profile,hashes};
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const raw=fs.readFileSync('internal/panel/game_library/overrides.json');
  const canonical=JSON.parse(raw)[key];
  const {profile,hashes}=stageEco(canonical,name=>fs.readFileSync(`${scripts}/${name}`,'utf8'));
  const out='artifacts/game-parity-20261029/eco-resume-unblocked';
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(`${out}/eco-profile.json`,JSON.stringify({[key]:profile},null,2)+'\n');
  fs.writeFileSync(`${out}/source-receipt.json`,JSON.stringify({recipe:key,canonical_sha256:digest(raw),canonical_revision:canonical.revision,candidate_revision:profile.revision,defaults:profile.defaults,helpers_normalized_sha256:hashes,controls:profile.egg.variables,settings_documents:profile.settings_documents},null,2)+'\n');
  console.log(`Staged ${key}, ${Object.keys(hashes).length} current helpers; canonical files unchanged.`);
}
