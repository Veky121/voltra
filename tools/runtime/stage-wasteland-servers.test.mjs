import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {stageWastelandProfiles} from './stage-wasteland-servers.mjs';
const base='internal/panel/game_library/scripts/';
function fixture(){return {current:JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json','utf8')),bodies:Object.fromEntries(['wasteland-servers.py','wasteland-servers-pins.json'].map(n=>[n,fs.readFileSync(base+n,'utf8')])),pins:JSON.parse(fs.readFileSync(base+'wasteland-servers-pins.json','utf8')),terms:fs.readFileSync('artifacts/plains-of-pain-publisher-EULA.txt','utf8')};}
function strippedScript(script){for(const name of ['wasteland-servers.py','wasteland-servers-pins.json']){const start=script.indexOf("cat > .voltra/"+name+" <<'VOLTRA_WASTELAND_SERVERS_SOURCE'\n"),body=script.indexOf('\n',start)+1,end=script.indexOf('\nVOLTRA_WASTELAND_SERVERS_SOURCE\n',body);assert.ok(start>=0&&end>=body);script=script.slice(0,body)+'<OWNED_BODY>'+script.slice(end);}return script;}
test('pre- and post-integration profiles preserve metadata, other helpers and original controls',()=>{
 const f=fixture(),plain='plains_of_pain/egg-plains-of-pain.json',pre=structuredClone(f.current);
 pre[plain].egg.variables=pre[plain].egg.variables.filter(v=>v.env_variable!=='PLAINS_ACCEPT_EULA');
 pre[plain].agreements=(pre[plain].agreements||[]).filter(a=>a.environment!=='PLAINS_ACCEPT_EULA');if(!pre[plain].agreements.length)delete pre[plain].agreements;
 for(const current of [pre,f.current]){
  const before=JSON.stringify(current),staged=stageWastelandProfiles(current,f.bodies,f.pins,f.terms);assert.equal(Object.keys(staged).length,3);
  let originalControls=0;
  for(const[key,profile]of Object.entries(staged)){
   const old=current[key],copy=structuredClone(profile),expected=structuredClone(old);originalControls+=old.egg.variables.filter(v=>v.env_variable!=='PLAINS_ACCEPT_EULA').length;
   assert.ok(strippedScript(profile.egg.scripts.installation.script)===strippedScript(old.egg.scripts.installation.script),'Unowned helper or installer bytes changed: '+key);
   copy.egg.scripts.installation.script=old.egg.scripts.installation.script;
   if(key===plain){
    copy.egg.variables=copy.egg.variables.filter(v=>v.env_variable!=='PLAINS_ACCEPT_EULA');expected.egg.variables=expected.egg.variables.filter(v=>v.env_variable!=='PLAINS_ACCEPT_EULA');
    if(old.agreements===undefined)delete copy.agreements;else copy.agreements=old.agreements;
   }
   assert.ok(JSON.stringify(copy)===JSON.stringify(expected),'Unowned profile metadata or original control changed: '+key);
   for(const[name,body]of Object.entries(f.bodies))assert.ok(profile.egg.scripts.installation.script.includes(body.replaceAll('\r\n','\n')),'Owned helper missing: '+name);
  }
  assert.equal(originalControls,46);assert.ok(JSON.stringify(current)===before,'Input profiles mutated');
 }
});
test('Plains exact CRLF terms bind SHA control; idempotent refresh preserves additions',()=>{
 const f=fixture(),staged=stageWastelandProfiles(f.current,f.bodies,f.pins,f.terms),key='plains_of_pain/egg-plains-of-pain.json',profile=staged[key],agreement=profile.agreements.find(a=>a.environment==='PLAINS_ACCEPT_EULA');
 assert.ok(agreement.text===f.terms,'Agreement bytes changed');assert.ok(agreement.text.includes('\r\n'));assert.equal(agreement.accept_value,'9b8cab870158a54a15526ed3af2c4104d8b420cdb9260f729b91f7665eb3ba5a');assert.equal(crypto.createHash('sha256').update(agreement.text,'utf8').digest('hex'),agreement.accept_value);assert.equal(agreement.effective_date,'2026-03-03');
 const control=profile.egg.variables.find(v=>v.env_variable===agreement.environment);assert.equal(control.default_value,'0');assert.equal(control.rules,'required|string|in:0,'+agreement.accept_value);assert.equal(profile.egg.variables.filter(v=>v.env_variable===agreement.environment).length,1);
 assert.ok(JSON.stringify(stageWastelandProfiles(staged,f.bodies,f.pins,f.terms))===JSON.stringify(staged),'Stage refresh is not idempotent');
 for(const[k,p]of Object.entries(staged))if(k!==key)assert.ok(JSON.stringify(p.agreements)===JSON.stringify(f.current[k].agreements),'Other profile agreements changed');
});
test('changed or newline-normalized terms and missing embeddings fail explicitly',()=>{
 const f=fixture();for(const terms of [f.terms.replaceAll('\r\n','\n'),f.terms+'x',''])assert.throws(()=>stageWastelandProfiles(f.current,f.bodies,f.pins,terms),/EULA bytes mismatch/);
 const broken=structuredClone(f.current);broken['plains_of_pain/egg-plains-of-pain.json'].egg.scripts.installation.script='old unsupported installer';assert.throws(()=>stageWastelandProfiles(broken,f.bodies,f.pins,f.terms),/embedding required/);
});
