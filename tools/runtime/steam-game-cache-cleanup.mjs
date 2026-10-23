// Remove only receipt-listed, stopped private cache utility work/containers.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {core} from './steam-game-cache-common.mjs';
const directory='.local/steam-game-cache/app90-cstrike';const work=new Set(),containers=new Set();
for(const name of fs.readdirSync(directory).filter(name=>/^(prepare|verification).*\.json$/.test(name))){
 const value=JSON.parse(fs.readFileSync(directory+'/'+name));
 for(const row of value.cases||[value]){
  if(!/^[a-f0-9-]{36}$/.test(row.id||'')||!/^voltra-game-cache-(?:prepare|verify)-[a-f0-9]{8}(?:-metadata)?$/.test(row.container||''))throw Error('Unexpected private utility receipt');
  work.add(row.id);containers.add(row.container);if(row.container.startsWith('voltra-game-cache-prepare-'))containers.add(row.container+'-metadata');
 }
}
for(const name of containers){const inspected=spawnSync('docker',['inspect',name],{encoding:'utf8'});if(inspected.status!==0){if(!inspected.stderr.includes('No such'))throw Error('Cannot inspect utility state');continue;}const info=JSON.parse(inspected.stdout)[0];if(info.State.Running||info.State.Restarting)throw Error('Utility still active; no cleanup performed');}
for(const name of containers){const inspected=spawnSync('docker',['inspect',name],{encoding:'utf8'});if(inspected.status===0){const result=spawnSync('docker',['rm',name],{encoding:'utf8'});if(result.status)throw Error('Stopped utility cleanup failed');}}
const results=[...work].map(id=>core(['clean-work','--id',id]));
const report={private_utility_work_removed:work.size,private_utility_containers:containers.size,game_boots:0,panel_mutations:0,total_shared_cache_bytes:results.at(-1)?.total_shared_bytes,observed_at:new Date().toISOString()};
fs.writeFileSync(directory+'/cleanup.json',JSON.stringify(report,null,2)+'\n');console.log(report);
