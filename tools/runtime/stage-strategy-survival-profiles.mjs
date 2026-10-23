import fs from 'node:fs';
const base='internal/panel/game_library/scripts/',catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),existing=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
const add=(egg,name,key,value,rules,description='')=>{if(!egg.variables.some(v=>v.env_variable===key))egg.variables.push({name,env_variable:key,default_value:value,rules,description,user_viewable:true,user_editable:true,field_type:'text'});};
for(const [game,path]of [['cryofall','cryofall/egg-cryo-fall.json'],['avorion','avorion/egg-avorion.json']]){
 const entry=catalog.entries.find(x=>x.path===path),egg=structuredClone(entry.egg),previous=existing[path]||{};
 egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
 egg.docker_images={'Pinned native Debian Steam runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 egg.startup=`exec env ${game==='avorion'?'VOLTRA_NATIVE_LIBRARY_PATH="$LD_LIBRARY_PATH" ':''}PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/${game}_runtime.py`;
 egg.config={files:'{}',startup:JSON.stringify({done:game==='cryofall'?'UDPServer: Socket-server listening on':'Server startup complete'}),logs:'{}',stop:game==='cryofall'?'stop 0':'/stop'};
 if(game==='cryofall'){
  add(egg,'Server name','SERVER_NAME','CryoFall server','required|string|max:64|not_regex:/[\\r\\n\\x00]/');
  add(egg,'Maximum players','MAX_PLAYERS','30','required|integer|between:1,300');
  add(egg,'Public listing','PUBLIC_SERVER','0','required|boolean','Private/LAN by default. Private listing does not itself enforce a player whitelist.');
  add(egg,'Server operators','SERVER_OPERATORS','','nullable|string|max:1024|not_regex:/[\\r\\n\\x00]/','Comma-separated native CryoFall player names, not Steam display names. Empty retains an existing native list; edit XML to clear it.');
  add(egg,'Disallow client modifications','NO_CLIENT_MODS','0','required|boolean','Native no_client_mods switch. Server-side mod and rates files remain operator-owned.');
 }else{
  for(const v of egg.variables){
   if(v.env_variable==='ADMIN_ID'){v.rules='nullable|string|regex:/^([0-9]{17,20})?$/';v.description='Steam64 administrator ID. Empty keeps console-only administration rather than inventing an administrator account.';}
   if(v.env_variable==='GALAXY_NAME')v.rules='required|string|max:32|not_regex:/[\\r\\n\\x00\\/\\\\]/';
   if(v.env_variable==='SERVER_NAME')v.rules='required|string|max:64|not_regex:/[\\r\\n\\x00]/';
   if(v.env_variable==='MAX_PLAYERS'){v.user_editable=true;v.rules='required|integer|between:1,64';}
   if(v.env_variable==='COLLISION_DMG')v.rules='required|numeric|min:0';
   if(v.env_variable==='SAVE_INTERVAL')v.rules='required|integer|between:0,86400';
   if(v.env_variable==='GAME_THREADS')v.rules='required|integer|between:0,20';
   if(v.env_variable==='SERVER_LISTED')v.default_value='false';
   if(['QUERY_PORT','STEAM_MASTER_PORT','STEAM_QUERY_PORT'].includes(v.env_variable)){v.default_value=v.env_variable==='QUERY_PORT'?'27003':'';v.user_editable=true;v.rules='nullable|integer|between:1,65535';v.description=v.env_variable==='QUERY_PORT'?'Native private discovery uses 27003 by default. Select this allocation for private/LAN setup. Changing it while unlisted may prevent clients from finding the server; custom private ports are unverified.':'Empty chooses a distinct additional selected allocation. An explicit value must belong to the selected allocations.';}
  }
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 const files=[['steam-template.py','steam_template.py'],['bundle-debian-python.py','bundle_debian_python.py'],['additional-survival-install.py','additional_survival_install.py'],['native-console.py','native_console.py'],['strategy-survival-install.py','strategy_survival_install.py'],[game+'-runtime.py',game+'_runtime.py']];
 if(game==='avorion')files.push(['private-nss.py','private_nss.py']);
 if(game==='cryofall')files.push(['native-release.py','native-release.py'],['among-us-install.py','among-us-install.py']);
 for(const [source,target]of files)script+=`cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync(base+source,'utf8')}\nVOLTRA_SOURCE\n`;
 if(game==='avorion')script+='python3 -c "import sys;sys.path.insert(0,\'.voltra\');from private_nss import provision;provision(\'/mnt/server\')"\n';
 script+=`python3 .voltra/bundle_debian_python.py\npython3 .voltra/strategy_survival_install.py ${game}\n`;
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 profiles[path]={upstream_sha256:entry.sha256,revision:game+'-native-controls-v2',platforms:['linux/amd64'],required_ports:game==='cryofall'?1:4,port_rules:game==='avorion'?['QUERY_PORT','STEAM_MASTER_PORT','STEAM_QUERY_PORT'].map(environment=>({environment,condition:'nonzero',allocated_value:true,minimum:1,maximum:65535,count:2})):[],defaults:{memory:game==='cryofall'?3072:4096,disk:8192},verification:previous.verification||'not_verified',detail:previous.detail||'Original native controls and typed Steam installation implemented; native world acceptance pending.',egg,setup_steps:game==='cryofall'?[
  'Choose one allocated UDP port. Name, player limit, listing, operators and client-mod restrictions are managed in Data/SettingsServer.xml; other native XML entries, comments and private server GUIDs are retained.',
  'The publisher server requires .NET6. A private Microsoft 6.0.36 runtime is installed and checksum-verified; no machine-wide runtime or privileged container is required. Default startup loadOrNew restores a world or creates one only when no save exists.',
  'Native console commands remain available. Stop sends stop 0 so the native engine saves and exits; do not replace this with a forced kill. Edit advanced world rates, mods and permissions in Data/ while offline.',
  'Private listing does not create a join password. Use the native whitelist controls for access restrictions. Operator names are CryoFall account/player names, not Steam display names.',
  'Back up the complete Data/ folder including saves, settings, rates, mods and icons. Reinstall preserves known native configuration while the Steam install retains generated world data. No startup command wipes an existing world.',
 ]:[
  'Choose four available allocations on the same address: gameplay, native query, Steam master and Steam query. Empty secondary-port controls derive distinct allocations; explicit choices remain available. The publisher warns that changing the native query port from 27003 while unlisted can prevent clients from finding this server; custom private-port connectivity is not yet verified.',
  'Every original gameplay control remains available: galaxy, administrator Steam64 ID, slots, difficulty, collision damage, save interval, starting-sector behavior, threads, listing, library path and public/beta Steam branch. Values are passed as argument tokens rather than shell fragments.',
  'Galaxy data is stored under galaxy/<GalaxyName>/. Native server.ini, administrators, mods and other galaxy files remain editable through Files while offline; the launcher does not download a replacement server.ini.',
  'Use native slash commands in Console. Stop sends /stop; native saving/reload is accepted separately from player gameplay. Empty Admin ID permits console-only setup; supply your own Steam64 ID for in-game administration.',
  'Back up galaxy/ and .avorion/backups/ completely. Typed Steam updates preserve native galaxy configuration and generated world files. Public listing is off by default; a private listing is not a password or authentication guarantee.',
 ]};
}
fs.mkdirSync('.local/strategy-survival-games',{recursive:true});fs.writeFileSync('.local/strategy-survival-games/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('CryoFall and Avorion staged; native acceptance and shared catalog promotion remain separate.');
