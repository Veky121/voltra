import fs from 'node:fs';
const path='teeworlds/egg-teeworlds.json',entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===path);
const file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file)),egg=structuredClone(entry.egg);
egg.description+=' Pinned 0.7.5 with a marked native stdin console adapter. Preserves native UDP RCON, external console, custom maps and configuration. Private server by default.';
egg.docker_images={'Ubuntu 24.04':'ghcr.io/ptero-eggs/yolks@sha256:85cc85e658366d2398288b1f829a4bab4de2d02a3bea4193f8d502db7b2dd29b'};
egg.startup='exec python3 .voltra/teeworlds-runtime.py';
egg.config={files:'{}',startup:JSON.stringify({done:'Voltra native console ready'}),logs:'{}',stop:'shutdown'};
for(const v of egg.variables){v.rules='nullable|string|max:'+(v.env_variable==='SERVER_NAME'?'127':'899')+'|not_regex:/[\\r\\n\\x00]/';v.description+=' Native UTF-8 byte limit: '+(v.env_variable==='SERVER_NAME'?'127':'899')+'. Quotes, semicolons and backslashes are literal text. Use a literal \\n for native MotD line breaks.';}
for(const [name,key,description,value,rules] of [
 ['Map','SERVER_MAP','Map basename without .map. Stock maps are under data/maps. Upload custom .map files to maps through Files.','dm1','required|string|max:100|regex:/^[A-Za-z0-9 _-]+$/'],
 ['Game type','GAME_TYPE','Native game mode. Match the selected map to its game type.','dm','required|string|in:dm,tdm,ctf,lms,lts'],
 ['Maximum players','MAX_PLAYERS','Native maximum connected clients, including spectators.','16','required|integer|between:1,64'],
 ['Public listing','PUBLIC_SERVER','Enable master-server registration. Off keeps the server private without changing direct connections.','0','required|boolean'],
 ['Server password','SERVER_PASSWORD','Join password. Empty allows joins without a password. Maximum 31 UTF-8 bytes.','','nullable|string|max:31|not_regex:/[\\r\\n\\x00]/'],
 ['RCON password','RCON_PASSWORD','Native administrator RCON password, maximum 31 UTF-8 bytes. Empty generates a credential retained privately in .voltra/teeworlds-rcon-password.','','nullable|string|max:31|not_regex:/[\\r\\n\\x00]/'],
])egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends ca-certificates python3 cmake ninja-build g++ zlib1g-dev libssl-dev\nmkdir -p .voltra\n';
for(const name of ['teeworlds-install.py','teeworlds-runtime.py','teeworlds-console.cpp.inc'])script+=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')}\nVOLTRA_SOURCE\n`;
script+='python3 .voltra/teeworlds-install.py\n';
egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
const previous=profiles[path]||{};
profiles[path]={upstream_sha256:entry.sha256,revision:'teeworlds-0.7.5-console-v1',platforms:['linux/amd64'],defaults:{memory:512,disk:2048},egg,verification:previous.verification||'not_verified',detail:previous.detail||'Implementation under review; live runtime acceptance pending.',setup_steps:[
 'Start from Console after installation. Use a compatible Teeworlds 0.7 client and connect directly to the allocated UDP address. Private servers do not need a master-server heartbeat to become ready.',
 'Select a map and native game type. Upload custom .map files to maps through Files. Native map rotation, tuning, votes, moderator RCON and external console remain configurable in autoexec.cfg.',
 'The form supplies the managed name, MotD, port, map, mode, player limit, listing and passwords after autoexec.cfg. Quotes and punctuation remain literal values. Password and display-name limits are native UTF-8 byte limits.',
 'Use native Console commands, including status, change_map, record, stoprecord and shutdown. Stop sends native shutdown, allowing demo recordings to close normally.',
 'Back up autoexec.cfg, storage.cfg, maps, demos and .voltra/teeworlds-rcon-password. Reinstall preserves existing maps, configuration, generated credentials and recordings. Existing storage.cfg is never replaced.',
 'The engine includes a marked stdin adapter executed on the native server thread. Upstream source, licenses and the adapter remain under .voltra. Other platforms and game versions require separate review.',
]};
fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');console.log('Teeworlds profile generated; native runtime acceptance remains separate.');
