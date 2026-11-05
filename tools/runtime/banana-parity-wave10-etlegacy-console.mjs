import fs from 'node:fs';
import path from 'node:path';
import {runtime,api,docker,digest,verifyRuntime,activeLease,observePower} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'banana-wave10-etlegacy'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file)),phase=process.argv[2];
const commands=phase==='inspect'?['g_friendlyFire','dedicated','sv_advert','sv_maxclients']:phase==='secrets'?['g_password','rconpassword']:phase==='save'?['writeconfig voltra-campaign-saved.cfg']:phase==='bots'?['omnibot_enable','bot version','bot addbot']:null;
if(!commands)throw Error('Explicit inspect|secrets|save phase required');
await verifyRuntime();activeLease(s.lease.lease_id,'etlegacy_native_banana');if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Activation paused');
if((await observePower(s.fixture)).current_state!=='running')throw Error('Owned running native server required');
const base='/api/client/servers/'+s.fixture.server.uuid;
if(phase==='save'){const list=(await api(base+'/files/list?directory=%2Fetlegacy%2Fuserdata%2Flegacy')).data.map(r=>r.attributes);if(list.some(r=>r.name==='voltra-campaign-saved.cfg'))throw Error('Native export path already exists; preserve it');}
const credentials=(await api(base+'/websocket')).data,url=new URL(credentials.socket);
if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||url.port!=='18099'||url.pathname!==base+'/ws')throw Error('Owned authenticated loopback console required');
const socket=new WebSocket(url),events=[];
await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Console auth timeout')),10000);socket.addEventListener('open',()=>socket.send(JSON.stringify({event:'auth',args:[credentials.token]})));socket.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('Console socket failed'));});socket.addEventListener('message',m=>{const e=JSON.parse(String(m.data));if(e.event==='auth success'){clearTimeout(timeout);resolve();}if(['status','console output','daemon message'].includes(e.event))events.push({at:new Date().toISOString(),...e});});});
const at=new Date().toISOString();
try{for(const command of commands){await api(base+'/command','POST',{command});await new Promise(r=>setTimeout(r,200));}await new Promise(r=>setTimeout(r,1500));}
finally{socket.close();}
const capture=path.join(dir,'console-'+phase+'-'+Date.now()+'.json');fs.writeFileSync(capture,JSON.stringify(events,null,2)+'\n');
const combined=events.filter(e=>e.at>=at&&e.event==='console output').flatMap(e=>e.args||[]).join('\n');
const result={at,phase,commands,console_authenticated:true,capture,sha256:digest(fs.readFileSync(capture)),events:events.length};
if(phase==='inspect'){
 const clean=combined.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\^[0-9a-z]/gi,'');
 result.cvar_output=clean.split('\n').filter(line=>/g_friendlyFire|dedicated|sv_advert|sv_maxclients/i.test(line));
 result.ansi_present=/\x1b\[/.test(combined);
}else if(phase==='secrets'){
 const privateValues=JSON.parse(fs.readFileSync(path.join(dir,'fixture-native-secrets.json')));
 if(Object.values(privateValues).some(value=>value&&combined.includes(value)))throw Error('Native credential appeared unmasked; private capture retained');
 if(!combined.includes('[redacted]'))throw Error('No real native credential redaction response observed');
 result.private_values_absent=true;result.native_redaction_marker_observed=true;
}else if(phase==='bots'){
 const clean=combined.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\^[0-9a-z]/gi,'');result.bot_output=clean.split('\n').filter(line=>/omnibot|bot|version/i.test(line));
}else{
 const target='/etlegacy/userdata/legacy/voltra-campaign-saved.cfg';
 const r=await fetch('http://127.0.0.1:18099'+base+'/files/contents?file='+encodeURIComponent(target));const data=Buffer.from(await r.arrayBuffer());if(!r.ok||data.length===0)throw Error('Native writeconfig export unavailable');
 const mode=docker(['exec',s.fixture.server.uuid,'stat','-c','%a %u %g','/home/container'+target]).trim();
 const privateValues=JSON.parse(fs.readFileSync(path.join(dir,'fixture-native-secrets.json')));const containsSecret=Object.values(privateValues).some(value=>value&&data.includes(Buffer.from(value)));
 result.export={path:target,bytes:data.length,sha256:digest(data),mode_uid_gid:mode,contains_fixture_credential:containsSecret};if(containsSecret&&!mode.startsWith('600 '))throw Error('Native export contains credentials without private mode');
}
s.console_checks??=[];s.console_checks.push(result);fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');console.log(JSON.stringify(result));
