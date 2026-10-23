// Acceptance-only stock game-client API calls against one owned loopback game.
// Protocol reference: publisher DedicatedServerAPIDocs.md (also reproduced at
// https://satisfactory.wiki.gg/wiki/Dedicated_servers/HTTPS_API).
import fs from 'node:fs';
import https from 'node:https';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {managedNativeLease} from './managed-steam-acceptance-lease.mjs';

const base=resolve('.local/managed-steam-native');
const runtime=JSON.parse(fs.readFileSync(join(base,'current.json'),'utf8'));
if(runtime.game!=='satisfactory'||runtime.panel_url!=='http://127.0.0.1:18098'||!/^[a-f0-9-]{36}$/.test(runtime.run_id)||runtime.root!=='/var/lib/voltra-batch-20261023/managed-bridge/'+runtime.run_id||resolve(runtime.directory)!==join(base,runtime.run_id))throw Error('Expected owned isolated Satisfactory fixture');
const active=()=>managedNativeLease(JSON.parse(fs.readFileSync('.local/game-batch/queue.json','utf8')),runtime.lease_id,'satisfactory');
const lease=active();
const file=join(runtime.directory,'private','game.json');
const state=JSON.parse(fs.readFileSync(file,'utf8'));
if(state.game!=='satisfactory'||!state.identifier||!/^[a-f0-9-]{36}$/.test(state.uuid)||!state.uuid.startsWith(state.identifier+'-')||!lease.ports.includes(runtime.ports[0]))throw Error('Missing owned game identity');
const inspection=spawnSync('docker',['inspect',state.uuid],{encoding:'utf8',windowsHide:true});if(inspection.status)throw Error('Owned native API container unavailable');
const container=JSON.parse(inspection.stdout)[0];
if(!container.State.Running||!container.Mounts.some(m=>m.Source===runtime.root+'/volumes/'+state.uuid&&m.Destination==='/home/container')||!container.HostConfig.PortBindings[String(runtime.ports[0])+'/tcp']?.some(p=>p.HostIp==='127.0.0.1'&&p.HostPort===String(runtime.ports[0])))throw Error('Native API is outside the owned loopback binding');
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n',{mode:0o600});
const secretValues=()=>[state.game_token,state.game_admin_password,state.console_password].filter(Boolean);
function redact(value){
 if(Array.isArray(value))return value.map(redact);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,value])=>[key,/password|token|secret|authorization/i.test(key)&&typeof value!=='boolean'?(value?'[configured]':''):redact(value)]));
 if(typeof value==='string')for(const secret of secretValues())value=value.replaceAll(secret,'[redacted]');
 return value;
}
async function call(functionName,data={},authenticated=true){
 active();
 const body=JSON.stringify({function:functionName,data});
 return await new Promise((resolve,reject)=>{
  // The dedicated server's stock self-signed certificate is accepted only for
  // this receipt-owned loopback port, never by changing global TLS behavior.
  const request=https.request({hostname:'127.0.0.1',port:runtime.ports[0],path:'/api/v1',method:'POST',rejectUnauthorized:false,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),...(authenticated&&state.game_token?{Authorization:'Bearer '+state.game_token}:{})},timeout:45000},response=>{
   let text='';response.setEncoding('utf8');response.on('data',chunk=>{text+=chunk;if(text.length>1024*1024)request.destroy(Error('Oversized native API response'));});
   response.on('end',()=>{let value;try{value=text?JSON.parse(text):{};}catch{reject(Error('Native API returned non-JSON response'));return;}
    const result={function:functionName,status:response.statusCode,body:value};
    if(response.statusCode<200||response.statusCode>=300)reject(Error(JSON.stringify(redact(result))));else resolve(result);
   });
  });
  request.on('timeout',()=>request.destroy(Error('Native API request timed out')));
  request.on('error',error=>reject(Error(String(redact(error.message)))));
  request.end(body);
 });
}
const saveLabel=process.argv.find(a=>a.startsWith('--save='))?.slice(7);if(saveLabel&&!/^[a-zA-Z0-9_-]{1,64}$/.test(saveLabel))throw Error('Safe evidence label required');
const [command,argument]=process.argv.slice(2).filter(a=>!a.startsWith('--save='));
let result;
if(command==='health')result=await call('HealthCheck',{ClientCustomData:'VoltraManagedNativeFixture'},false);
else if(command==='claim'){
 if(state.game_admin_password)throw Error('Inspect existing claimed server before claiming again');
 result=await call('PasswordlessLogin',{MinimumPrivilegeLevel:'InitialAdmin'},false);
 state.game_token=result.body.data?.authenticationToken??result.body.data?.AuthenticationToken;
 if(!state.game_token)throw Error('Native initial-admin authentication returned no token');
 state.game_admin_password=randomBytes(24).toString('base64url');save();
 result=await call('ClaimServer',{ServerName:'VoltraManaged-'+runtime.run_id.slice(0,8),AdminPassword:state.game_admin_password});
 state.game_token=result.body.data?.authenticationToken??result.body.data?.AuthenticationToken??state.game_token;save();
}else if(command==='login'){
 if(!state.game_admin_password)throw Error('Missing private owned administrator credential');
 result=await call('PasswordLogin',{MinimumPrivilegeLevel:'Administrator',Password:state.game_admin_password},false);
 state.game_token=result.body.data?.authenticationToken??result.body.data?.AuthenticationToken;
 if(!state.game_token)throw Error('Native administrator login returned no token');save();
}else if(command==='state')result=await call('QueryServerState');
else if(command==='options')result=await call('GetServerOptions');
else if(command==='sessions')result=await call('EnumerateSessions');
else if(command==='save')result=await call('SaveGame',{SaveName:'VoltraManagedMarker-'+runtime.run_id.slice(0,8)});
else if(command==='load-save'){
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(argument??''))throw Error('Explicit bounded owned save name required');
 const sessions=await call('EnumerateSessions');
 if(!sessions.body.data?.sessions?.some(session=>session.saveHeaders?.some(save=>save.saveName===argument)))throw Error('Save must already exist on the owned server');
 result=await call('LoadGame',{SaveName:argument,EnableAdvancedGameSettings:false});
}
else if(['create-world','set-options','create-world-file','set-options-file'].includes(command)){
 const data=JSON.parse(command.endsWith('-file')?fs.readFileSync(argument,'utf8').replace(/^\uFEFF/,''):argument??'{}');
 if(/password|token|secret|authorization/i.test(JSON.stringify(Object.keys(data))))throw Error('Credentials must not be supplied through command arguments');
 result=await call(command.startsWith('create-world')?'CreateNewGame':'ApplyServerOptions',data);
}else throw Error('Choose health,claim,login,state,options,sessions,save,create-world,set-options');
const output=redact(result);if(saveLabel)fs.writeFileSync(join(runtime.directory,saveLabel+'.json'),JSON.stringify(output,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(output));
