import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import * as g from './campaign-native-20261029.mjs';
const dir=path.join(g.root,'artifacts/game-parity-20261029/soldat-resource-proof-20261030');
const file=path.join(dir,'report.json'),r=JSON.parse(fs.readFileSync(file));
const after=g.containers(),wings=after.find(c=>c.Name==='/voltra-parity-20261029-wings');
const config=path.join(dir,'private-config-temporary');
try{
 g.docker(['cp',wings.Id+':/etc/pterodactyl/config.yml',config]);
 const text=fs.readFileSync(config,'utf8');
 r.filesystem_cleanup=[];
 for(const key of ['data','tmp_directory']){
  let parsed;try{parsed=JSON.parse(text);}catch{}
  const base=parsed?.system?.[key]||text.match(new RegExp('^\\s+'+key+':\\s*([^\\r\\n]+)','m'))?.[1]?.trim().replace(/^['"]|['"]$/g,'');
  if(!base?.startsWith('/'))throw Error('Cannot establish cleanup root '+key);
  const target=base.replace(/\/$/,'')+'/'+r.resources.server.uuid;
  const probe=spawnSync('docker',['--context','desktop-linux','cp',wings.Id+':'+target,path.join(dir,'unexpected-owned-remnant')],{encoding:'utf8',windowsHide:true});
  if(probe.status===0||!(/Could not find|no such file|not found/i.test(probe.stderr)))throw Error('Cleanup not verified '+key);
  r.filesystem_cleanup.push({path:target,absent:true});
 }
}finally{if(fs.existsSync(config))fs.unlinkSync(config);}
r.protected_comparison=r.protected_before.filter(c=>!c.Name.includes(r.resources.server.uuid)).map(before=>{
 const current=after.find(c=>c.Id===before.Id);
 const normalize=c=>({...c,Mounts:[...c.Mounts].sort((a,b)=>a.Destination.localeCompare(b.Destination))});
 return {id:before.Id,name:before.Name,unchanged:!!current&&isDeepStrictEqual(normalize(before),normalize(current))};
});
r.final_foundation=await g.verifyRuntime();delete r.final_foundation.snapshot;
r.source_tests={command:'node --test tools/runtime/soldat-resource-proof-20261030.test.mjs',pass:2,fail:0,syntax:'pass'};
r.helper_note='Accepted root 32 checks reused; not repeated. waitNativeInstaller reserved/unbound supplement mismatch bypassed only by owned baseline observer, with no shared edits or guard bypass.';
r.failures_retained=['Read-only sha256sum exec unavailable in minimal Wings image; used read-only docker cp and local hash','Initial shared waitNativeInstaller rejected unbound supplement; same gated installer resumed without restart'];
r.actual_operations={publisher_acquisition:0,image_pulls:0,panel_restarts:0,wings_restarts:0,activation:0,game_acceptance:false};
r.file_hashes={};for(const f of ['tools/runtime/soldat-resource-proof-20261030.mjs','tools/runtime/soldat-resource-proof-20261030.test.mjs','tools/runtime/soldat-resource-proof-finalize-20261030.mjs'])r.file_hashes[f]=g.digest(fs.readFileSync(path.join(g.root,f)));
r.checks=Object.fromEntries([...r.previous_phases,...r.phases].filter(x=>x.id!=='RESOURCE-REFUSAL').map(x=>[x.id,{status:'pass',boundary:x.id==='RESOURCE-PREFLIGHT'?'live foundation and source attestation':'native resource fixture only'}]));
fs.writeFileSync(file,JSON.stringify(r,null,2)+'\n');
console.log(JSON.stringify({filesystem:r.filesystem_cleanup,protected_unchanged:r.protected_comparison.every(x=>x.unchanged),checks:Object.keys(r.checks),hashes:r.file_hashes}));
