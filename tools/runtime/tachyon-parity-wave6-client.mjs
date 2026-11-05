import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {runtime,verifyRuntime,activeLease,docker,observePower,digest} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'tachyon-native'),s=JSON.parse(fs.readFileSync(path.join(dir,'state.json'))),uuid=s.fixture.server.uuid;
await verifyRuntime();activeLease(s.lease.lease_id,'tachyon_native');if((await observePower(s.fixture)).current_state!=='running')throw Error('Running owned native server required');
const phase=process.argv[2]||'run',script='/home/container/.voltra/tachyon-client-run.py';
if(phase==='run'){
 const archive=path.resolve('.local/small-games-family/tachyon.zip');if(digest(fs.readFileSync(archive))!=='516cc90196e1bc4c27ae2bf8fed01ad25730d9fbc92b23fc49ead0935dfb85ac')throw Error('Client source archive identity mismatch');
 docker(['cp',archive,uuid+':/home/container/.voltra/tachyon-client-source.zip']);docker(['cp',path.resolve('tools/runtime/tachyon-parity-wave6-client.py'),uuid+':'+script]);
 const child=spawn('docker',['--context','desktop-linux','exec',uuid,'python3','-u',script,'run'],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',b=>{output+=b;process.stdout.write(b);});child.stderr.on('data',b=>{errors+=b;process.stderr.write(b);});const exit=await new Promise(r=>child.on('close',r));
 const complete=output.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)).find(x=>x.stage==='complete');
 const launched=!!complete&&complete.client_exit_before_cleanup===null;
 fs.writeFileSync(path.join(dir,'client-'+Date.now()+'.json'),JSON.stringify({at:new Date().toISOString(),boundary:'Actual matching graphical client in independent files on own Xvfb; same1GiB/CPU1 lease, no new dependency/download.',exit,client_launch_succeeded:launched,output,errors},null,2)+'\n');if(exit!==0||!launched)process.exitCode=1;
}else if(phase==='snapshot'){
 const result=JSON.parse(docker(['exec',uuid,'python3',script,'snapshot']));const local=path.join(dir,'client-'+Date.now()+'.png');docker(['cp',uuid+':'+result.screenshot,local]);console.log(local);
}else if(phase==='click'){
 console.log(docker(['exec',uuid,'python3',script,'click',process.argv[3],process.argv[4]]));
}else throw Error('Unsupported client phase');
