import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as g from './campaign-native-20261029.mjs';
const dir=path.join(g.root,'artifacts/game-parity-20261029/wave225-soldat-live');fs.mkdirSync(dir,{recursive:true});
const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2)+'\n');
const r=await g.verifyRuntime();const q=JSON.parse(fs.readFileSync(path.join(g.runtime,'queue.json')));
save('preflight.json',{at:new Date().toISOString(),pid:r.pid,snapshot:r.snapshot,pause:q.activation_pause??null,capacity:g.hostCapacity(),active:q.claims.filter(c=>c.status==='active')});
if(q.activation_pause)throw Error('Activation pause');
const prior=JSON.parse(fs.readFileSync(path.join(g.root,'artifacts/game-parity-20261029/soldat-resource-followup-20261030/report.json'))).resources;
save('prior-resources.json',prior);
save('profile.json',g.profileFromRuntime('soldat/egg-soldat.json',r));
const proof={at:new Date().toISOString(),lease_id:prior.lease.lease_id,checks:[]};
for(const [url,id] of [['/api/application/servers/',prior.server.id],['/api/admin/eggs/',prior.egg.id],['/api/admin/nests/',prior.nest.id]]){const response=await fetch('http://127.0.0.1:18099'+url+id);if(response.status!==404)throw Error('Old record remains '+url);proof.checks.push({url:url+id,status:404});}
const all=g.containers();if(all.some(c=>c.Name.includes(prior.server.uuid)))throw Error('Old container remains');
const oldReport=JSON.parse(fs.readFileSync(path.join(g.root,'artifacts/game-parity-20261029/soldat-resource-followup-20261030/report.json')));
for(const row of oldReport.filesystem_cleanup){const p=spawnSync('docker',['--context','desktop-linux','cp','voltra-parity-20261029-wings:'+row.path,path.join(dir,'unexpected-remnant')],{encoding:'utf8',windowsHide:true});if(p.status===0||!/Could not find|no such file|not found/i.test(p.stderr))throw Error('Old path absence unproved');proof.checks.push({path:row.path,absent:true});}
const allocations=(await g.api('/api/application/nodes/1/allocations')).data.map(x=>x.attributes);if(allocations.some(a=>prior.allocations.some(p=>p.id===a.id)))throw Error('Old allocation remains');
save('fresh-cleanup.json',proof);
try{const lease=g.claimNative({game:'soldat/egg-soldat.json',owner:'wave225_soldat_live',memory_mib:512,disk_mib:4096,ports:2,fixed_ports:[29114,29124],retry_review:{lease_id:prior.lease.lease_id,game:'soldat/egg-soldat.json',resources_removed:true,reviewer:'wave225_soldat_live',cleanup_receipt:'artifacts/game-parity-20261029/wave225-soldat-live/fresh-cleanup.json',cleanup_sha256:g.digest(fs.readFileSync(path.join(dir,'fresh-cleanup.json'))),fix_reason:'Fresh game acceptance after resource-only test'}});save('lease.json',lease);console.log(JSON.stringify(lease));}catch(e){save('report.json',{outcome:'queued',reason:e.message,game_failure:false,lifecycle:'not_run',settings_consumption:'not_run',persistence:'not_run',worldsave:'not_assessed',foundation_pid:r.pid});console.log(e.message);}

