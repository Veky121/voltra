import fs from 'node:fs';
const path='project_zomboid/egg-project-zomboid.json';
const entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(item=>item.path===path);
const file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file)),egg=structuredClone(entry.egg);
const runtime='ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b';
egg.description+=' Native Steam setup with preserved .cache worlds/configuration, generated administrator bootstrap, allocated ports and bounded JVM memory. Uses publisher Java metadata without rewriting the launcher JSON.';
egg.features=[...new Set([...egg.features,'voltra_steam_template'])];
egg.docker_images={'Debian Steam runtime':runtime};
egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/project_zomboid_runtime.py';
egg.config={files:'{}',startup:JSON.stringify({done:'SERVER STARTED'}),logs:'{}',stop:'quit'};
const original={
 SERVER_NAME:{rules:'required|string|max:64|regex:/^[A-Za-z0-9]+$/',description:'Internal save/configuration prefix. Keep this unchanged to resume the same world and account database. Use Public name for the displayed name.'},
 ADMIN_USER:{rules:'required|string|max:20|not_regex:/[\\x00-\\x1f\\x7f]/',description:'Initial administrator username. Existing native accounts are preserved; changing the bootstrap password does not reset an existing account.'},
 ADMIN_PASSWORD:{rules:'nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f]/',description:'Initial administrator password. Empty generates a private credential in .voltra/project-zomboid/admin-password. Only supplied when the native account does not already exist.'},
 STEAM_PORT:{default_value:'0',rules:'required|integer|between:0,65535',description:'Secondary native UDP port. Zero selects an additional allocation on the game address automatically. An explicit port must be allocated to this server.'},
 SRCDS_APPID:{rules:'required|string|in:380870'},
 SRCDS_BETAID:{rules:'nullable|string|max:64|regex:/^[A-Za-z0-9][A-Za-z0-9_.-]*$/',description:'Steam branch. Empty selects the publisher stable branch. Stop, back up .cache and reinstall when switching branches; worlds may not be compatible across builds.'},
 AUTO_UPDATE:{rules:'required|boolean',description:'Enable the typed Steam helper on startup. The runtime image legacy updater is disabled by the panel so only one updater runs. Off performs no Steam mutation on startup.'},
};
for(const variable of egg.variables)Object.assign(variable,original[variable.env_variable]);
for(const [name,key,description,value,rules]of [
 ['Public name','PUBLIC_NAME','Displayed native server name. Quotes and dollar signs are literal text; does not change the save/configuration prefix.','Project Zomboid server','required|string|max:255|not_regex:/[\\x00-\\x1f\\x7f]/'],
 ['Maximum players','MAX_PLAYERS','Native player limit. Increase resources before increasing capacity.','16','required|integer|between:1,100'],
 ['Server password','SERVER_PASSWORD','Optional native password for joining.','','nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f]/'],
 ['Public listing','PUBLIC_SERVER','Private by default. Enable only when you want native public server listing.','0','required|boolean'],
 ['Pause while empty','PAUSE_EMPTY','Native PauseEmpty behavior when no players are connected.','1','required|boolean'],
 ['Player combat','PVP','Native player-versus-player setting.','1','required|boolean'],
 ['UPnP','UPNP','Native automatic router mapping. Disabled by default; allocated direct connections do not require it.','0','required|boolean'],
 ['Java heap (MiB)','JAVA_HEAP_MB','Zero uses 75% of the container memory limit. Explicit heap sizes must leave at least 512 MiB for native/JVM overhead.','0','required|integer|between:0,524288'],
 ['Steam username','STEAM_USER','Anonymous by default. Optional account login for branches requiring ownership. Credentials must not begin with + or -.','anonymous','nullable|string|max:64|not_regex:/[\\x00-\\x1f\\x7f]/|not_regex:/^[+-]/'],
 ['Steam password','STEAM_PASS','Optional account password. Native interactive Steam Guard prompts are disabled; use the authentication code field if required.','','nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f]/|not_regex:/^[+-]/'],
 ['Steam authentication code','STEAM_AUTH','Optional Steam Guard code.','','nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f]/|not_regex:/^[+-]/'],
 ['Beta password','SRCDS_BETAPASS','Optional password for a selected private Steam branch.','','nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f]/|not_regex:/^[+-]/'],
])egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
for(const [source,target]of [['steam-template.py','steam_template.py'],['bundle-debian-python.py','bundle_debian_python.py'],['project-zomboid-runtime.py','project_zomboid_runtime.py']])script+=`cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SOURCE\n`;
script+='python3 .voltra/bundle_debian_python.py\nPYTHONPATH=.voltra python3 - <<\'VOLTRA_INSTALL\'\nfrom pathlib import Path\nfrom steam_template import update\nupdate(Path.cwd(), 380870, required=("ProjectZomboid64.json", "jre64/bin/java"))\nVOLTRA_INSTALL\n';
egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
const previous=profiles[path]||{};
profiles[path]={upstream_sha256:entry.sha256,revision:'project-zomboid-native-v1',platforms:['linux/amd64'],required_ports:2,defaults:{memory:6144,disk:32768},egg,verification:previous.verification||'not_verified',detail:previous.detail||'Native Steam setup implemented; real publisher-package acceptance pending.',setup_steps:[
 'Choose a Linux x64 node and two free ports on the same address. The shared form selects an additional port automatically. Leave SteamPort at zero to use that allocated UDP port.',
 'Steam installs first. Start from Console after installation; native SERVER STARTED indicates readiness. Match your game client to the selected server branch.',
 'SERVER_NAME is the original internal prefix for .cache/Server configuration, .cache/db accounts and .cache/Saves/Multiplayer worlds. Keep it unchanged to resume the same server. Public name is separate.',
 'Empty Admin Password generates .voltra/project-zomboid/admin-password on first bootstrap. Existing native administrator accounts are not overwritten. Use native account commands to change an existing password.',
 'Native console commands pass through unchanged. Stop sends quit so the server can save before leaving the container. Back up the full .cache directory and bootstrap credential before changing branches or replacing world files.',
 'Native INI comments, unknown options, sandbox Lua, spawn configuration, mods and worlds stay editable in Files. Managed form fields are applied to the prefix INI at startup, with private backups of prior configuration.',
 'The publisher JVM options/classpath are reused, replacing only heap sizes. Default heap is bounded by container memory. The bundled Java runtime is retained; publisher launcher JSON is not overwritten.',
 'AUTO_UPDATE is routed to the typed helper by the panel. Off skips startup updates. Reinstall validates publisher files and can replace modified stock engine files; keep operator mods/configuration in their supported persistent locations.',
]};
fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');console.log('Project Zomboid shared-form profile generated; verification: '+profiles[path].verification+'.');
