import fs from 'node:fs';import path from 'node:path';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
const controls=(name,key,value,rules,description='')=>({name,env_variable:key,default_value:value,rules,description,user_viewable:true,user_editable:true,field_type:'text'});
for(const [recipe,kind]of [['quake_live/egg-quake-live.json','quakelive'],['spacestation_14/egg-spacestation14.json','ss14']]){
 const entry=catalog.entries.find(x=>x.path===recipe),egg=structuredClone(entry.egg);
 egg.docker_images={'Pinned native Linux runtime':'ghcr.io/ptero-eggs/yolks@sha256:85cc85e658366d2398288b1f829a4bab4de2d02a3bea4193f8d502db7b2dd29b'};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/quake_ss14_runtime.py ${kind}`;
 egg.config={files:'{}',startup:JSON.stringify({done:'VOLTRA_QSS_NATIVE_READY'}),logs:'{}',stop:'^SIGTERM'};
 if(kind==='ss14'){
  egg.variables.find(v=>v.env_variable==='SERVER_MAX_PLAYERS').user_editable=true;
  egg.variables.push(controls('Publish in server hub','PUBLIC_SERVER','0','required|boolean','Private/direct connection by default. Public listing requires correct externally reachable build and game address.'));
 }else{
  egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
  egg.variables.find(v=>v.env_variable==='SERVER_TYPE').default_value='1';
  egg.variables.find(v=>v.env_variable==='SERVER_TYPE').rules='required|integer|in:0,1,2';
  egg.variables.find(v=>v.env_variable==='FPS').user_editable=false;
  egg.variables.find(v=>v.env_variable==='FPS').rules='required|integer|in:40';
  egg.variables.find(v=>v.env_variable==='FPS').description='Publisher dedicated build1168250 keeps sv_fps read-only40, including early startup settings. Original read-only control retained; unsupported values fail explicitly.';
  for(const key of ['SERVER_NAME','PASSWORD'])egg.variables.find(v=>v.env_variable===key).rules+='|not_regex:/[\\x00-\\x1f\\x7f"\\\\;]/';
  egg.variables.push(controls('Map','MAP','campgrounds','required|string|regex:/^[A-Za-z0-9_-]{1,63}$/','Installed native map; preserve custom maps under baseq3.'),controls('Game factory','FACTORY','ffa','required|string|regex:/^[A-Za-z0-9_-]{1,63}$/','Publisher or installed custom factory.'),controls('Maximum players','MAX_PLAYERS','16','required|integer|between:1,64'),controls('Enable native RCON','RCON_ENABLE','0','required|boolean','Native ZeroMQ RCON needs a distinct additional allocation.'),controls('RCON port','RCON_PORT','0','required|integer|between:0,65535','Zero selects an additional allocated port automatically.'),controls('RCON password','RCON_PASSWORD','','nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f"\\\\;]/'),controls('Steam branch','SRCDS_BETAID','','nullable|string|max:64|regex:/^[A-Za-z0-9_.-]+$/','Public branches only; private Steam credentials fail closed.'));
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends ca-certificates python3 curl lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 for(const source of ['native-release','native-zip-release','native-console','steam-template','source-install','bundle-debian-python','quake-ss14-install','quake-ss14-runtime','quake-ss14-query'])script+=`cat > .voltra/${source.replaceAll('-','_')}.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source+'.py','utf8')}\nVOLTRA_SOURCE\n`;
 script+=`python3 .voltra/bundle_debian_python.py\npython3 .voltra/quake_ss14_install.py ${kind}\n`;
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 profiles[recipe]={upstream_sha256:entry.sha256,revision:'quake-ss14-native-v1',platforms:kind==='ss14'?['linux/amd64','linux/arm64']:['linux/amd64'],required_ports:1,...(kind==='quakelive'?{port_rules:[{environment:'RCON_ENABLE',value:'1',minimum:1,maximum:65535,count:2}]}:{}),defaults:{memory:kind==='ss14'?2048:1024,disk:kind==='ss14'?4096:8192},egg,verification:current[recipe]?.verification||'not_verified',detail:current[recipe]?.detail||'Reviewed shared-form native setup staged; native acceptance pending.',setup_steps:kind==='ss14'?[
  'The official stable Wizard build and supported .NET10 runtime are pinned separately for Linux x64 and arm64. Both image-index manifests exist; native arm64 remains untested. Gameplay UDP and launcher HTTP share the primary port.',
  'Original name/tick/max-connection settings use native --cvar arguments. Keep custom settings in ss14/server_config.toml; form values override only their managed settings.',
  'Back up ss14/data and ss14/server_config.toml before updates. SQLite character/admin/playtime data stays in the existing data directory. A round is not a persistent survival world.',
  'Console forwards native commands; Stop invokes native shutdown. Public hub registration, authentication and real client gameplay need operator acceptance.',
 ]:[
  'Steam349090 public dedicated server; anonymous installation only. All original name/server-type/password/FPS/update controls remain available. Private Steam credentials are unavailable until parsing is verified.',
  'LAN is the default. Gameplay/query uses primary UDP; ZeroMQ RCON is optional and needs an additional TCP allocation. Public listing/client authentication require separate operator acceptance.',
  'Keep original operator configuration in baseq3/server.cfg. Managed settings load after that file. The home/config directory quake-live-user is separate from Steam files.',
  'Native operator CFG/INI/VDF files survive validation, including failed updates. Back up baseq3 and quake-live-user before updates. Console and Stop use native commands; no survival-world save semantics are claimed.',
 ]};
}
const output=process.argv[2]||'.local/quake-ss14/profiles.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(profiles,null,2)+'\n');console.log('Staged Quake Live and SS14 profiles');
