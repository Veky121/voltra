// Exact public helper bytes for reconstructable managed acceptance evidence.
import fs from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {managedNativeLease} from './managed-steam-acceptance-lease.mjs';
const label=process.argv[2];if(!/^[a-zA-Z0-9_-]{1,64}$/.test(label??''))throw Error('Bounded evidence label required');
const runtime=JSON.parse(fs.readFileSync('.local/managed-steam-native/current.json','utf8'));
managedNativeLease(JSON.parse(fs.readFileSync('.local/game-batch/queue.json','utf8')),runtime.lease_id,runtime.game);
if(runtime.game!=='satisfactory'||runtime.root!=='/var/lib/voltra-batch-20261023/managed-bridge/'+runtime.run_id||resolve(runtime.directory)!==resolve('.local/managed-steam-native',runtime.run_id))throw Error('Unexpected isolated namespace');
const game=JSON.parse(fs.readFileSync(join(runtime.directory,'private/game.json'),'utf8'));
if(!/^[a-f0-9-]{36}$/.test(game.uuid)||!game.uuid.startsWith(game.identifier+'-'))throw Error('Owned game identity unavailable');
const docker=args=>{const r=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024,timeout:30000});if(r.status)throw Error('Owned source inspection failed');return r.stdout;};
const directory=join(runtime.directory,'exact-sources-'+label);fs.mkdirSync(directory,{recursive:true});
const receipt={observed_at:new Date().toISOString(),run:runtime.run_id,files:{}};
function save(name,bytes){fs.writeFileSync(join(directory,name),bytes,{mode:0o600});receipt.files[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
const source=fs.readFileSync(join(runtime.directory,'source-at-first-install/internal/steamexec/docker.go'),'utf8');
const expected=source.match(/const mutationScript = `([\s\S]*?)`/);if(!expected)throw Error('Expected compiled helper source unavailable');
save('expected-steam-mutation.sh',Buffer.from(expected[1],'utf8'));
if(process.argv.includes('--job')){
 const response=await fetch(runtime.panel_url+'/api/client/servers/'+game.identifier+'/steam');if(!response.ok)throw Error('Owned job status unavailable');
 const status=(await response.json()).attributes,job=status.current_job??status.jobs?.find(j=>j.status==='running');
 if(!job?.id||!/^[a-f0-9-]{36}$/.test(job.id))throw Error('No active owned helper job');
 const ids=docker(['ps','-q','--filter','label=io.voltra.steam-job']).trim().split(/\s+/).filter(Boolean);
 for(const id of ids){
  const info=JSON.parse(docker(['inspect',id]))[0],phase=info.Config.Labels['io.voltra.steam-job'];
  if(phase!==job.id&&!phase.startsWith(job.id+'-'))continue;
  if(!info.Mounts.some(m=>m.Source===runtime.root+'/volumes/'+game.uuid&&m.Destination==='/data'))continue;
  const command=info.Config.Cmd;
  if(command?.[0]==='-c'&&command[2]==='voltra-steam'){
   const bytes=Buffer.from(command[1],'utf8');if(!bytes.equals(Buffer.from(expected[1],'utf8')))throw Error('Actual helper differs from compiled source snapshot');
   save('actual-steam-mutation.sh',bytes);receipt.job=job.id;
   const login=command.indexOf('+login'),update=command.indexOf('+app_update');
   if(login<0||command[login+1]!=='anonymous'||command.includes('-betapassword')||update<0||command[update+1]!=='1690800')throw Error('Only public owned Satisfactory helper evidence is permitted');
   receipt.public_anonymous_login=true;receipt.app_update=1690800;receipt.validate_arguments=command.filter(value=>value==='validate').length;
  }
 }
 if(!receipt.files['actual-steam-mutation.sh'])throw Error('Owned mutation helper not currently running; no actual-source claim');
}else{
 const info=JSON.parse(docker(['inspect',game.uuid]))[0];
 if(!info.Mounts.some(m=>m.Source===runtime.root+'/volumes/'+game.uuid&&m.Destination==='/home/container'))throw Error('Owned game mount mismatch');
 const script="from pathlib import Path;import stat,base64;p=Path('/game/FactoryServer.sh');s=p.lstat();assert stat.S_ISREG(s.st_mode) and s.st_size<1048576;print(base64.b64encode(p.read_bytes()).decode())";
 const bytes=Buffer.from(docker(['run','--rm','--pull','never','--network','none','--user','1000:1000','--read-only','--memory','64m','--cpus','1','--mount',`type=bind,source=${runtime.root}/volumes/${game.uuid},target=/game,readonly`,'python:3.13-slim','python3','-B','-c',script]).trim(),'base64');
 save('installed-FactoryServer.sh',bytes);
}
fs.writeFileSync(join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));
