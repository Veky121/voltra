import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const docker=(args)=>{const r=spawnSync('docker',['--context','desktop-linux',...args],{windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});if(r.status!==0)throw Error((r.stderr||r.stdout||'Docker command failed').trim());return(r.stdout||'').trim();};
const endpoint=docker(['context','inspect','desktop-linux','--format','{{.Endpoints.docker.Host}}']);
assert(endpoint.startsWith('npipe://'),'Only local Windows Docker Desktop is allowed');
const image='python:3.12-slim',imageID=docker(['image','inspect',image,'--format','{{.Id}}']);
const name='rehlds-wave10-offline-'+Date.now();let id;
try{
 id=docker(['create','--name',name,'--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--pids-limit','128','--label','voltra.campaign=game-parity-20261029','--label','voltra.scope=rehlds-wave10-offline','--mount','type=bind,source='+process.cwd()+',target=/source,readonly','--tmpfs','/tmp:rw,size=64m,mode=1777','-e','PYTHONDONTWRITEBYTECODE=1','-w','/source',image,'python','tools/runtime/rehlds-parity-wave10-test.py']);
 assert(/^[a-f0-9]{64}$/.test(id));
 const before=JSON.parse(docker(['inspect',id]))[0];
 assert.equal(before.HostConfig.Memory,256*1024*1024);assert.equal(before.HostConfig.MemorySwap,256*1024*1024);assert.equal(before.HostConfig.NanoCpus,1000000000);assert.equal(before.HostConfig.NetworkMode,'none');assert.equal(before.HostConfig.ReadonlyRootfs,true);
 const run=spawnSync('docker',['--context','desktop-linux','start','-a',id],{windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
 const logs=(run.stdout||'')+(run.stderr||'');fs.writeFileSync('artifacts/game-parity-20261029/rehlds-wave10-linux-tests.log',logs);
 const after=JSON.parse(docker(['inspect',id]))[0];
 assert.equal(after.Config.Labels['voltra.scope'],'rehlds-wave10-offline');assert.equal(after.Name,'/'+name);
 const passed=run.status===0&&after.State.ExitCode===0&&!after.State.OOMKilled&&!/skipped=/.test(logs);
 fs.writeFileSync('artifacts/game-parity-20261029/rehlds-wave10-linux-tests.json',JSON.stringify({at:new Date().toISOString(),passed,environment:'Windows Docker Desktop local npipe, desktop-linux',endpoint,image,image_id:imageID,container:id,limits:{memory_mib:256,extra_swap_mib:0,cpu:1,network:'none',root_readonly:true,source_readonly:true,tmpfs_mib:64},exit:after.State.ExitCode,oom:after.State.OOMKilled,scope:'Offline pure preflight/delegation fixtures; no game payload or native process',log:'artifacts/game-parity-20261029/rehlds-wave10-linux-tests.log',native_acceptance:false},null,2)+'\n');
 console.log(logs);if(!passed)process.exitCode=1;
}finally{
 if(id){const owned=JSON.parse(docker(['inspect',id]))[0];assert.equal(owned.Config.Labels['voltra.scope'],'rehlds-wave10-offline');assert.equal(owned.Name,'/'+name);if(owned.State.Running)docker(['stop','--time','2',id]);docker(['rm',id]);}
}
