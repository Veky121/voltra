// Stage owned profiles without writing the shared override catalog.
import fs from 'node:fs';
import path from 'node:path';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const existing=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const output='.local/survival-games';fs.mkdirSync(output,{recursive:true});
const runtime='ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b';
function installScript(sources,install){
 let result='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 for(const source of ['steam-template.py','bundle-debian-python.py',...sources])result+=`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SOURCE\n`;
 return result+'python3 .voltra/bundle_debian_python.py\n'+install+'\n';
}
function add(egg,name,key,value,rules,description=''){
 if(!egg.variables.some(v=>v.env_variable===key))egg.variables.push({name,env_variable:key,default_value:value,rules,description,user_viewable:true,user_editable:true,field_type:'text'});
}
const profiles={};
for(const sourcePath of ['rust/rust_autowipe/egg-rust-autowipe.json','rust/rust_staging/egg-rust-staging.json']){
 const entry=catalog.entries.find(e=>e.path===sourcePath),egg=structuredClone(entry.egg);
 egg.features=[...new Set([...(egg.features??[]),'voltra_steam_template'])];
 egg.docker_images={'Debian Steam runtime':runtime};
 egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/rust_runtime.py';
 egg.config={files:'{}',startup:JSON.stringify({done:'VOLTRA_RUST_READY'}),logs:'{}',stop:'^SIGINT'};
 add(egg,'Save identity','SERVER_ID','rust','required|string|max:64|regex:/^[A-Za-z0-9_-]+$/','Keep unchanged to retain server/<ID> saves and Rust+ pairing.');
 add(egg,'Automatic updates','AUTO_UPDATE','0','required|boolean','Update Steam and reapply selected framework before startup.');
 add(egg,'Query port','QUERY_PORT','28017','required|integer|between:1,65535','A selected allocation is used when this default is unavailable.');
 add(egg,'Additional native arguments','ADDITIONAL_ARGS','','nullable|string|max:8192');
 add(egg,'Framework','FRAMEWORK','vanilla','required|string|in:vanilla,oxide,carbon');
 const rules={SRCDS_APPID:'required|string|in:258550',MAX_PLAYERS:'required|integer|between:1,1000',WORLD_SIZE:'required|integer|between:1000,6000',WORLD_SEED:'nullable|integer|between:0,2147483647',SAVEINTERVAL:'required|integer|between:1,86400',RCON_PORT:'required|integer|between:1,65535',QUERY_PORT:'required|integer|between:1,65535',APP_PORT:'required|integer|between:-1,65535',RCON_PASS:'nullable|string|max:128|regex:/^[A-Za-z0-9_.-]+$/',HOSTNAME:'required|string|max:128|not_regex:/[\\x00-\\x1f\\x7f]/',LEVEL:'required|string|max:128|not_regex:/[\\x00-\\x1f\\x7f]/',DESCRIPTION:'nullable|string|max:4096|not_regex:/[\\x00-\\x1f\\x7f]/'};
 rules.RCON_PASS='nullable|string|min:8|max:128|regex:/^[A-Za-z0-9_.-]+$/';
 for(const variable of egg.variables){
  if(rules[variable.env_variable])variable.rules=rules[variable.env_variable];
  if(variable.env_variable==='RCON_PASS'){variable.default_value='';variable.description='Empty creates and preserves a private random RCON password; native dashboard Console uses authenticated local WebRCON.';}
 }
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script:installScript(['rust-runtime.py','rust-install.py'],'PYTHONPATH=.voltra python3 .voltra/rust_install.py')};
 profiles[sourcePath]={upstream_sha256:entry.sha256,revision:'rust-native-v1',platforms:['linux/amd64'],required_ports:4,defaults:{memory:12288,disk:32768},egg,verification:'not_verified',detail:'Typed Steam setup, persistent native configuration and WebRCON bridge implemented; native acceptance pending.',setup_steps:[
  'Choose a Linux x64 node with four free ports on the same address, sufficient disk and at least 12 GiB memory for a small map. Larger maps and player counts need more.',
  'The primary port is gameplay. Selected allocations supply query, authenticated WebRCON and Rust+ ports when upstream defaults are unavailable. Rust+ may be disabled with APP_PORT=-1.',
  'Keep Save identity unchanged. Back up server/<ID> including databases, maps, configuration and companion.id; keep seed.txt to retain a generated seed.',
  'Managed form settings update cfg/server.cfg privately and preserve unknown commands and comments. Additional native arguments are parsed without a shell; managed duplicates must use their form fields.',
  'Console and server.save use authenticated loopback WebRCON. Stop forwards native SIGTERM and waits for world saving and shutdown. Explicit Console quit retains the publisher command behavior.',
  'Vanilla, Oxide and Carbon are explicit choices. Steam updates are followed by the selected framework overlay; existing plugin configuration, plugins and data are retained.',
  'Autowipe only runs on reinstall when REGEN_SERVER=1. Matching files and directories move into a private recovery transaction under .voltra/rust/wipe-backups; overlapping matches are moved once. Failed moves roll back, and recovery.json records the result. Symlinks, mounted filesystems and protected updater/quarantine paths are rejected before installation changes.',
 ]};
}
{
 const sourcePath='core_keeper/egg-core-keeper.json',entry=catalog.entries.find(e=>e.path===sourcePath),egg=structuredClone(entry.egg);
 egg.features=[...new Set([...(egg.features??[]),'voltra_steam_template'])];egg.docker_images={'Debian Steam runtime':runtime};
 egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/core_keeper_runtime.py';
 egg.config={files:'{}',startup:JSON.stringify({done:'Started session'}),logs:'{}',stop:'^C'};
 for(const variable of egg.variables){
  if(variable.env_variable==='WORLD_MODE')variable.rules='required|string|in:0,1,Normal,Hard,Creative,Casual';
  if(variable.env_variable==='WORLD_INDEX')variable.rules='required|integer|between:0,29';
  if(variable.env_variable==='WORLD_SEED')variable.rules='required|integer|between:0,4294967295';
  if(variable.env_variable==='GAME_ID'){variable.rules='nullable|string|regex:/^[A-Za-z1-9]{15,28}$/|not_regex:/[YyxO]/';variable.description='Optional native Game ID, 15 to 28 characters, excluding Y,y,x,0,O. Empty uses the native generated ID.';}
 }
 add(egg,'Direct connection password','SERVER_PASSWORD','','nullable|string|max:28|not_regex:/[\\x00-\\x1f\\x7f]/','Native direct-IP password, at most 28 characters. Empty preserves or generates a private password. Game ID access bypasses this password.');
 add(egg,'Hashed seed','HASHED_WORLD_SEED','','nullable|integer|between:0,4294967295','Optional native hashed seed; original World Seed must be 0 when used.');
 add(egg,'Season','SEASON','','nullable|string|in:None,Easter,Halloween,Christmas,Valentine,Anniversary,CherryBlossom,LunarNewYear','Empty uses the current native calendar.');
 add(egg,'Restrict platform','ALLOW_ONLY_PLATFORM','','nullable|string|in:Steam,Epic,Microsoft,GOG','Empty permits cross-play using the allocated direct-IP port.');
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script:installScript(['core-keeper-runtime.py'],"PYTHONPATH=.voltra python3 - <<'VOLTRA_INSTALL'\nfrom pathlib import Path\nfrom steam_template import update\nupdate(Path.cwd(),1963720,required=('CoreKeeperServer',))\nVOLTRA_INSTALL")};
 profiles[sourcePath]={upstream_sha256:entry.sha256,revision:'core-keeper-native-v1',platforms:['linux/amd64'],required_ports:2,consecutive_ports:true,defaults:{memory:3072,disk:8192},egg,verification:'not_verified',detail:'Native Unity setup implemented; current-package argument and lifecycle acceptance pending.',setup_steps:[
  'Choose a Linux x64 node and two consecutive ports for gameplay and native Steam query. Persistent data stays under CoreKeeperSaves.',
  'World index chooses the saved slot; name, seed and difficulty initialize a new world. Keep the index and CoreKeeperSaves to resume it.',
  'Share the persistent Game ID privately, or supply an existing valid ID. Private generated values are under .voltra/core-keeper. The direct-IP password has no effect on joining by Game ID.',
  'Stop forwards the publisher native SIGTERM lifecycle and waits for world saving. Core Keeper does not expose an interactive stdin server console; edit its native JSON configuration while offline.',
  'The native package requires GPU-assisted procedural generation. A private Xvfb process uses the original display variables and is stopped with the game.',
 ]};
}
for(const [sourcePath,profile] of Object.entries(profiles)){
 if(existing[sourcePath]?.verification)profile.verification=existing[sourcePath].verification;
 if(existing[sourcePath]?.detail)profile.detail=existing[sourcePath].detail;
}
fs.writeFileSync(path.join(output,'profiles.json'),JSON.stringify(profiles,null,2)+'\n');
console.log('Staged '+Object.keys(profiles).length+' survival profiles in '+output+'/profiles.json');
