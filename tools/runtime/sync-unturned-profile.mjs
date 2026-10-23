import fs from 'node:fs';
const path='unturned/egg-unturned.json';
const entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===path);
const file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file)),egg=structuredClone(entry.egg);
egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
egg.docker_images={'Debian Steam runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
egg.startup='exec bash .voltra/unturned-entry.sh';
egg.config={files:'{}',startup:JSON.stringify({done:'Loading level: 100%'}),logs:'{}',stop:'shutdown'};
const changes={
 SRV_NAME:{rules:'required|string|max:50|not_regex:/[\\x00-\\x1f\\x7f]/'},
 SRV_PW:{rules:'nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f]/'},
 GSLT:{rules:'nullable|required_if:environment.PUBLIC_SERVER,1|string|max:128|regex:/^[A-Za-z0-9]+$/',description:'Optional for LAN. Internet mode requires a token created for game AppID 304930, not dedicated-server AppID 1110390.'},
 SRV_ID:{rules:'required|string|max:64|regex:/^[A-Za-z0-9_-]+$/',description:'Persistent Servers/<ID> save identity. Keep unchanged to resume the same world.'},
 SRCDS_APPID:{rules:'required|string|in:1110390'},
 AUTO_UPDATE:{rules:'required|boolean',description:'Use the shared Steam updater at startup. The panel disables the runtime image legacy updater to avoid duplicate updates.'},
};
for(const variable of egg.variables)Object.assign(variable,changes[variable.env_variable]);
for(const [name,key,description,value,rules]of [
 ['Internet server','PUBLIC_SERVER','LAN is the default. Internet mode requires a GSLT and reachable game ports.','0','required|boolean'],
 ['Offline LAN','OFFLINE_ONLY','Skip Steam backend connectivity. Internet mode must be disabled. Workshop content must already be cached.','0','required|boolean'],
 ['Map','GAME_MAP','Native map name, including installed Workshop maps.','PEI','required|string|max:128|not_regex:/[\\x00-\\x1f\\x7f\\/\\\\]/'],
 ['Maximum players','MAX_PLAYERS','Native player limit.','24','required|integer|between:1,48'],
 ['Difficulty','DIFFICULTY','Native difficulty preset.','Normal','required|string|in:Easy,Normal,Hard'],
 ['Perspective','PERSPECTIVE','Allowed player camera perspective.','Both','required|string|in:First,Third,Both,Vehicle'],
 ['Player combat','PVP','Disable to select native PvE.','1','required|boolean'],
 ['Owner SteamID64','OWNER_ID','Optional administrator owner. Empty preserves an existing Owner command.','','nullable|string|max:20|regex:/^[0-9]+$/'],
 ['Autosave interval','AUTOSAVE_SECONDS','Send native Save after readiness at this interval. Zero disables scheduled saves. Native Shutdown also saves.','300','required|integer|between:0,86400'],
])egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
for(const [source,target]of [['steam-template.py','steam_template.py'],['bundle-debian-python.py','bundle_debian_python.py'],['native-console.py','native_console.py'],['unturned-runtime.py','unturned_runtime.py']])script+=`cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SOURCE\n`;
script+=`cat > .voltra/unturned-entry.sh <<'VOLTRA_ENTRY'
#!/bin/bash
set -euo pipefail
export VOLTRA_GAME_LIBRARY_PATH="\${LD_LIBRARY_PATH:-./Unturned_Headless_Data/Plugins/x86_64/}"
export PYTHONHOME=/home/container/.voltra/python
export LD_LIBRARY_PATH=/home/container/.voltra/python/lib
exec .voltra/python/bin/python3 .voltra/unturned_runtime.py
VOLTRA_ENTRY
python3 .voltra/bundle_debian_python.py
PYTHONPATH=.voltra python3 - <<'VOLTRA_INSTALL'
from pathlib import Path
from steam_template import update
root=Path.cwd()
update(root,1110390,required=('Unturned_Headless.x86_64',))
# Preserve operator modules and publisher SDK files; install the original bundled Rocket when available.
rocket=root/'Modules/Rocket.Unturned'
if (root/'Extras/Rocket.Unturned').is_dir() and not rocket.exists() and not rocket.is_symlink():
    rocket.parent.mkdir(parents=True,exist_ok=True)
    rocket.symlink_to('../Extras/Rocket.Unturned',target_is_directory=True)
plugin=root/'Unturned_Headless_Data/Plugins/x86_64/steamclient.so'
if not plugin.exists() and not plugin.is_symlink():
    plugin.parent.mkdir(parents=True,exist_ok=True)
    plugin.symlink_to('../../../.voltra/steamcmd/linux64/steamclient.so')
VOLTRA_INSTALL
`;
egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
const previous=profiles[path]||{};
profiles[path]={upstream_sha256:entry.sha256,revision:'unturned-native-v1',platforms:['linux/amd64'],required_ports:2,consecutive_ports:true,defaults:{memory:4096,disk:16384},egg,verification:previous.verification||'not_verified',detail:previous.detail||'Native Steam setup implemented; publisher-package acceptance pending.',setup_steps:[
 'Choose a Linux x64 node with two consecutive free ports on the same address. The first is the query port; the next is gameplay.',
 'LAN mode needs no GSLT. Internet mode requires a game-server login token created for Unturned AppID 304930 and reachable ports.',
 'Keep the original server ID unchanged to retain Servers/<ID> worlds, Workshop configuration and player data. Back up the entire identity directory.',
 'Managed settings update Server/Commands.dat with private backups. Comments and unrecognized commands remain editable in Files. Keep advanced settings in the publisher configuration files.',
 'The original bundled Rocket module is linked when available; existing operator modules are preserved. Additional Workshop maps and mods use the native WorkshopDownloadConfig.json file.',
 'Console commands pass through to the native server. Autosave sends Save after readiness; Stop sends Shutdown. Wait for offline before replacing saves or configuration.',
 'AUTO_UPDATE uses the shared typed updater. Reinstall validates publisher files and preserves operator identity directories; back up modified stock engine files separately.',
]};
fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');
console.log('Unturned shared setup profile generated: '+profiles[path].verification);
