import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {api} from './openttd-compat-node.mjs';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/scpsl-native-approved',{receipt:s}=await ownedStoppedServer(dir+'/private.json');
const tag=process.argv[2]??'first';if(!/^[a-z0-9_-]+$/.test(tag))throw Error('Invalid phase tag');
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.egg!==s.egg_id||server.external_id!=='scpsl-native-'+s.request_id||s.owner!=='unreal_survival')throw Error('Owned egg identity mismatch');
if(fs.existsSync(dir+'/'+tag+'-reinstall-request.json'))throw Error('Reinstall already requested; inspect the same installer');
const profile=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[s.path];
if(profile.revision!=='session-servers-source-v1'||profile.egg.startup!=='exec python3 .voltra/session_servers_runtime.py scp')throw Error('Unexpected reviewed SCP SL source');
await api('/api/admin/eggs/'+s.egg_id+'/import','POST',profile.egg);
fs.writeFileSync(dir+'/source-profile-current.json',JSON.stringify(profile,null,2)+'\n');
fs.writeFileSync(dir+'/source-profile-'+tag+'.json',JSON.stringify(profile,null,2)+'\n',{flag:'wx'});
const credentials=(await api('/api/client/servers/'+s.identifier+'/websocket')).data;
const socket=new WebSocket(credentials.socket);
const stream=fs.createWriteStream(dir+'/'+tag+'-installer-stream.log',{flags:'wx'});
try{
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Installer websocket auth timed out')),10000);
  socket.addEventListener('open',()=>socket.send(JSON.stringify({event:'auth',args:[credentials.token]})));
  socket.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('Installer websocket failed'));});
  socket.addEventListener('message',message=>{
   const value=JSON.parse(String(message.data));
   if(value.event==='auth success'){clearTimeout(timeout);resolve();}
   if(value.event==='install output'||value.event==='install started'||value.event==='install completed')stream.write(JSON.stringify(value)+'\n');
  });
 });
 fs.writeFileSync(dir+'/'+tag+'-reinstall-request.json',JSON.stringify({uuid:s.uuid,phase:tag,at:new Date().toISOString()},null,2)+'\n');
 await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{environment:{},skip_scripts:false});
 await api('/api/application/servers/'+s.internal_id+'/reinstall','POST',{});
 console.log('Owned SCP SL real installer requested; no start submitted.');
 await delay(3000);
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){
  const current=(await api('/api/application/servers/'+s.internal_id)).attributes;
  if(current.uuid!==s.uuid)throw Error('Server identity changed');
  if(current.status==='install_failed')throw Error('Corrected source installer failed; do not retry');
  if(current.status===null){fs.writeFileSync(dir+'/'+tag+'-reinstall-completed.json',JSON.stringify({uuid:s.uuid,status:null,at:new Date().toISOString()},null,2)+'\n');console.log('Corrected source installer completed.');break;}
  await delay(2000);
 }
 if(!fs.existsSync(dir+'/'+tag+'-reinstall-completed.json'))throw Error('Installer still pending; inspect same handle');
}finally{socket.close();stream.end();}
