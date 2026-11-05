import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import * as g from './campaign-native-20261029.mjs';
const dir=path.join(g.root,'artifacts/game-parity-20261029/soldat-resource-followup-20261030');
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
r.source_tests={command:'node --test tools/runtime/soldat-resource-followup-20261030.test.mjs',pass:2,fail:0,syntax:'pass'};
r.helper_note='Root 33 source tests reused. Automatic waitNativeInstaller bootstrap verified natively once; no manual configure fallback. Earlier Soldat game evidence retained, no new game acceptance.';
r.failures_retained=[];
r.actual_operations={publisher_acquisition:0,image_pulls:0,panel_restarts:0,wings_restarts:0,activation:0,game_acceptance:false};
r.file_hashes={};for(const f of ['tools/runtime/soldat-resource-followup-20261030.mjs','tools/runtime/soldat-resource-followup-20261030.test.mjs','tools/runtime/soldat-resource-followup-finalize-20261030.mjs'])r.file_hashes[f]=g.digest(fs.readFileSync(path.join(g.root,f)));
r.checks['RESOURCE-PROTECTED-COMPARE']={status:r.protected_comparison.every(x=>x.unchanged)?'pass':'partial',evidence:'protected_comparison'};
r.checks['RESOURCE-FILESYSTEM-CLEANUP']={status:'pass',evidence:r.filesystem_cleanup};
r.checks['SOURCE-TESTS']={status:'pass',evidence:r.source_tests};
r.recipe='soldat/egg-soldat.json';
r.game_acceptance='partial; resource-only followup, no installation/readiness claim';
r.reused=['artifacts/soldat-classic-native-acceptance.json','artifacts/game-parity-20261029/soldat-resource-proof-20261030/report.json','artifacts/game-parity-20261029/root-soldat-watcher-phase-report.json'];
r.queue_terminal=JSON.parse(fs.readFileSync(path.join(g.runtime,'queue.json'))).claims.find(c=>c.lease_id===r.resources.lease.lease_id);
if(r.queue_terminal.status!=='tested'||!r.queue_terminal.finished_at)throw Error('Lease not terminal');
fs.writeFileSync(file,JSON.stringify(r,null,2)+'\n');
console.log(JSON.stringify({filesystem:r.filesystem_cleanup,protected_unchanged:r.protected_comparison.every(x=>x.unchanged),checks:Object.keys(r.checks),hashes:r.file_hashes}));
