import fs from 'node:fs';
import path from 'node:path';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const destination=process.argv[2]||'.local/source-games/profiles.json';
const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profiles={};
for(const [recipe,app,game,map] of [
 ['counter_strike/counter_strike_source/egg-counter--strike--source.json','232330','cstrike','de_dust2'],
 ['team_fortress_2/egg-team-fortress-2.json','232250','tf','ctf_2fort'],
 ['half_life_2_deathmatch/egg-half--life2--deathmatch.json','232370','hl2mp','dm_lockdown'],
 ['fof/egg-fof.json','295230','fof','fof_revenge'],
 ['black_mesa/egg-black-mesa.json','346680','bms','dm_crossfire'],
 ['nmrih/egg-nmrih.json','317670','nmrih','nms_northway'],
 ['left4dead/egg-left4dead.json','222840','left4dead','l4d_hospital01_apartment'],
 ['left4dead_2/egg-left4dead_2.json','222860','left4dead2','c1m1_hotel'],
 ['iosoccer/eggs-iosoccer.json','673990','iosoccer','8v8_vienna'],
]){
 const entry=catalog.entries.find(e=>e.path===recipe),egg=structuredClone(entry.egg);
 const variant=!['cstrike','tf'].includes(game),l4d=game==='left4dead'||game==='left4dead2';
 const nameKey=game==='hl2mp'?'SERVER_NAME':'HOSTNAME',mapKey=game==='hl2mp'?'MAP_NAME':game==='iosoccer'?'MAP':'SRCDS_MAP';
 const maxKey=game==='iosoccer'?'SLOTS':'MAX_PLAYERS',rconKey=game==='iosoccer'?'RCON':'RCON_PASSWORD';
 const capacities={cstrike:64,tf:128,hl2mp:20,fof:32,bms:128,nmrih:8,left4dead:8,left4dead2:8,iosoccer:64};
 const disks={cstrike:8192,tf:32768,hl2mp:8192,fof:8192,bms:32768,nmrih:16384,left4dead:16384,left4dead2:32768,iosoccer:8192};
 const playerDefault=entry.egg.variables.find(v=>v.env_variable===maxKey)?.default_value||(game==='nmrih'?'8':'24');
 egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
 egg.docker_images={'Debian Steam runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/'+(variant?'source_variant_runtime.py':'source_runtime.py');
 egg.config={files:'{}',startup:JSON.stringify({done:l4d?'VOLTRA_L4D_MAP_READY':'Server is hibernating'}),logs:'{}',stop:'quit'};
 let controls=[
  ['Server name',nameKey,'Native server browser name.',game==='tf'?'A Pterodactyl Hosted TF2 Server':entry.egg.variables.find(v=>v.env_variable===nameKey)?.default_value||entry.egg.name+' server','required|string|max:128|not_regex:/[\\x00-\\x1f\\x7f"\\\\;]/'],
  ['Map',mapKey,'Native installed map name. Custom maps remain in the game maps directory.',map,'required|string|max:128|regex:/^[A-Za-z0-9_\\/-]+$/'],
  ['Maximum players',maxKey,'Native player limit.',playerDefault,`required|integer|between:1,${capacities[game]}`],
  ['Server password','SERVER_PASSWORD','Empty allows joining without a password.','','nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f"\\\\;]/'],
  ['RCON password',rconKey,'Empty disables remote administration.','','nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f"\\\\;]/'],
  ['Internet mode','PUBLIC_SERVER','Disabled selects native LAN mode. Internet registration and authentication require reachable ports and, for CS:S, a GSLT for game AppID 240.','0','required|boolean'],
  ['Client port','SRCDS_CPORT','Zero automatically selects an additional allocated port. An explicit value must be a distinct allocation.','0','required|integer|between:0,65535'],
  ['SourceTV port','SRCDS_STV','Zero automatically selects another additional allocated port. Reserved even when SourceTV is disabled.','0','required|integer|between:0,65535'],
  ['Enable SourceTV','TV_ENABLE','Native spectator relay. Keep disabled unless needed.','0','required|boolean'],
  ['Automatic updates','AUTO_UPDATE','Typed Steam helper updates on startup; the panel disables the image legacy updater.','0','required|boolean'],
  ['Steam branch','SRCDS_BETAID','Empty selects public. Stop and back up custom files before switching branches.','','nullable|string|max:64|regex:/^[A-Za-z0-9_.-]+$/'],
  ['Beta password','SRCDS_BETAPASS','Only required for a protected publisher branch.','','nullable|string|max:128'],
 ];
 if(variant)controls.push(['Game server login token','STEAM_GSLT','Optional native game-server login token. LAN mode does not need one.','','nullable|string|max:128|regex:/^[A-Za-z0-9]+$/']);
 if(game==='hl2mp')controls.push(['Tick rate','TICK_RATE','Native -tickrate launch option retained from the original recipe. Engine support depends on the selected publisher build.','66','required|integer|between:10,128']);
 if(game==='iosoccer')controls.push(
  ['Tick rate','TICKRATE','Original native IOsoccer tick-rate control.','100','required|integer|between:10,128'],
  ['FPS limit','MAX_FPS','Original native fps_max control. Zero disables the limit.','500','required|integer|between:0,1000']);
 if(l4d){
  controls=controls.filter(c=>!['MAX_PLAYERS','TV_ENABLE','SRCDS_STV'].includes(c[1]));
  controls.find(c=>c[1]==='SRCDS_CPORT')[2]='Optional outgoing client-port setting, retained for compatibility. Zero keeps the native default. Dedicated game/query/RCON share the primary allocation; this setting does not need another host allocation.';
  controls.push(
   ['Game mode','GAMEMODE','Native mode determines player capacity. Change map or restart after changing mode.','coop','required|string|in:'+(game==='left4dead'?'coop,versus,survival':'coop,versus,survival,realism,scavenge,teamversus,teamscavenge')],
   ['Installed mutation','CUSTOM_GAMEMODE','Optional native mutation or custom-mode ID, overriding Game mode. The corresponding publisher/mod mode must be installed.','','nullable|string|max:64|regex:/^[A-Za-z0-9_]+$/'],
   ['Difficulty','DIFFICULTY','Impossible is the native name for Expert difficulty.','Normal','required|string|in:Easy,Normal,Hard,Impossible'],
   ['Lobby connections only','LOBBY_ONLY','Disabled allows native direct connections to your server address.','0','required|boolean']);
 }
 for(const [name,key,description,value,rules] of controls){
  const v=egg.variables.find(v=>v.env_variable===key);
  const fields={name,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'};
  if(v)Object.assign(v,fields);else egg.variables.push({env_variable:key,...fields});
 }
 for(const v of egg.variables){
  if(v.env_variable==='SRCDS_APPID')v.rules=`required|string|in:${app}`;
  if(v.env_variable==='SRCDS_GAME')v.rules=`required|string|in:${game}`;
  if(['STEAM_TOKEN','STEAM_GSLT'].includes(v.env_variable))v.rules='nullable|'+(game==='cstrike'?'required_if:environment.PUBLIC_SERVER,1|':'')+'string|max:128|regex:/^[A-Za-z0-9]+$/';
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 for(const [source,target] of [['steam-template.py','steam_template.py'],['source-install.py','source_install.py'],['bundle-debian-python.py','bundle_debian_python.py'],['native-console.py','native_console.py'],['source-runtime.py','source_runtime.py']])script+=`cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SOURCE\n`;
 if(variant)script+=`cat > .voltra/source_variant_runtime.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/source-variant-runtime.py','utf8')}\nVOLTRA_SOURCE\n`;
 if(l4d)script+=`cat > .voltra/source_l4d.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/source-l4d.py','utf8')}\nVOLTRA_SOURCE\n`;
 script+=`python3 .voltra/bundle_debian_python.py\nPYTHONPATH=.voltra python3 - <<'VOLTRA_INSTALL'\nfrom pathlib import Path\nfrom source_install import update\nupdate(Path.cwd(),${app},required=('${app==='673990'?'srcds_run_64':'srcds_run'}',))\nVOLTRA_INSTALL\n`;
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 profiles[recipe]={upstream_sha256:entry.sha256,revision:'source-native-v1',platforms:['linux/amd64'],required_ports:l4d?1:3,defaults:{memory:4096,disk:disks[game]},egg,verification:current[recipe]?.verification||'not_verified',detail:current[recipe]?.detail||'Typed Source setup implemented; native publisher acceptance pending.',setup_steps:[
  l4d?'Choose a Linux x64 node with one free game port. Gameplay/query and native RCON share the primary allocation. Native mode determines player slots; SourceTV is not exposed.':'Choose a Linux x64 node with three free ports on one address. Gameplay/query uses the primary port; client and SourceTV ports select additional allocations automatically.',
  'LAN is the default. Internet mode requires network reachability; CS:S requires a game-server login token created for game AppID 240.',
  l4d?`Keep advanced configuration in ${game}/cfg/server.cfg. An idempotent marked footer preserves your original bytes and file permissions, then loads setup form settings on each map. Readiness requires a native map query matching the requested map, name and password flag.`:`Keep advanced configuration in ${game}/cfg/server.cfg. The managed wrapper executes it first and reapplies only setup form settings on each map.`,
  `Custom maps, addons and configuration remain under ${game}. Back up those directories before updates; Steam validation may replace modified publisher files.`,
  'Existing native CFG, RC, INI and VDF files, files inside configuration directories, map cycles, MOTDs and gameinfo are preserved byte-for-byte through Steam validation, including failed updates. Review publisher configuration changes manually when keeping an older configuration.',
  'Console input reaches the native server. Stop sends quit. These session-based shooters do not have a world-save operation; plugin persistence is owned by the plugin.',
 ]};
}
fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(profiles,null,2)+'\n');
console.log(`Staged ${Object.keys(profiles).length} Source profiles at ${destination}`);
