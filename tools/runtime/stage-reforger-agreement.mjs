import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const d='.local/reforger-agreement/',base='internal/panel/game_library/scripts/',canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),terms=JSON.parse(fs.readFileSync(base+'arma-releases.json')).reforger_agreement;
const help='Review the complete Arma Reforger Server EULA1874900_eula_1 in setup before explicitly agreeing. Default off blocks installation, automatic update and launch before side effects. This reviewed agreement covers stable1874900 only; the original experimental1890870 choice is retained but blocked until its publisher terms are separately reviewed. No Bohemia online Services, Workshop or separate BattlEye agreement is accepted by this field.';
const staged={},changes=[];
for(const[path,p]of Object.entries(canonical)){
 const script=p.egg?.scripts?.installation?.script;if(!script?.includes('cat > .voltra/arma-native.py '))continue;const c=structuredClone(p),modules=[];
 for(const name of ['arma-native.py','arma-releases.json']){
  const re=new RegExp("(cat > \\.voltra/"+name.replaceAll('.','\\.')+" <<'([^']+)'\\r?\\n)([\\s\\S]*?)(\\r?\\n\\2)");const m=re.exec(c.egg.scripts.installation.script);if(!m){assert.equal(name,'arma-releases.json');continue;}
  assert.equal(m[3].replaceAll('\r\n','\n').trimEnd(),fs.readFileSync(d+name+'-before','utf8').replaceAll('\r\n','\n').trimEnd(),'Old helper drift '+path);
  const raw=fs.readFileSync(base+name,'utf8').replaceAll('\r\n','\n');assert(raw.endsWith('\n'));c.egg.scripts.installation.script=c.egg.scripts.installation.script.replace(re,(_all,open,_del,_body,end)=>open+raw.slice(0,-1)+end);const emitted=re.exec(c.egg.scripts.installation.script)[3]+'\n';assert.equal(emitted,raw);modules.push(name);
 }
 if(path==='arma/arma_reforger/egg-arma-reforger.json'){
  c.egg.variables.push({name:'Accept Arma Reforger Server EULA',env_variable:terms.environment,default_value:'0',rules:'required|string|in:0,'+terms.accept_value,description:'Review the full publisher EULA in setup and explicitly agree. Stable1874900 only; no experimental, online Services, Workshop or BattlEye agreement is implied.',user_viewable:true,user_editable:true,field_type:'text'});c.agreements=[terms];c.setup_steps.push(help);
 }
 const check=structuredClone(c);check.egg.scripts.installation.script=p.egg.scripts.installation.script;
 if(path.includes('arma_reforger')){check.egg.variables.pop();delete check.agreements;check.setup_steps.pop();}
 assert.deepEqual(check,p,'Other profile metadata drift');staged[path]=c;changes.push({path,modules});
}
assert.equal(changes.length,5);assert.equal(changes.filter(x=>x.modules.includes('arma-releases.json')).length,2);
fs.writeFileSync(d+'profiles.json',JSON.stringify(staged,null,2)+'\n');for(const name of ['arma-native.py','arma-releases.json'])fs.writeFileSync(d+name,fs.readFileSync(base+name));
for(const[path,p]of Object.entries(staged)){const target=d+'eggs/'+path;fs.mkdirSync(target.slice(0,target.lastIndexOf('/')),{recursive:true});fs.writeFileSync(target,JSON.stringify(p,null,2)+'\n');}
const pins=JSON.parse(fs.readFileSync(base+'arma-releases.json'));delete pins.reforger_agreement;assert.deepEqual(pins,JSON.parse(fs.readFileSync(d+'arma-releases.json-before')));
const stager='tools/runtime/stage-arma-profiles.mjs';let s=fs.readFileSync(stager,'utf8');s=s.replace("if(game==='reforger')profiles[path].agreements=[JSON.parse(fs.readFileSync(base+'arma-releases.json')).reforger_agreement];","if(game==='reforger'){profiles[path].agreements=[JSON.parse(fs.readFileSync(base+'arma-releases.json')).reforger_agreement];profiles[path].setup_steps.push("+JSON.stringify(help)+");}");fs.writeFileSync(stager,s);
const manifest={at:new Date().toISOString(),changes,files:['arma-native.py','arma-releases.json','profiles.json','publisher.html','publisher.txt'].map(name=>({path:d+name,sha256:createHash('sha256').update(fs.readFileSync(d+name)).digest('hex')}))};fs.writeFileSync(d+'manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(manifest);
