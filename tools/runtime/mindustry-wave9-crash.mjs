import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {runtime,verifyRuntime,activeLease,api,observePower,containers,docker} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'mindustry-wave9'),s=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));await verifyRuntime();activeLease(s.lease.lease_id,'mindustry_native');
const a=(await api('/api/application/servers/'+s.server.id)).attributes;if(a.uuid!==s.server.uuid||a.egg!==s.egg.id||a.node!==1)throw Error('Exact owned game required');
const owned=containers().filter(c=>c.Name==='/'+s.server.uuid&&c.State.Running);assert.equal(owned.length,1);const c=owned[0];assert.equal(c.HostConfig.Memory,1024**3);assert.equal((await observePower(s)).current_state,'running');
const auth=(await api('/api/client/servers/'+s.server.uuid+'/websocket')).data,ws=new WebSocket(auth.socket),events=[],password=null;
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('WS auth timeout')),10000);ws.addEventListener('open',()=>ws.send(JSON.stringify({event:'auth',args:[auth.token]})));ws.addEventListener('error',()=>reject(Error('WS error')));ws.addEventListener('message',m=>{const e=JSON.parse(String(m.data));if(e.event==='auth success'){clearTimeout(t);resolve();}if(['console output','status','daemon error'].includes(e.event))events.push({at:new Date().toISOString(),event:e.event,args:e.args?.map(x=>String(x))});});});
 const proof={at:new Date().toISOString(),uuid:s.server.uuid,container:c.Id,deliberate_signal:'SIGKILL',before:await observePower(s)};
 const monitor=spawn('docker',['--context','desktop-linux','wait',c.Id],{windowsHide:true,stdio:['ignore','pipe','pipe']});let waitOutput='';monitor.stdout.on('data',chunk=>waitOutput+=chunk);
 const terminal=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{monitor.kill();reject(Error('Crash terminal observer timeout'));},15000);monitor.on('exit',code=>{clearTimeout(timer);code===0?resolve(Number(waitOutput.trim())):reject(Error('Crash terminal observer failed'));});});
 await new Promise(r=>setTimeout(r,300));docker(['kill','--signal','KILL',c.Id]);proof.actual_wait_exit=await terminal;proof.immediate_postexit=containers().filter(c=>c.Id===proof.container).map(c=>c.State);await new Promise(r=>setTimeout(r,12000));
 proof.after=await observePower(s);proof.containers=containers().filter(c=>c.Name==='/'+s.server.uuid).map(c=>({id:c.Id,state:c.State}));proof.statuses=events.filter(e=>e.event==='status');proof.nonzero_exit_without_oom=proof.containers.some(c=>c.state.ExitCode===137&&!c.state.OOMKilled);
 proof.nonzero_exit_without_oom=proof.actual_wait_exit===137&&proof.immediate_postexit.every(c=>!c.OOMKilled);
 fs.writeFileSync(path.join(dir,'crash-console.json'),JSON.stringify(events,null,2)+'\n');fs.writeFileSync(path.join(dir,'crash.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}finally{ws.close();}
