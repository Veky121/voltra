import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {runtime,verifyRuntime,activeLease,api} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'xonotic-native'),s=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));const receipt=await verifyRuntime();activeLease(s.lease.lease_id,'xonotic_native');if(!s.fixture?.server)throw Error('Owned Xonotic fixture required');
const endpoint='/api/client/servers/'+s.fixture.server.uuid,action=process.argv[2]||'observe',command=process.argv[3];
if(!['observe','start','stop','restart','command'].includes(action)||action==='command'&&!command)throw Error('Explicit supported console action required');
const credentials=(await api(endpoint+'/websocket')).data,url=new URL(credentials.socket);
if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||url.port!=='18099'||url.pathname!==endpoint+'/ws')throw Error('Refuse console credential transport outside owned loopback fixture');
const ws=new WebSocket(credentials.socket),events=[],file=path.join(dir,'console-'+action+'-'+Date.now()+'.json');let authenticated=false;
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Xonotic websocket auth timeout')),10000);ws.addEventListener('open',()=>ws.send(JSON.stringify({event:'auth',args:[credentials.token]})));ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Xonotic websocket connection failed'));});ws.addEventListener('message',m=>{let e;try{e=JSON.parse(String(m.data));}catch{return;}if(e.event==='auth success'){clearTimeout(timer);authenticated=true;resolve();}if(['status','console output','daemon message','stats'].includes(e.event))events.push({at:new Date().toISOString(),...e});});});
 ws.send(JSON.stringify({event:'send logs',args:[]}));ws.send(JSON.stringify({event:'send stats',args:[]}));
 if(['start','stop','restart'].includes(action)){
  // Reuse the owned native harness's exact helper verification and wait capture.
  const result=spawnSync(process.execPath,['tools/runtime/xonotic-parity-wave8-native.mjs',action],{windowsHide:true,encoding:'utf8'});if(result.status!==0)throw Error('Native action refused; inspect owned harness evidence');
 }else if(action==='command')ws.send(JSON.stringify({event:'send command',args:[command]}));
 const began=Date.now();while(Date.now()-began<(action==='command'?6000:45000)){
  const states=events.filter(e=>e.event==='status').map(e=>e.args?.[0]);
  if(action==='stop'&&states.at(-1)==='offline'||['start','restart'].includes(action)&&states.at(-1)==='running'&&(action!=='restart'||states.some(x=>['stopping','offline','starting'].includes(x))))break;
  await new Promise(r=>setTimeout(r,150));
 }
}finally{
 ws.close();const statuses=events.filter(e=>e.event==='status').map(e=>e.args?.[0]);
 const result={at:new Date().toISOString(),backend:receipt.binary_sha256,server_uuid:s.fixture.server.uuid,action,authenticated,statuses,console_lines:events.filter(e=>e.event==='console output').length,events};fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({authenticated,action,statuses,console_lines:result.console_lines,evidence:file}));
}
