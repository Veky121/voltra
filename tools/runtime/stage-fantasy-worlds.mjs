import fs from 'node:fs';
import crypto from 'node:crypto';
const base='internal/panel/game_library/scripts/';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const definitions=[
 ['citadel','citadel/egg-citadel-forged-with-fire.json',6144,16384],
 ['portal','portal_knights/egg-portal-knights.json',2048,8192],
 ['solace','solace_crafting/egg-solace-crafting.json',2048,8192],
];
const original=Object.fromEntries(definitions.map(([game,path])=>[game,catalog.entries.find(e=>e.path===path)]));
for(const[game]of definitions)if(!original[game])throw Error('Missing canonical recipe '+game);
const install=game=>original[game].egg.scripts.installation.script.replaceAll('\r\n','\n');
const citadel=install('citadel').match(/cat[^\n]*<<\s*EOT[^\n]*\n([\s\S]*?)\nEOT/);
const solace=install('solace').match(/cat[^\n]*<<\s*EOT[^\n]*\n([\s\S]*?)\nEOT/);
if(!citadel||!solace)throw Error('Original native configuration seed changed; review extraction');
const role=(password,canLogin,canKickPlayers,canModifyWorld,canInteractWithLockables)=>({credentials:{password},canLogin,canKickPlayers,canModifyWorld,canInteractWithLockables});
const defaults={citadel_game_ini:citadel[1]+'\n',solace:JSON.parse(solace[1]),portal:{
 basicServerData:{name:'Servername',ipv4:'0.0.0.0',port:16365,saveFolderPath:'./savedata'},universeSize:'Normal',hideConsoleWindow:false,
 admins:role('admin_password_please_change',true,true,true,true),users:role('',true,false,true,true),guests:role('',false,false,false,false),gameplayMode:'Adventure',
}};
fs.writeFileSync(base+'fantasy-worlds-defaults.json',JSON.stringify(defaults,null,2)+'\n');
const sources=['steam-template.py','native-config.py','native-console.py','fantasy-worlds-runtime.py','fantasy-worlds-install.py','fantasy-worlds-defaults.json','fantasy-worlds-wine.py','fantasy-worlds-wine-build.py','fantasy-worlds-wine-console.c'];
const hashes=Object.fromEntries(sources.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(base+name)).digest('hex')]));
const profiles={};
for(const[game,path,memory,disk]of definitions){
 const entry=original[game],egg=structuredClone(entry.egg);
 egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template',...(game==='portal'?['voltra_typed_wine']:[])])];
 egg.variables.push({name:'Owned display supervision',description:'The image-wide Xvfb launcher is disabled. Portal uses a private owned display; Linux dedicated servers run headless.',env_variable:'XVFB',default_value:'0',user_viewable:false,user_editable:false,rules:'required|in:0',field_type:'text'});
 egg.docker_images={[game==='portal'?'Pinned Wine base; private display and console':'Pinned Linux Steam base']:'ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8'};
 egg.startup='exec python3 .voltra/fantasy_worlds_runtime.py '+game;
 egg.config={files:'{}',startup:JSON.stringify({done:game==='portal'?'VOLTRA_PORTAL_READY':JSON.parse(entry.egg.config.startup).done}),logs:'{}',stop:'^C'};
 if(game==='solace')egg.variables.push({name:'Steam query port',description:'Blank chooses a distinct selected additional allocation. Original servercfg.dat permissions, worlds and administrator controls stay editable through Files.',env_variable:'QUERY_PORT',default_value:'',user_viewable:true,user_editable:true,rules:'nullable|integer|between:1025,65535',field_type:'text'});
 if(game==='portal'){
  for(const variable of egg.variables)if(['STEAM_USER','STEAM_PASS'].includes(variable.env_variable))variable.rules=variable.rules.replace(/^required(?=\|)/,'required_if:PORTAL_INSTALL_MODE,steam');
  egg.variables.push({name:'Installation source',description:'steam retains the original licensed client-depot installation and fails closed for private Steam transport. uploaded uses your own legal dedicated_server.zip or extracted dedicated_server directory, prepares the private console bridge and makes no Steam download. Steam credentials are unused in uploaded mode; no dummy values are required.',env_variable:'PORTAL_INSTALL_MODE',default_value:'steam',user_viewable:true,user_editable:true,rules:'required|string|in:steam,uploaded',field_type:'text'});
 }
 let script='#!/bin/bash\nset -euo pipefail\ncd /mnt/server\nmkdir -p .voltra\n';
 for(const source of sources)script+=`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_FANTASY_SOURCE'\n${fs.readFileSync(base+source,'utf8')}\nVOLTRA_FANTASY_SOURCE\n`;
 script+='export DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\n';
 script+='python3 .voltra/fantasy_worlds_install.py '+game+'\n';
 egg.scripts.installation={container:'mcr.microsoft.com/dotnet/sdk@sha256:8dd1a57fe6b7b8b1b357635db67e272c2f9e9d76d1dd0a32711c4c33c57d7b43',entrypoint:'bash',script};
 profiles[path]={revision:game+'-fantasy-worlds-v1',upstream_sha256:entry.sha256,platforms:['linux/amd64'],verification:'not_verified',defaults:{memory,disk},required_ports:game==='portal'?1:2,
  port_rules:game==='portal'?[]:[{environment:game==='citadel'?'QPORT':'QUERY_PORT',condition:'nonzero',allocated_value:true,auto_allocate:game==='solace',exclude_primary:true,minimum:1025,maximum:65535,count:2}],egg,
  detail:'Source adapter and bounded offline fixtures only. Native install, console shutdown, connectivity, saves and gameplay remain unverified. '+(game==='portal'?'Licensed Steam client depot is required. Private Steam login fails closed; operator-acquired legal files can run with AUTO_UPDATE=0.':'Public anonymous Steam installation follows the original application ID; current publisher depot availability remains unverified.'),
  setup_steps:[
   'Choose a Linux amd64 node. Memory and disk defaults are initial estimates, not measured native requirements. Install and runtime payloads remain subject to the publisher license.',
   game==='citadel'?'Allocate game UDP and the original locked QPORT=27015 separately. The query default is preserved exactly and is never silently remapped. Config/Game.ini, native Engine.ini port matching, world settings and saved games are retained.':game==='solace'?'Allocate game and a distinct query port. Existing servercfg.dat and Worlds remain authoritative for privacy, Steam IDs, administrator/moderator rights, world selection and restart settings. Historical publisher documentation lists some controls as inactive; current native support is pending.':'Use your own licensed Portal Knights dedicated_server.zip or extracted dedicated_server directory. Steam account transport remains blocked; upload legal files and disable AUTO_UPDATE. Original role permissions and custom confined save folder stay intact.',
   game==='portal'?'Portal runs with hideConsoleWindow=false inside a private Xvfb display. A source-verified MIT helper addresses only the exact owned executable PID for input and Ctrl+C. Compiler receipt and private Wine architecture must match. Native Windows API and save-on-shutdown behavior still require acceptance.':'Console input and Ctrl+C use the shared native PTY. Native stop, save-on-shutdown and listing behavior still require acceptance.',
   'Unknown native configuration, custom content and saves are preserved. Unsafe links, altered program collisions, invalid controls or unverified private credentials fail explicitly. No bundled copyrighted game/client/module assets.',
  ]};
}
fs.mkdirSync('.local/fantasy-worlds',{recursive:true});
fs.writeFileSync('.local/fantasy-worlds/profiles.json',JSON.stringify(profiles,null,2)+'\n');
fs.writeFileSync('.local/fantasy-worlds/source-hashes.json',JSON.stringify(hashes,null,2)+'\n');
console.log('Staged exact three fantasy-world profiles; canonical overrides untouched.');
