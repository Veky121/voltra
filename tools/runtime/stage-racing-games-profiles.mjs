import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const previous=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profiles={};
const image='ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b';
for(const [path,game] of [['beamng/beammp/egg-beam-m-p-server.json','beammp'],['beamng/kissmp/egg-kissmp.json','kissmp']]){
 const entry=catalog.entries.find(e=>e.path===path),egg=structuredClone(entry.egg);
 egg.docker_images={'Debian12 native runtime':image};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/racing-native.py run ${game}`;
 egg.config={files:'{}',startup:JSON.stringify({done:game==='beammp'?'Vehicle data network online':'Server is running!'}),logs:'{}',stop:game==='beammp'?'exit':'^SIGINT'};
 for(const v of egg.variables){
  if(v.env_variable==='VERSION')v.default_value='v3.9.3';
  if(v.env_variable==='PRIVATE')v.default_value='true';
  if(v.env_variable==='AUTHKEY')v.description+=' The reviewed v3.9.3 binary requires a key even with private listing enabled.';
  if(v.env_variable==='MAX_PLAYERS')v.rules='required|integer|between:1,100';
  if(v.env_variable==='MAX_CARS')v.rules='required|integer|between:0,10';
 }
 const add=(name,key,description,value,rules)=>egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
 if(game==='kissmp'){
  add('Publisher version','VERSION','Official release tag or latest. Older releases without publisher digests require the verified archive SHA-256.','v0.8.0','required|string|max:64|regex:/^[A-Za-z0-9._-]+$/');
  for(const [name,key,description,rules] of [
   ['Server name','SERVER_NAME','Empty leaves native config.json in control.','nullable|string|max:1024'],
   ['Description','DESCRIPTION','Empty leaves native config.json in control.','nullable|string|max:1024'],
   ['Map','MAP','BeamNG map path. Empty leaves native config.json in control.','nullable|string|max:1024'],
   ['Maximum players','MAX_PLAYERS','Empty retains native value.','nullable|integer|between:1,255'],
   ['Tick rate','TICKRATE','Empty retains native value.','nullable|integer|between:1,255'],
   ['Cars per player','MAX_CARS','Empty retains native value.','nullable|integer|between:0,255'],
   ['Public listing','PUBLIC_SERVER','Empty retains native config; new publisher default is false.','nullable|in:true,false,0,1'],
   ['UPnP','UPNP_ENABLED','Empty retains native config; use allocated ports for hosted nodes.','nullable|in:true,false,0,1'],
   ['Require scripts','REQUIRE_SCRIPTS','Empty retains native config.','nullable|in:true,false,0,1'],
  ])add(name,key,description,'',rules);
 }
 add('Publisher archive SHA-256','RELEASE_SHA256','Only needed for alternate releases without publisher SHA-256 digests. Verify against a trusted source.','','nullable|string|size:64|regex:/^[a-f0-9]+$/');
 egg.variables.push({name:'Native publisher runtime',env_variable:'AUTO_UPDATE',description:'Use reinstall to update the selected verified publisher release.',default_value:'0',rules:'required|in:0',user_viewable:false,user_editable:false,field_type:'text'});
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\nmkdir -p .voltra\n';
 for(const name of ['racing-native.py','native-release.py','native-config.py','native-console.py','steam-template.py','bundle-debian-python.py']){
  const dest=name==='steam-template.py'?'steam_template.py':name;
  script+=`cat > .voltra/${dest} <<'VOLTRA_RACING_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')}\nVOLTRA_RACING_SOURCE\n`;
 }
 script+=`mkdir -p .voltra/${game}\ncat > .voltra/${game}/LICENSE <<'VOLTRA_PUBLISHER_LICENSE'\n${fs.readFileSync('internal/panel/game_library/licenses/'+(game==='beammp'?'beammp-AGPL-3.0.txt':'kissmp-Apache-2.0.txt'),'utf8')}\nVOLTRA_PUBLISHER_LICENSE\n`;
 script+=`python3 .voltra/bundle-debian-python.py\npython3 .voltra/racing-native.py install ${game}\n`;
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 const revision=game+'-native-v1';
 profiles[path]={upstream_sha256:entry.sha256,revision,platforms:['linux/amd64'],defaults:{memory:512,disk:2048},egg,
  verification:previous[path]?.revision===revision?previous[path].verification:'not_verified',detail:previous[path]?.revision===revision?previous[path].detail:'Adapter implemented; native acceptance pending.',
  setup_steps:game==='beammp'?[
   'Official unmodified Debian12 x86_64 publisher binary, reviewed v3.9.3, verified by publisher SHA-256. Version and original name, description, authentication, private listing, player/car limits, map and chat controls remain available.',
   'Enter your own BeamMP Keymaster key in Authentication Key. The reviewed v3.9.3 binary requires a key even for private servers. Private listing is the default. A key can be used by only one active server. Authentication values are redacted from adapter console output.',
   'Connect through the allocated port using both TCP and UDP. Preserve ServerConfig.toml, Resources/Server Lua plugins, Resources/Client mod ZIP files, bans and custom files. The launcher changes managed General keys and backs up changed configuration. The native publisher rewrites its own TOML schema during startup and may remove comments or unknown keys.',
   'Stop sends the native exit command. Reinstall updates the executable without deleting configuration or mods. AGPL-3.0 license and publisher source reference are retained under .voltra/beammp. Client gameplay and authenticated public listing require separate acceptance.',
  ]:[
   'Official unmodified KissMP v0.8.0 Linux server, SHA-256 verified. Connect from a matching KissMP/BeamNG client through the allocated UDP port. No BeamMP Keymaster key is used.',
   'Existing config.json remains editable in Files. Empty optional Startup controls retain native values; Port always follows the allocation. Native mods, scripts, identifier and unknown JSON keys are preserved. New publisher defaults keep public listing and UPnP disabled.',
   'Preserve config.json and all operator mods/scripts. Reinstall changes the publisher executable only. Stop uses the original native SIGINT path; its raw exit behavior is recorded during acceptance, never relabeled as graceful without evidence.',
   'The installer never launches a temporary public server to generate config. Publisher Apache-2.0 license and source reference are retained under .voltra/kissmp. Client joins and gameplay need separate acceptance.',
  ]};
}
fs.mkdirSync('.local/racing-games',{recursive:true});fs.writeFileSync('.local/racing-games/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged two racing profiles.');
