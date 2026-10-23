// One bounded watcher. Admission remains the atomic shared queue claim.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {setTimeout} from 'node:timers/promises';import {api,rows} from './openttd-compat-node.mjs';
const marker='.local/ksp-games/lmp-watch.lock';let lock;try{lock=fs.openSync(marker,'wx');}catch{throw Error('Existing watcher marker; inspect before starting another');}
try{
 fs.writeFileSync(lock,JSON.stringify({pid:process.pid,deadline:new Date(Date.now()+300000).toISOString()}));
 for(const end=Date.now()+300000;Date.now()<end;){
  if(fs.existsSync('.local/ksp-games/lmp/private.json'))throw Error('Existing LMP receipt; do not duplicate');
  const active=JSON.parse(fs.readFileSync('.local/game-batch/queue.json')).claims.filter(c=>c.status==='active');
  if(active.length<7&&active.reduce((s,c)=>s+c.memory_mib,0)+1024<=20480&&active.reduce((s,c)=>s+c.disk_mib,0)+4096+20480<=131072){
   if(rows(await api('/api/application/servers')).some(s=>s.name?.includes('KSP LMP')))throw Error('Existing authoritative LMP API resource');
   const result=spawnSync(process.execPath,['tools/runtime/ksp-create.mjs','lmp'],{encoding:'utf8'});
   if(result.status===0){console.log(result.stdout);break;}
   if(!result.stderr.includes('resource budget exhausted'))throw Error('LMP creation failed; inspect private receipt before continuing');
  }
  await setTimeout(3000);
 }
 console.log(fs.existsSync('.local/ksp-games/lmp/private.json')?'LMP admitted through normal weighted claim.':'Bounded watcher expired without resources.');
}finally{fs.closeSync(lock);fs.unlinkSync(marker);}
