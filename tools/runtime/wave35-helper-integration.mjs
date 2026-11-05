import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {embeddedPython} from './embedded-python.mjs';
import {refreshHelpers} from './refresh-profile-helpers.mjs';
const out='artifacts/game-parity-20261029/wave35-helper-integration';fs.mkdirSync(out,{recursive:true});
const file='internal/panel/game_library/overrides.json';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const norm=x=>x.replaceAll('\r\n','\n').replace(/\n$/,'');
const names=['mordhau_linux','kf2','jc3','plains','rising_unity','stationeers_vanilla','thefront'];
const reports=names.map(n=>{let p=`artifacts/game-parity-20261029/wave34-${n}/report.json`;return {path:p,sha256:hash(fs.readFileSync(p)),report:JSON.parse(fs.readFileSync(p))}});
const modules=['melee_native','session_servers_install','session_servers_runtime','open_world_servers','wasteland_servers','steam_native_next','stationeers_wurm_starbound_install','stationeers_wurm_starbound_runtime','unreal_survival_install','unreal_survival_runtime','frontier_native'];
const sources=new Map(modules.map(m=>[m,fs.readFileSync(`internal/panel/game_library/scripts/${m.replaceAll('_','-')}.py`,'utf8')]));
const baseline=out+'/overrides.before.json';if(!fs.existsSync(baseline))fs.copyFileSync(file,baseline);
const before=JSON.parse(fs.readFileSync(baseline));
const special='scpsl/exiled/egg-s-c-p--s-l--exiled.json';
const specialized=embeddedPython(before[special].egg.scripts.installation.script).find(x=>x.file.endsWith('session_servers_install.py')).source;
// Updated runtime retains kf2_ports and launch/scp_configuration_file signatures.
// EXILED never takes the KF2 branch. Keep its complete specialized preservation,
// consent, pin/digest, rollback and pre-acquisition guards byte-for-byte.
assert.match(sources.get('session_servers_runtime'),/def kf2_ports\(env\):/);
const generic=structuredClone(before);delete generic[special];
const refreshed=refreshHelpers(generic,sources);const after=refreshed.profiles;
after[special]=refreshHelpers({[special]:before[special]},new Map([...sources].filter(([k])=>k!=='session_servers_install'))).profiles[special];
assert.equal(embeddedPython(after[special].egg.scripts.installation.script).find(x=>x.file.endsWith('session_servers_install.py')).source,specialized);
const strip=p=>{let x=structuredClone(p);x.egg.scripts.installation.script='';return x};
const inventory=[],changed={};
for(const [recipe,p] of Object.entries(before)){
 assert.deepEqual(strip(p),strip(after[recipe]));
 const old=embeddedPython(p.egg.scripts.installation.script),current=embeddedPython(after[recipe].egg.scripts.installation.script);
 assert.deepEqual(old.map(x=>x.file),current.map(x=>x.file));
 const entries=current.map((x,i)=>{const module=path.posix.basename(x.file).slice(0,-3).replaceAll('-','_');return {target:x.file,module,old_raw:hash(old[i].source+'\n'),old_normalized:hash(norm(old[i].source)),raw:hash(x.source+'\n'),normalized:hash(norm(x.source)),changed:x.source!==old[i].source,source:sources.has(module)?hash(norm(sources.get(module))):null,specialization:recipe===special&&module==='session_servers_install'?'Preserved exact reviewed EXILED body; runtime exported API compatible':null}});
 for(const e of entries)if(sources.has(e.module)&&!e.specialization)assert.equal(e.normalized,e.source,recipe+' '+e.module);
 inventory.push({recipe,before:hash(JSON.stringify(p)),after:hash(JSON.stringify(after[recipe])),metadata_before:hash(JSON.stringify(strip(p))),metadata_after:hash(JSON.stringify(strip(after[recipe]))),startup:p.egg.startup,emissions:entries});
 if(p.egg.scripts.installation.script!==after[recipe].egg.scripts.installation.script)changed[recipe]=after[recipe];
}
assert.equal(refreshHelpers(after,new Map([...sources].filter(([k])=>k!=='session_servers_install'))).changes.length,0);
const frozenPaths=['artifacts/game-parity-20261029/LATEST-CANDIDATE.json','artifacts/game-parity-20261029/root-candidate-build-wave32/candidate.json'];
const frozen=frozenPaths.map(p=>({path:p,sha256:hash(fs.readFileSync(p))}));
fs.writeFileSync(out+'/profiles.pending.json',JSON.stringify(changed,null,2)+'\n');
fs.writeFileSync(out+'/inventory.json',JSON.stringify(inventory,null,2)+'\n');
fs.writeFileSync(out+'/owner-evidence.json',JSON.stringify(reports,null,2)+'\n');
fs.writeFileSync(out+'/integration.json',JSON.stringify({modules:[...sources].map(([name,body])=>({name,raw:hash(body),normalized:hash(norm(body))})),changed_recipes:Object.keys(changed),profiles:inventory.length,metadata_unchanged:true,duplicate_emission_introduced:false,frozen,exiled_review:'No adaptation needed: exported kf2_ports, launch and scp_configuration_file remain compatible; new kf2_plan is KF2-only. Specialized installer unchanged.',source_mismatch_policy:'Only explicit manifest modules refreshed; complete before/after bodies retained for review. Existing intentional unrelated PixARK/Empyrion bodies unchanged.'},null,2)+'\n');
if(process.argv.includes('--apply')){
 const current=fs.readFileSync(file,'utf8');assert.ok(current===fs.readFileSync(baseline,'utf8')||JSON.stringify(JSON.parse(current))===JSON.stringify(after),'Canonical changed since reviewed baseline');
 fs.writeFileSync(file,JSON.stringify(after,null,2)+'\n');
}
console.log(JSON.stringify({profiles:inventory.length,changed:Object.keys(changed),apply:process.argv.includes('--apply')}));
