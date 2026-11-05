import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import {api,docker,containers,verifyRuntime,activeLease,observePower,digest,profileFromRuntime} from './campaign-native-20261029.mjs';
import {capturePython,replaceNativePublicIP} from './astroneer-parity-native.mjs';
const id='2b0703e0-e216-4b1a-b48a-0d2afe4f7d00',uuid='ade0b289-f128-4cf9-8f3b-9c0ca4ef94e4';
const dir='.local/game-parity-20261029/astroneer-native/'+id,stateFile=dir+'/state.json',reportFile='artifacts/game-parity-20261029/astroneer-native-readiness.json';
const s=JSON.parse(fs.readFileSync(stateFile)),port=29101;
const save=()=>fs.writeFileSync(stateFile,JSON.stringify(s,null,2)+'\n');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const url=file=>'http://127.0.0.1:18099/api/client/servers/'+uuid+'/files/'+file;
const name='/Astro/Saved/Config/WindowsServer/';
async function read(file){const r=await fetch(url('contents')+'?file='+encodeURIComponent(name+file));if(!r.ok)throw Error('INI read HTTP'+r.status);return Buffer.from(await r.arrayBuffer());}
async function write(file,body){const r=await fetch(url('write')+'?file='+encodeURIComponent(name+file),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});if(!r.ok)throw Error('INI write HTTP'+r.status);}
export function consoleSettings(body,password){
 if(!/^[a-f0-9]{48}$/.test(password))throw Error('Private hex fixture password required');
 let section='',seen=0,ports=0,passwords=0;
 let text=body.toString('utf8');if(!Buffer.from(text).equals(body))throw Error('Lossless UTF8 required');
 text=text.split(/(?<=\n)/).map(raw=>{const line=raw.replace(/[\r\n]+$/,''),ending=raw.slice(line.length);const header=line.match(/^\s*\[([^\]]+)\]/);if(header){section=header[1].toLowerCase();if(section==='/script/astro.astroserversettings')seen++;return raw;}if(section!=='/script/astro.astroserversettings')return raw;if(/^\s*ConsolePort\s*=/i.test(line)){ports++;return 'ConsolePort=29101'+ending;}if(/^\s*ConsolePassword\s*=/i.test(line)){passwords++;return 'ConsolePassword='+password+ending;}return raw;}).join('');
 if(seen!==1||ports>1||passwords>1)throw Error('Ambiguous native console fields');
 if(!ports||!passwords){const rows=text.split(/(?<=\n)/);const i=rows.findIndex(x=>/^\s*\[\/Script\/Astro\.AstroServerSettings\]/i.test(x));rows.splice(i+1,0,(!ports?'ConsolePort=29101\r\n':'')+(!passwords?'ConsolePassword='+password+'\r\n':''));text=rows.join('');}
 return Buffer.from(text);
}
async function probe(password){return new Promise(resolve=>{let bytes=0,chunks=[],sent=[];const socket=net.createConnection({host:'127.0.0.1',port});const finish=error=>{socket.destroy();resolve({at:new Date().toISOString(),bytes,commands:sent,error,raw:Buffer.concat(chunks).toString('utf8')});};const timer=setTimeout(()=>finish('bounded_response_timeout'),2000);socket.once('connect',()=>{socket.write(password+'\n');setTimeout(()=>{if(!socket.destroyed){socket.write('DSListPlayers\n');sent.push('DSListPlayers');}},150);setTimeout(()=>{if(!socket.destroyed){socket.write('DSServerStatistics\n');sent.push('DSServerStatistics');}},400);});socket.on('data',b=>{bytes+=b.length;if(bytes>65536){clearTimeout(timer);finish('response_limit');return;}chunks.push(b);});socket.once('error',e=>{clearTimeout(timer);finish(e.code);});socket.once('end',()=>{clearTimeout(timer);finish(null);});});}
if(process.argv[2]==='self-test'){
 const sample=Buffer.from('[/Script/Astro.AstroServerSettings]\r\nPublicIP=127.0.0.1\r\nConsolePassword=\r\nOther=preserved\r\n');
 const out=consoleSettings(sample,'a'.repeat(48)).toString();if(!out.includes('ConsolePort=29101\r\n')||!out.includes('Other=preserved\r\n')||!out.includes('ConsolePassword='+'a'.repeat(48)))throw Error('Roundtrip fixture failed');
 for(const bad of [Buffer.from('[other]\n'),Buffer.from('[/Script/Astro.AstroServerSettings]\nConsolePort=1\nConsolePort=2\n')]){let failed=false;try{consoleSettings(bad,'a'.repeat(48));}catch{failed=true;}if(!failed)throw Error('Ambiguity accepted');}console.log(JSON.stringify({fixtures:3,passed:true}));
}else if(process.argv[2]==='run-root-approved-once'){
 const receipt=await verifyRuntime();activeLease(id,'astroneer_native');const queue=JSON.parse(fs.readFileSync('.local/game-parity-20261029/runtime/queue.json'));if(queue.activation_pause||s.rcon_probe)throw Error('Pause or one-trial receipt exists');
 const server=(await api('/api/application/servers/35')).attributes,canonical=profileFromRuntime(s.recipe,receipt).egg.startup;
 if(server.uuid!==uuid||server.node!==1||server.egg!==30||server.container.startup_command!==canonical||(await observePower(s)).current_state!=='offline')throw Error('Exact canonical owned offline fixture required');
 const owned=containers().find(c=>c.Name==='/'+uuid);if(!owned||owned.State.Running)throw Error('Offline owned container required');
 for(const protocol of ['tcp','udp']){const binds=owned.HostConfig.PortBindings[port+'/'+protocol];if(!binds?.some(b=>b.HostIp==='127.0.0.1'&&b.HostPort===String(port)))throw Error('Existing loopback TCP+UDP mapping absent');}
 const free=await new Promise(resolve=>{const c=net.createConnection({host:'127.0.0.1',port});c.once('connect',()=>{c.destroy();resolve(false);});c.once('error',e=>resolve(e.code==='ECONNREFUSED'));c.setTimeout(1000,()=>{c.destroy();resolve(false);});});if(!free)throw Error('Existing TCP port is not proven free');
 const original=await read('AstroServerSettings.ini'),engine=await read('Engine.ini'),password=crypto.randomBytes(24).toString('hex'),lookup=JSON.parse(fs.readFileSync(s.public_ip_probe.lookup_private_path));
 fs.writeFileSync(dir+'/rcon-original.ini',original,{mode:0o600});fs.writeFileSync(dir+'/rcon-engine-original.ini',engine,{mode:0o600});fs.writeFileSync(dir+'/rcon-private-password',password,{mode:0o600});
 const modified=consoleSettings(replaceNativePublicIP(original,lookup.address),password),started=Date.now(),observations=[],probes=[];
 s.rcon_probe={started_at:new Date().toISOString(),original_sha256:digest(original),engine_sha256:digest(engine),canonical_startup:canonical,modified_sha256:digest(modified),max_seconds:90};save();
 let stopped=false,forced=false;
 const power='/api/client/servers/'+uuid+'/power';
 const stopTimer=setTimeout(()=>{stopped=true;api(power,'POST',{signal:'stop'}).catch(()=>{});},80000),killTimer=setTimeout(()=>{forced=true;api(power,'POST',{signal:'kill'}).catch(()=>{});},88000);
 try{
  await write('AstroServerSettings.ini',modified);if(digest(await read('AstroServerSettings.ini'))!==digest(modified))throw Error('Modified settings readback failed');
  await api(power,'POST',{signal:'start'});console.log(JSON.stringify({rcon_trial_started:true,max_seconds:90,existing_loopback_tcp_udp:true}));
  while(Date.now()-started<89000){const powerState=await observePower(s);if(powerState.current_state==='offline'&&Date.now()-started>4000)break;const c=containers().find(x=>x.Name==='/'+uuid&&x.State.Running);if(c&&Date.now()-started>15000){const capture=JSON.parse(docker(['exec',c.Id,'/usr/bin/python3','-B','-c',capturePython]));delete capture.log?.content_base64;observations.push({at:new Date().toISOString(),...capture});const response=await probe(password);probes.push(response);if(response.bytes){fs.writeFileSync(dir+'/rcon-responses-private.json',JSON.stringify(probes,null,2),{mode:0o600});console.log(JSON.stringify({response_bytes:response.bytes,commands:response.commands}));}}await pause(4000);}
 }finally{
  clearTimeout(stopTimer);clearTimeout(killTimer);if((await observePower(s)).current_state!=='offline'){stopped=true;await api(power,'POST',{signal:'stop'});await pause(1500);}if((await observePower(s)).current_state!=='offline'){forced=true;await api(power,'POST',{signal:'kill'});await pause(1000);}if((await observePower(s)).current_state!=='offline')throw Error('Stop before restore required');
  await write('AstroServerSettings.ini',original);await write('Engine.ini',engine);if(digest(await read('AstroServerSettings.ini'))!==digest(original)||digest(await read('Engine.ini'))!==digest(engine))throw Error('Exact INI restoration failed');
  const actual=(await api('/api/application/servers/35')).attributes;if(actual.container.startup_command!==canonical)throw Error('Startup drift');
  const json=[];for(const p of probes)for(const line of p.raw.split(/\r?\n/)){try{const value=JSON.parse(line);if(value&&typeof value==='object')json.push({at:p.at,keys:Object.keys(value),value});}catch{}}
  fs.writeFileSync(dir+'/rcon-private-observations.json',JSON.stringify({observations,probes,json},null,2),{mode:0o600});
  const terminal=containers().find(c=>c.Name==='/'+uuid);
  const outcome={completed_at:new Date().toISOString(),elapsed_ms:Date.now()-started,stop_requested:stopped,forced_kill:forced,ini_exactly_restored:true,canonical_startup_unchanged:true,json_responses:json.map(x=>({at:x.at,keys:x.keys})),probe_errors:probes.map(p=>p.error),native_socket_samples:observations.map(x=>({at:x.at,sockets:x.sockets,native_processes:x.native_processes})),fresh_log:observations.some(x=>x.log.exists),exit:terminal?.State,protocol_reference:'https://github.com/Esinko/AstroneerRconClient#how-it-works',protocol_reference_caveat:'Historical example, not installed; native response required'};
  s.rcon_probe.outcome=outcome;save();const r=JSON.parse(fs.readFileSync(reportFile));r.rcon_diagnostic=outcome;fs.writeFileSync(reportFile,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({terminal:true,elapsed_ms:outcome.elapsed_ms,json_responses:outcome.json_responses,restored:true,forced_kill:forced}));
 }
}else throw Error('Use self-test or root-approved run');
