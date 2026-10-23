import fs from 'node:fs';
const path='openarena/egg-open-arena.json',entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===path);
const file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file)),egg=structuredClone(entry.egg);
egg.description+=' Pinned publisher 0.8.8 package with checked HTTPS download, native console, private-server readiness and preserved operator files. Uses the unmodified bundled Linux dedicated engine.';
egg.docker_images={'Ubuntu 24.04':'ghcr.io/ptero-eggs/yolks@sha256:85cc85e658366d2398288b1f829a4bab4de2d02a3bea4193f8d502db7b2dd29b'};
egg.startup='exec python3 .voltra/openarena_runtime.py';
egg.config={files:'{}',startup:JSON.stringify({done:'OpenArena native UDP server ready'}),logs:'{}',stop:'quit'};
egg.variables[0].rules='required|string|max:63|regex:/^[A-Za-z0-9_-]+$/';
egg.variables[0].description='Native map basename without .bsp. The launcher checks loose maps and PK3 packages before starting. Default aggressor remains unchanged.';
for(const [name,key,description,value,rules]of [
 ['Server name','SERVER_NAME','Native server-info text, up to 255 UTF-8 bytes. Double quotes, backslashes, semicolons and line breaks are unsupported by this engine.','OpenArena server','required|string|max:255|not_regex:/["\\\\;\\r\\n\\x00]/'],
 ['Maximum players','MAX_PLAYERS','Maximum connected clients, including bots.','16','required|integer|between:1,64'],
 ['Game type','GAME_TYPE','Native number: 0 FFA, 1 duel, 3 team DM, 4 CTF, 5 one-flag CTF, 6 overload, 7 harvester, 8 elimination, 9 CTF elimination, 10 LMS, 11 double domination, 12 domination, 13 possession. Maps must support the selected mode. Single-player mode 2 is not a network server mode.','0','required|integer|in:0,1,3,4,5,6,7,8,9,10,11,12,13'],
 ['Minimum players','MIN_PLAYERS','Native bot_minplayers fills empty slots with bots. Must not exceed maximum players. Zero disables automatic fill.','0','required|integer|between:0,64'],
 ['Public listing','PUBLIC_SERVER','Private LAN dedicated server by default. Enable Internet dedicated mode to request native public master registration. Direct UDP connections work in either mode.','0','required|boolean'],
 ['Game folder','GAME_MOD','Bundled base game or missionpack. Native server.cfg and custom PK3 packages remain supported.','baseoa','required|string|in:baseoa,missionpack'],
 ['Server password','SERVER_PASSWORD','Native join password, up to 127 UTF-8 bytes. Native user-info strings cannot contain double quotes, backslashes, semicolons or line breaks. Empty permits passwordless joins.','','nullable|string|max:127|not_regex:/["\\\\;\\r\\n\\x00]/'],
 ['RCON password','RCON_PASSWORD','Native RCON password, up to 127 UTF-8 bytes. Empty generates .voltra/openarena/rcon-password with private permissions. Double quotes and line breaks are unsupported.','','nullable|string|max:127|not_regex:/["\\r\\n\\x00]/'],
])egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends ca-certificates python3\nmkdir -p .voltra\n';
for(const [source,name]of [['native-release.py','native_release.py'],['native-zip-release.py','native_zip_release.py'],['openarena-install.py','openarena_install.py'],['openarena-runtime.py','openarena_runtime.py']])script+=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SOURCE\n`;
script+='python3 .voltra/openarena_install.py\n';
egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
const previous=profiles[path]||{};
profiles[path]={upstream_sha256:entry.sha256,revision:'openarena-0.8.8-native-v1',platforms:['linux/amd64'],defaults:{memory:512,disk:4096},egg,verification:previous.verification||'not_verified',detail:previous.detail||'Native ZIP installation and setup under review; live acceptance pending.',setup_steps:[
 'Start from Console after installation and connect to the allocated UDP address with an OpenArena 0.8.8 client. The default is a private LAN dedicated server. Readiness is checked locally without public master registration.',
 'The engine/data are under openarena. Writable native home data is openarena/userdata. Put server.cfg, custom PK3 files, loose maps and logs under the active userdata/baseoa or userdata/missionpack folder.',
 'server.cfg loads before managed settings. The form controls map, game type, player/bot counts, listing, name and passwords. Other native tuning, map rotation, pure/download rules, bans and mod settings stay configurable through Files and Console.',
 'This native console parser cannot escape embedded double quotes. Server-info strings also reject backslashes and semicolons. The form rejects those values instead of silently changing them.',
 'Stop sends native quit. Generated RCON credentials and the managed configuration have private permissions. Keep native RCON limited to trusted networks when using the original protocol.',
 'Back up the complete volume, especially openarena/userdata, custom packages/configuration and .voltra/openarena/rcon-password. Reinstall retains operator files and modified stock assets; managed replacements are backed up under .voltra/openarena/previous-*.',
]};
fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');console.log('OpenArena profile generated; live native acceptance remains separate.');
