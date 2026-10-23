import fs from 'node:fs';
const path='dont_starve/egg-don-t-starve-together.json';
const entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===path);
const file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file)),egg=structuredClone(entry.egg);
egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
egg.docker_images={'Debian Steam runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/dst_runtime.py';
egg.config={files:'{}',startup:JSON.stringify({done:'VOLTRA_DST_READY'}),logs:'{}',stop:'c_shutdown()'};
const changes={
 SERVER_TOKEN:{rules:'nullable|required_if:environment.ONLINE_MODE,1|string|max:2048|not_regex:/[\\x00-\\x1f\\x7f]/',description:'Klei cluster token for online mode. Enter privately. Offline LAN mode does not require a token.'},
 SRCDS_APPID:{rules:'required|string|in:343050'},
 GAME_MODE:{rules:'required|string|in:survival,endless,wilderness,relaxed,lightsout'},
 CLUSTER_NAME:{rules:'required|string|max:256|not_regex:/[\\x00-\\x1f\\x7f]/'},
 CLUSTER_DESC:{rules:'nullable|string|max:1024|not_regex:/[\\x00-\\x1f\\x7f]/'},
 MASTER_WORLDGEN:{rules:'nullable|string|max:2048',description:'HTTPS Lua source used only when Master/worldgenoverride.lua is missing. The original default is bundled from the pinned catalog revision.'},
 CAVES_WORLDGEN:{rules:'nullable|string|max:2048',description:'HTTPS Lua source used only when Caves/worldgenoverride.lua is missing. Existing generation files and worlds are preserved.'},
 AUTO_UPDATE:{description:'Use the shared typed Steam helper on startup. Existing dedicated_server_mods_setup.lua is preserved across validation and updates.'},
};
for(const variable of egg.variables)Object.assign(variable,changes[variable.env_variable]);
for(const [name,key,description,value,rules]of [
 ['Online mode','ONLINE_MODE','Online mode requires a real Klei server token. Disable for offline LAN hosting.','1','required|boolean'],
 ['Persistent cluster ID','CLUSTER_ID','Original identity is server. Keep unchanged to resume the same surface, caves and player data.','server','required|string|max:64|regex:/^[A-Za-z0-9_-]+$/'],
 ['Cluster password','CLUSTER_PASSWORD','Optional native join password.','','nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f]/'],
 ['Player combat','PVP','Native player-versus-player setting.','0','required|boolean'],
 ['Pause while empty','PAUSE_EMPTY','Pause the native simulation when no players are connected.','1','required|boolean'],
])egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
for(const [source,target]of [['steam-template.py','steam_template.py'],['bundle-debian-python.py','bundle_debian_python.py'],['native-config.py','native_config.py'],['native-shards.py','native_shards.py'],['dst-config.py','dst_config.py'],['dst-install.py','dst_install.py'],['dst-runtime.py','dst_runtime.py'],['dst-worldgen-master.lua','dst-worldgen-master.lua'],['dst-worldgen-caves.lua','dst-worldgen-caves.lua']])script+=`cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SOURCE\n`;
script+='python3 .voltra/bundle_debian_python.py\nPYTHONPATH=.voltra python3 .voltra/dst_install.py\n';
egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
const previous=profiles[path]||{};
profiles[path]={upstream_sha256:entry.sha256,revision:'dst-native-v1',platforms:['linux/amd64'],required_ports:6,port_rules:[{environment:'ONLINE_MODE',value:'0',minimum:10998,maximum:11018,count:2}],defaults:{memory:4096,disk:16384},egg,verification:previous.verification||'not_verified',detail:previous.detail||'Dual-shard Steam profile implemented; native offline/online acceptance pending.',setup_steps:[
 'Choose a Linux x64 node with six free ports on the same address. They serve Master and Caves gameplay plus separate Steam query/authentication services. Internal shard communication stays on loopback.',
 'Online mode requires a Klei cluster token. Offline LAN hosting is a separate option and does not prove online authentication or public listing.',
 'Offline LAN gameplay ports must both be between 10998 and 11018. The shared form changes its port requirements when offline mode is selected. Online mode permits the normal allocated port range.',
 'Both native shards start together. Readiness requires both worlds; Stop sends c_shutdown() to both. An unexpected exit stops the remaining shard and reports a failed run.',
 'Console commands target Master by default. Prefix a command with Caves> followed by a space to address the cave console. The native c_shutdown() command stops the complete cluster.',
 'Keep the persistent cluster ID unchanged. Back up DoNotStarveTogether/config/<ID>, including both shard saves, player data, worldgen/mod overrides and the private cluster token.',
 'Managed INI changes receive private backups; comments and unknown settings stay editable. Native world generation files are only created when missing, retaining the original two source URL settings.',
 'Edit mods/dedicated_server_mods_setup.lua and each shard modoverrides.lua using Files. The shared installer preserves an existing mod setup file even when Steam validation or installation fails.',
 'AUTO_UPDATE uses the shared helper. Reinstall validates publisher files; keep modified engine files separate from persistent world and mod configuration.',
]};
fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');console.log('DST profile generated: '+profiles[path].verification);
