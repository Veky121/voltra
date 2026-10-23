import fs from 'node:fs';
const base='internal/panel/game_library/scripts/',catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),existing=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
function add(egg,name,key,value,rules,description='',visible=true){if(!egg.variables.some(v=>v.env_variable===key))egg.variables.push({name,env_variable:key,default_value:value,rules,description,user_viewable:visible,user_editable:visible,field_type:'text'});}
for(const entry of catalog.entries.filter(e=>/^(valheim|v_rising)\//.test(e.path))){
 const egg=structuredClone(entry.egg),windows=entry.path.startsWith('v_rising/'),game=windows?'vrising':'valheim',variant=entry.path.includes('bepinex')?'bepinex':entry.path.includes('valheim_plus')?'plus':'vanilla';
 egg.features=[...new Set([...(egg.features??[]),'voltra_steam_template'])];egg.docker_images={[windows?'Pinned private GE-Proton host':'Pinned Linux Steam runtime']:windows?'ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 if(windows&&variant==='bepinex')egg.features.push('voltra_private_wine');
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/${game}_runtime.py`;
 egg.config={files:'{}',startup:JSON.stringify({done:windows?'VOLTRA_VRISING_READY':'VOLTRA_VALHEIM_READY'}),logs:'{}',stop:'^SIGINT'};
 add(egg,'Reviewed recipe','VOLTRA_'+game.toUpperCase()+'_VARIANT',variant,'required|in:'+variant,'Select the matching recipe to change loader families.',false);
 if(windows){
  const xvfb=egg.variables.find(v=>v.env_variable==='XVFB');if(xvfb){xvfb.default_value='0';xvfb.rules='required|in:0';xvfb.user_editable=false;xvfb.user_viewable=false;}
  else add(egg,'Private display lifecycle','XVFB','0','required|in:0','The launcher owns its private display through native saving.',false);
 }
 for(const v of egg.variables){
  if(v.env_variable==='SRCDS_APPID')v.rules='required|string|in:'+(windows?'1829350':'896660');
  if(['QUERY_PORT','VR_QUERY_PORT','RCON_PORT','VR_RCON_PORT'].includes(v.env_variable))v.rules='nullable|integer|between:1,65535';
  if(v.env_variable==='WORLD')v.rules='required|string|max:20|not_regex:/[\\x00-\\x1f\\x7f]/';
  if(['VR_SAVE_NAME','SAVE_NAME'].includes(v.env_variable))v.rules='required|string|max:128|not_regex:/[\\x00-\\x1f\\x7f]/';
  if(['SERVER_NAME','VR_NAME'].includes(v.env_variable))v.rules='required|string|max:'+(windows?'128':'60')+'|not_regex:/[\\x00-\\x1f\\x7f]/';
  if(v.env_variable==='V_MODPACK')v.rules='nullable|string|max:200|regex:/^[A-Za-z0-9_]+-[A-Za-z0-9_]+-[0-9]+\\.[0-9]+\\.[0-9]+$/';
 }
 const sources=['steam-template.py','bundle-debian-python.py','native-config.py','valheim-vrising-install.py',...(windows?['enshrouded-proton.py']:['private-nss.py','additional-survival-install.py']),game+'-runtime.py'];
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6'+(windows?' libvulkan1':' libpulse-mainloop-glib0')+'\nmkdir -p .voltra\n';
 if(!windows)script+='mkdir -p .voltra/valheim/lib .voltra/valheim/licenses\ncp -a /usr/lib/x86_64-linux-gnu/libpulse-mainloop-glib.so.0* .voltra/valheim/lib/\ncp /usr/share/doc/libpulse-mainloop-glib0/copyright .voltra/valheim/licenses/libpulse-mainloop-glib0-copyright\n';
 for(const source of sources)script+=`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_SOURCE'\n${fs.readFileSync(base+source,'utf8')}\nVOLTRA_SOURCE\n`;
 script+=`python3 .voltra/bundle_debian_python.py\nPYTHONPATH=.voltra python3 .voltra/valheim_vrising_install.py ${game}\n`;
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
 profiles[entry.path]={upstream_sha256:entry.sha256,revision:game+'-'+variant+'-native-v1',platforms:['linux/amd64'],required_ports:windows?3:2,...(!windows?{consecutive_ports:true}:{}),defaults:{memory:windows?12288:4096,disk:windows?32768:12288},egg,verification:existing[entry.path]?.verification??'not_verified',detail:existing[entry.path]?.detail??'Original controls retained in shared template form; native family adapter implemented, acceptance pending.',setup_steps:windows?[
  'Choose a Linux x64 node with 12 GiB memory and three ports for gameplay, Steam query and optional RCON. Windows game files run under a checksum-pinned private GE-Proton runtime.',
  'Keep save-data/Settings and save-data/Saves, plus the private Proton prefix under .steam/steam/steamapps/compatdata/1829350. Save name chooses the native world. Reinstall preserves operator settings and saves.',
  'The original vanilla VR_ controls or BepInEx controls apply as typed values to ServerHostSettings.json. Unknown fields and nested RCON settings survive; changed host settings receive private backups. Edit ServerGameSettings.json through Files for detailed rules.',
  'Enable original RCON and set a private password to use the dashboard Console through authenticated native Source RCON. The native command list includes version, time, announce and shutdown. Stop signals the exact native Windows server process and waits for saving.',
  'BepInEx is a separate recipe with a pinned publisher pack and winhttp loader override. Its original fixed Mono setting is applied as a checksum-pinned Wine Mono MSI inside this game\'s GE prefix; the image\'s unrelated global Wine setup is disabled by a derived environment hook. Existing plugin configuration, plugins and data are retained; arbitrary plugin/client compatibility requires its own acceptance.',
 ]:[
  'Choose a Linux x64 node with two consecutive allocated ports. Gameplay uses the primary port and Steam query uses primary plus one. Crossplay retains the original PlayFab setting and can need external registration.',
  'Server name, password, saved world, public visibility, autosave and all backup intervals are passed as literal native arguments. The password needs at least five characters and must not occur in the server name.',
  'Keep .config/unity3d/IronGate/Valheim for worlds_local, permissions and native backups. World name selects the existing save. Stop sends native SIGINT and waits for world saving; this server does not expose an interactive stdin console.',
  'Vanilla, BepInEx and ValheimPlus have separate recipes. Pinned base packs retain operator plugin/configuration data. V_MODPACK accepts a versioned Thunderstore namespace-name-version and resolves its dependency graph with bounded downloads.',
  'ValheimPlus keeps the original GitHub repository, Version and Match controls. They resolve one publisher ZIP asset; its version and digest are recorded. Native plugin loading and player mod compatibility are separate acceptance scopes.',
 ]};
}
fs.mkdirSync('.local/valheim-vrising',{recursive:true});fs.writeFileSync('.local/valheim-vrising/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged five Valheim/V Rising profiles; shared overrides unchanged.');
