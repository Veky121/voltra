import fs from 'node:fs';import path from 'node:path';
// Stage only these owned recipes. Root merges after integration review.
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const output=process.argv[2]||'.local/quake-games/overrides.json';const staged={};
for(const [recipe,kind,memory,disk] of [
 ['urbanterror/egg-urban-terror.json','urbanterror',1024,8192],
 ['wolfenstein_enemy_territory/etlegacy/egg-e-t-legacy.json','etlegacy',1024,4096],
]){
 const entry=catalog.entries.find(e=>e.path===recipe),egg=structuredClone(entry.egg);
 egg.description+=' Pinned publisher release, private LAN by default, native console and challenge-verified UDP readiness. Operator configuration and custom packages remain editable.';
 egg.docker_images={'Debian Steam runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/quake_family_runtime.py ${kind}`;
 egg.config={files:'{}',startup:JSON.stringify({done:'VOLTRA_QUAKE_NATIVE_READY'}),logs:'{}',stop:'quit'};
 const variable=(name,key,description,value,rules)=>({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
 egg.variables.push(variable('Public listing','PUBLIC_SERVER','Private LAN by default. Enable native Internet master registration.','0','required|boolean'));
 if(kind==='etlegacy'){
  egg.variables.push(variable('Server name','SERVER_NAME','Native server info. Quotes, backslashes, semicolons and line breaks are unsupported.','ET: Legacy server','required|string|max:255|not_regex:/["\\\\;\\r\\n\\x00]/'));
  egg.variables.push(variable('Maximum players','MAX_PLAYERS','Native connected client limit.','20','required|integer|between:1,64'));
  for(const [name,key]of [['Server password','SERVER_PASSWORD'],['RCON password','RCON_PASSWORD']])egg.variables.push(variable(name,key,'Optional native password. Empty disables this password.','','nullable|string|max:127|not_regex:/["\\\\;\\r\\n\\x00]/'));
  egg.variables.find(v=>v.env_variable==='ET_VERSION').description+=' Stop and reinstall after changing architecture. 32-bit remains the original default; 64-bit supports only 64-bit native mods.';
 }
 const map=egg.variables.find(v=>v.env_variable===(kind==='urbanterror'?'SERVER_MAP':'MAP'));map.rules='required|string|max:63|regex:/^[A-Za-z0-9_-]+$/';
 for(const v of egg.variables.filter(v=>['SERVER_NAME','JOIN_MESSAGE','RCON_PASSWORD','SERVER_PASSWORD'].includes(v.env_variable))){
  if(!v.rules.includes('not_regex'))v.rules+='|not_regex:/["\\\\;\\r\\n\\x00]/';
  v.description+=' Native strings reject unsupported quotes, backslashes, semicolons and line breaks.';
 }
 for(const [key,rules]of [['SERVER_MAXCLIENTS','required|integer|between:1,32'],['BOT_MINPLAYERS','required|integer|between:0,16'],['SERVER_TIMELIMIT','required|integer|between:0,999'],['SERVER_FRIENDLYFIRE','required|boolean']]){
  const v=egg.variables.find(v=>v.env_variable===key);if(v)v.rules=rules;
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends ca-certificates python3\nmkdir -p .voltra\n';
 for(const [source,target]of [['native-release.py','native_release.py'],['native-zip-release.py','native_zip_release.py'],['steam-template.py','steam_template.py'],['native-console.py','native_console.py'],['bundle-debian-python.py','bundle_debian_python.py'],['quake-family-runtime.py','quake_family_runtime.py'],[`${kind}-install.py`,`${kind}_install.py`]]){
  script+=`cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SOURCE\n`;
 }
 script+=`python3 .voltra/bundle_debian_python.py\npython3 .voltra/${kind}_install.py\n`;
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 staged[recipe]={upstream_sha256:entry.sha256,revision:`${kind}-native-v1`,platforms:['linux/amd64'],defaults:{memory,disk},egg,
 verification:current[recipe]?.verification||'not_verified',detail:current[recipe]?.detail||'Setup implemented; native acceptance pending.',setup_steps:[
  'Install, start from Console, then connect a matching client to the allocated UDP address. Native readiness requires the server to echo a random local UDP challenge. Public listing is disabled by default.',
  `Native engine and original packages are under ${kind}. Writable settings, console-written configuration, bans and custom maps or mods are under ${kind}/userdata. Back up the complete volume.`,
  `Native ${kind==='urbanterror'?'server.cfg':'etl_server.cfg'} loads before generated settings. Keep other tuning, rotation, downloads and mod configuration in the native configuration. The form controls initial map and reviewed settings. Native console strings reject quotes and line breaks instead of rewriting them.`,
  'Stop sends native quit. Reinstall retains operator configuration, custom packages and altered stock assets. Managed replacements receive previous-file backups. Changing architecture requires Stop and reinstall.',
  kind==='urbanterror'?'The complete FrozenSand game data and both bundled dedicated x86 engines are retained. Bot fill is optional and must fit player slots. The upstream warns bots are unsupported.':'Original Splash Damage pak0, pak1 and pak2 data and license text are installed without executing the historic installer. ET: Legacy includes Omni-Bot and WolfAdmin; native third-party mods must match the selected architecture.',
 ]};
}
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(staged,null,2)+'\n');console.log('Staged Urban Terror and ET: Legacy profiles at '+output);
