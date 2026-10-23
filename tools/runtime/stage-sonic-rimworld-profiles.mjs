import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),existing=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),base='internal/panel/game_library/scripts/',profiles={};
const games={sonic:'sonic_robo_blast_2/egg-sonic-robo-blast2.json',openworld:'rimworld/open_world/egg-rimworld-open-world.json',together:'rimworld/together/egg-rimworld-together.json'};
const add=(egg,name,key,value,rules,description)=>{if(!egg.variables.some(v=>v.env_variable===key))egg.variables.push({name,env_variable:key,default_value:value,rules,description,user_viewable:true,user_editable:true,field_type:'text'});};
for(const[game,path]of Object.entries(games)){
 const entry=catalog.entries.find(x=>x.path===path),egg=structuredClone(entry.egg),prior=existing[path]||{};
 egg.docker_images={'Pinned native Debian runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/sonic_rimworld.py run ${game}`;
 egg.config={files:'{}',startup:JSON.stringify({done:game==='sonic'?'Map is now':game==='together'?'Server launched':'Server Launched'}),logs:'{}',stop:game==='openworld'?'shutdown':'quit'};
 for(const v of egg.variables){
  if(v.env_variable==='MAX_PLAYERS')v.rules='required|integer|between:1,'+(game==='sonic'?32:game==='together'?150:1000);
  if(v.env_variable==='VERSION'){v.default_value=game==='together'?'26.10.20.1_(1)':'v1.0.4';v.rules='required|string|max:40|not_regex:/[\\r\\n\\x00]/';v.description='Recorded publisher Linux x64 server release by default. latest follows publisher releases. Additional official releases retain source selection and record their publisher SHA256 or HTTPS-acquired identity; native acceptance is separate.';}
  if(v.env_variable==='SRB2_VERSION'){v.default_value='2.2.15';v.user_viewable=true;v.user_editable=true;v.rules='required|string|max:30|regex:/^(latest|2\\.2\\.15)$/';v.description='Official2.2.15 source and dedicated-required assets are pinned and compiled as a native Linux dedicated server. Additional source versions need a recorded source/asset identity.';}
  if(['SRV_NAME','SRV_PW'].includes(v.env_variable)){v.rules='nullable|string|max:20|not_regex:/["\\\\;\\r\\n\\x00]/';if(v.env_variable==='SRV_NAME')v.rules=v.rules.replace('nullable','required');}
  if(v.env_variable==='SRV_PW'){v.name='Remote administrator password';v.description='Native SRB2 password command adds a remote administrator password. It does not set a player join password.';}
  if(v.env_variable==='ROOM_NR'){v.rules='required|integer|between:-1,65535';v.description='Original master-server room number. Used only when public registration is explicitly enabled. Private servers use room-1.';}
  if(v.env_variable.startsWith('WINE'))v.description+=' Retained legacy export field; the native Linux dedicated server does not execute Wine.';
  if(v.env_variable==='VERBOSE')v.description='Maps the original boolean control to the current native Verbosity setting: false0, true2. Other native configuration remains operator-owned.';
  if(v.env_variable==='PLAYER_VERSION'){v.default_value='1.3';v.description='Native publisher PlayerVersion default1.3. Set the version expected by your matching OpenWorld client mod; this is a legacy mod with separate compatibility from current RimWorld releases.';}
 }
 if(game!=='openworld')add(egg,'Public server listing','REGISTER_SERVER','false','required|string|in:true,false','Off by default. Enable only when you intend to advertise the server publicly.');
 if(game==='together'){
  add(egg,'Server name','SERVER_NAME','RimWorld Together Server','required|string|max:128|not_regex:/[\\r\\n\\x00]/','Current native Name in Configs/ServerConfig.json.');
  add(egg,'Server telemetry','SERVER_TELEMETRY','false','required|string|in:true,false','Optional publisher telemetry. Disabled by default.');
 }
 egg.variables.push({name:'Native publisher runtime',env_variable:'AUTO_UPDATE',description:'Native release installation owns updates; the base image Steam updater remains disabled.',default_value:'0',rules:'required|in:0',user_viewable:false,user_editable:false,field_type:'text'});
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates libicu72 libstdc++6'+(game==='sonic'?' build-essential pkg-config libpng-dev libcurl4-openssl-dev zlib1g-dev':'')+'\nmkdir -p .voltra\n';
 const files=[['steam-template.py','steam_template.py'],['additional-survival-install.py','additional_survival_install.py'],['native-console.py','native_console.py'],['native-release.py','native-release.py'],['small-native-install.py','small-native-install.py'],['bundle-debian-python.py','bundle_debian_python.py'],['sonic-rimworld.py','sonic_rimworld.py'],['sonic-rimworld-releases.json','sonic-rimworld-releases.json'],['sonic-rimworld-licenses.json','sonic-rimworld-licenses.json']];
 if(game==='openworld')files.push(['among-us-install.py','among-us-install.py']);
 for(const[source,target]of files)script+=`cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync(base+source,'utf8')}\nVOLTRA_SOURCE\n`;
 script+=`python3 .voltra/bundle_debian_python.py\npython3 .voltra/sonic_rimworld.py install ${game}\n`;
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
 profiles[path]={upstream_sha256:entry.sha256,revision:game+'-native-v1',platforms:['linux/amd64'],required_ports:1,defaults:{memory:game==='sonic'?2048:512,disk:game==='sonic'?4096:2048},verification:prior.verification||'not_verified',detail:prior.detail||'Dedicated server controls implemented; native protocol/lifecycle acceptance pending.',egg,setup_steps:game==='sonic'?[
  'Choose one UDP allocation. A native Linux dedicated executable is built from recorded official source and requires only the three official PK3 resources; no Wine, renderer or Windows client executable runs.',
  'Server name, remote administrator password, player limit and original master-server room control remain available. SRV_PW is an administrator password, not a join password. Public listing is explicitly off by default.',
  'Edit advanced commands and addons through Files while offline. The original adedserv.cfg remains editable; managed settings are updated without removing unknown commands. Native saved configuration, demos and Lua data live under ServerData/.',
  'Console accepts native SRB2 commands; Stop sends quit. Back up adedserv.cfg and the complete ServerData folder. Reinstall does not replace operator configuration or persistent data.',
  'Source and redistribution notices accompany the dedicated executable and official resources. Client play and account administration are separate from dedicated protocol checks.'
 ]:[
  'Choose one TCP allocation. These are standalone community mod servers; the proprietary RimWorld client and its assets are not downloaded or run.',
  game==='together'?'The recorded publisher server is now RTServer and bundles .NET10. Original Max Players and Verbose controls map to native MaxPlayers and Verbosity. Configs/ServerConfig.json is the current configuration path.':'The recorded OpenWorld release targets .NET3.1. A private .NET8 runtime with explicit major roll-forward is used for compatibility acceptance; no machine-wide legacy runtime is installed. All original mod, whitelist, scenario, client-version and player-limit controls are preserved.',
  game==='together'?'Public server listing, telemetry and automatic router changes are disabled by default. Name/listing/telemetry use the existing shared setup form; all other native JSON configuration remains editable.':'Edit advanced Data/ configuration, mod lists and whitelist files while offline. The launcher preserves unknown JSON fields and existing configuration ownership and modes.',
  'The first real RimWorld client creates its planet through the mod. An empty dedicated server is not a generated gameplay world. Server protocol, native console and generated settings can be checked without inventing a player or planet.',
  game==='together'?'Stop sends native quit. Back up Configs/, Assets/, Saves/, Users/, Maps/, Settlements/ and Backups/ before changing versions. Reinstall stages only the server engine and retains user data.':'Stop sends native shutdown. Back up the complete Data/ folder and native generated save/mod folders before changing versions. Reinstall stages only the server engine and retains user data.'
 ]};
}
fs.mkdirSync('.local/sonic-rimworld',{recursive:true});fs.writeFileSync('.local/sonic-rimworld/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Three exact dedicated profiles staged; native acceptance remains separate.');
