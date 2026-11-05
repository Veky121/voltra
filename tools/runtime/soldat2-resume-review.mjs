import fs from 'node:fs';
import path from 'node:path';
import {verifyRuntime,profileFromRuntime,claimNative,digest} from './campaign-native-20261029.mjs';
const dir='artifacts/game-parity-20261029/soldat2-resume';fs.mkdirSync(dir,{recursive:true});
const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2)+'\n');
const recipe='soldat_2/egg-soldat2.json';
// Read the definitive receipt at admission, rather than polling startup state.
const foundation=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/resume-wave1-foundation.json'));
if(foundation.status!=='foundation-ready')throw Error('Foundation not ready');
const runtime=await verifyRuntime(),profile=profileFromRuntime(recipe,runtime);
const files=['internal/panel/game_library/scripts/soldat-native.py','internal/panel/game_library/scripts/soldat2-lifecycle.cs','internal/panel/game_library/scripts/soldat2-modifier.mjs'];
const identities=files.map(file=>({file,current:digest(fs.readFileSync(file)),embedded_in_served_installer:profile.egg.scripts.installation.script.replaceAll('\r\n','\n').includes(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'))}));
save('identity.json',{at:new Date().toISOString(),recipe,runtime,revision:profile.revision,identities});
try{const response=await fetch('https://dl.thd.vg/soldat2-linuxserver-release.tar.gz',{method:'HEAD',signal:AbortSignal.timeout(20000)});save('publisher-head.json',{at:new Date().toISOString(),url:response.url,status:response.status,headers:Object.fromEntries(['content-length','last-modified','etag','content-type'].map(k=>[k,response.headers.get(k)])),body_acquired:false});}catch(e){save('publisher-head.json',{error:e.message,body_acquired:false});}
try{const lease=claimNative({owner:'soldat2_resume_owner',game:recipe,memory_mib:1024,disk_mib:4096,ports:2});save('admission.json',{status:'leased',lease});}catch(e){save('admission.json',{status:'blocked',error:e.message,fixture_created:false});}
// Scoped fragment only. Root owns canonical overrides and native admission plan.
save('metadata-fragment.json',{recipe,revision:profile.revision,defaults:profile.defaults,platforms:['linux/amd64'],native_documents:[{path:'/autoconfig.ini',label:'General settings',stopped_only:true}],folder_links:['/Levels','/Rules','/Modifiers','/Cycles','/Scripts'],authority:'Startup owns Name/Port/WebSocketsPort/WebSocketsRconPort/MaxPlayers/ServerPassword/RconPassword/GreetMessage/AdminPlayfabId/VisibleInGamesList; other native values remain operator-owned',sources:['https://wiki.soldat2.com/index.php?title=Server_Hosting','https://soldat2.com/docs/class_game_server_config.html'],resources:{publisher:'1 x86_64 vCPU and 512 MB for up to 8 players; glibc Linux',creation:'Retain measured 1024 MiB RAM and 4096 MiB disk default; no published disk recommendation found'},ports:{primary:'TCP/UDP publisher documented default 33073',rcon:'Optional separate allocated TCP WebSocket port, keep private',websocket_gameplay:'0.8.71.A accepts configuration but prior native test found no listener'}});
console.log(JSON.stringify({identities,admission:JSON.parse(fs.readFileSync(path.join(dir,'admission.json')))}));
