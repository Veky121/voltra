import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),profiles={};
const previous=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const image='ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b';
for(const [path,game] of [['openrct2/egg-openrct2.json','openrct2'],['cs2d/egg-c-s2-d.json','cs2d']]){
 const entry=catalog.entries.find(e=>e.path===path),egg=structuredClone(entry.egg);
 egg.docker_images={'Debian12 native runtime':image};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/small-native-runtime.py ${game}`;
 if(game==='openrct2')egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/openrct2-runtime.py';
 egg.config={files:'{}',startup:JSON.stringify({done:game==='openrct2'?'Listening for clients on':'----- Server started -----'}),logs:'{}',stop:'^C'};
 for(const v of egg.variables){
  if(game==='openrct2'&&v.env_variable==='VERSION')v.default_value='v0.5.6';
  if(game==='openrct2'&&v.env_variable==='SERVER_ADVERTISE')v.default_value='false';
  if(v.env_variable==='SERVER_PLAYERS'){v.rules='required|integer|between:1,32';v.user_editable=true;}
  if(v.env_variable==='MAX_PLAYERS')v.rules='required|integer|between:1,255';
  if(v.env_variable==='AUTOSAVE_AMOUNT')v.rules='required|integer|between:0,10000';
  if(['SERVER_NAME','SERVER_PASSWORD','SERVER_DESCRIPTION','SERVER_PLAYER_NAME','SERVER_GREETING','PROVIDER_NAME','PROVIDER_EMAIL','PROVIDER_WEBSITE'].includes(v.env_variable))v.rules+=(v.rules.includes('not_regex')?'':'|not_regex:/[\\x00-\\x1f\\x7f]/');
  if(game==='cs2d'&&['SERVER_NAME','SERVER_PASSWORD'].includes(v.env_variable)){v.rules+='|not_regex:/[\"]/';v.description+=' Native CS2D text does not support quotation marks.';}
 }
 const additions=game==='cs2d'?[
  ['Map','SERVER_MAP','Native map basename. Upload custom .map files to cs2d/maps.','de_dust2','required|string|max:100|regex:/^[A-Za-z0-9 _-]+$/'],
  ['Public listing','PUBLIC_SERVER','Enable U.S.G.N. registration. Off uses native LAN mode.','0','required|boolean'],
  ['Game mode','GAME_MODE','0 standard,1 deathmatch,2 team deathmatch,3 construction,4 zombies,5 capture the flag.','0','required|integer|between:0,5'],
  ['Bots','BOT_COUNT','Native bot count.','0','required|integer|between:0,32'],
  ['RCON password','RCON_PASSWORD','Native administrator password without quotation marks. Empty generates a private persistent credential under .voltra/cs2d/rcon-password.','','nullable|string|max:64|not_regex:/["\\x00-\\x1f\\x7f]/'],
 ]:[['Original game data path','RCT2_DATA_PATH','Optional relative path to your legally owned original RCT2 assets. Upload your files through Files when your park requires them. No original game data is distributed by this installer.','','nullable|string|max:255']];
 for(const [name,key,description,value,rules] of additions)egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
 // The shared Debian runtime image also supports Steam games; these native
 // publishers must never invoke its unrelated legacy Steam updater.
 egg.variables.push({name:'Native publisher runtime',env_variable:'AUTO_UPDATE',description:'Native release installation owns updates.',default_value:'0',rules:'required|in:0',user_viewable:false,user_editable:false,field_type:'text'});
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\nmkdir -p .voltra\n';
 for(const name of ['small-native-install.py','small-native-runtime.py','native-release.py','native-config.py','native-console.py','bundle-debian-python.py'])script+=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')}\nVOLTRA_SOURCE\n`;
 if(game==='cs2d')script+=`cat > .voltra/cs2d-console.lua <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/cs2d-console.lua','utf8')}\nVOLTRA_SOURCE\n`;
 if(game==='openrct2')script+=`cat > .voltra/openrct2-runtime.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/openrct2-runtime.py','utf8')}\nVOLTRA_SOURCE\n`;
 script+=`cat > .voltra/steam_template.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/steam-template.py','utf8')}\nVOLTRA_SOURCE\n`;
 script+=`python3 .voltra/bundle-debian-python.py\npython3 .voltra/small-native-install.py ${game}\n`;
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 profiles[path]={upstream_sha256:entry.sha256,revision:game+'-native-v1',platforms:['linux/amd64'],defaults:{memory:game==='openrct2'?1024:512,disk:4096},egg,verification:previous[path]?.verification??'not_verified',detail:previous[path]?.detail??'Implementation staged; native runtime acceptance pending.',setup_steps:game==='openrct2'?[
  'A starter park from the pinned original recipe is installed only when missing. Choose another compatible .park, .sv6 or .sv4 saved game through Files and set Save File. The dedicated server cannot generate a new park. Original RCT game assets are not included; upload legally owned files and set Original game data path when your chosen park requires them. The reviewed headless starter park runs without original RCT graphics.',
  'Version defaults to reviewed0.5.6. Other release tags and latest resolve official checksum-addressed AppImages. Develop builds the current upstream source and needs additional installation time; only explicitly tested releases have runtime evidence.',
  'Keep ServerData, including saves, autosaves, users, groups, plugins and config.ini. The launcher preserves unrelated INI settings with private backups; the native engine may rewrite its own config format. Load Latest Autosave selects the newest actual saved-game file.',
  'Private listing is the default. Connect using a compatible OpenRCT2 client to the allocated TCP port. Console uses the native JavaScript REPL in a private terminal. Use console.executeLegacy("save_park name") for legacy native commands. Native game mutations use context.executeAction; direct JavaScript setters can be read-only. Stop saves the current park and requests native quit.',
 ]:[
  'Official CS2D1.0.1.8 x64 client assets and dedicated binary are installed without Steam credentials. Start from Console and connect using a matching client to the allocated UDP port. Listing is private by default.',
  'Keep cs2d/sys, maps, mods, Lua scripts, bans and custom assets. Managed server.cfg settings retain comments and unrelated commands; modified publisher files are retained during reinstall.',
  'The dashboard console uses a marked MIT adapter under cs2d/sys/lua/autorun/voltra-console.lua, forwarding commands through the publisher-native Lua parse API. Existing operator server.lua and autorun scripts remain intact. Stop requests native quit through the same private mailbox; do not remove the adapter while the server is running.',
  'Native in-game RCON remains available separately. Read the generated RCON credential privately under .voltra/cs2d/rcon-password. Back up native scripts, bans and your custom game content. No client join is implied by a query or console test.',
 ]};
}
fs.mkdirSync('.local/small-games',{recursive:true});fs.writeFileSync('.local/small-games/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Small-game profiles staged separately from catalog overrides.');
