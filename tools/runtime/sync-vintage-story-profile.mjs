import fs from 'node:fs';
const path='vintage_story/egg-vintage-story.json';
const entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===path);
const file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file)),egg=structuredClone(entry.egg);
egg.description+=' Reviewed default: 1.22.7 with .NET 10. Installation stages the engine separately from persistent data and retains the previous engine on updates. Other versions and branches require separate runtime verification.';
// Keep the original .NET 8 and 9 choices for older supported native releases.
egg.docker_images={'Dotnet 10':'ghcr.io/ptero-eggs/yolks@sha256:9173704345a6ea815622cede2ef15cd7f317f4374d4b7a361929d2d4756ed351','Dotnet 9':'ghcr.io/ptero-eggs/yolks:dotnet_9','Dotnet 8':'ghcr.io/ptero-eggs/yolks:dotnet_8'};
egg.startup='exec python3 .voltra/vintage-story-runtime.py';
egg.config.files='{}';
for(const variable of egg.variables){
 if(variable.env_variable==='RELEASE_VERSION'){variable.default_value='1.22.7';variable.description='Pinned reviewed default. latest resolves through the HTTPS publisher feed. Pre requires an explicit version; the publisher currently supplies no pre-release checksum.';variable.rules='required|string|max:40|regex:/^(latest|[0-9]+\\.[0-9]+\\.[0-9]+(-[A-Za-z0-9.]+)?)$/';}
 if(variable.env_variable==='MAX_CLIENTS')variable.rules='required|integer|between:1,256';
 if(variable.env_variable==='OPTIONS'){variable.description='Native flags with shell-style quoting. These are passed as literal arguments, without shell evaluation. A custom --dataPath changes where your server saves data; include that directory in backups.';variable.rules='nullable|string|max:200|not_regex:/[\\r\\n\\x00]/';}
}
let script='#!/bin/bash\nset -euo pipefail\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\nmkdir -p .voltra\n';
for(const name of ['vintage-story-install.py','vintage-story-runtime.py']){
 const source=fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8');
 script+=`cat > .voltra/${name} <<'VOLTRA_PYTHON_SOURCE'\n${source}\nVOLTRA_PYTHON_SOURCE\n`;
}
script+='python3 .voltra/vintage-story-install.py\n';
egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
const previous=profiles[path]||{};
profiles[path]={upstream_sha256:entry.sha256,revision:'vintage-story-1.22.7-v1',platforms:['linux/amd64'],defaults:{memory:4096,disk:8192},egg,verification:previous.verification||'not_verified',detail:previous.detail||'Implementation under review; live Linux acceptance pending.',setup_steps:[
 'Use .NET 10 for the pinned 1.22.7 release. Choose .NET 8 or 9 only when that older game release requires it. Clients and server mods must match the server version.',
 'After installation, start from Console and connect to the allocated address. Current releases use TCP and UDP on the game port. New native servers are private and whitelisted by default. Add your players to the whitelist using native Console commands, or explicitly change the whitelist mode for your intended access policy.',
 'Stop before editing data/serverconfig.json through Files. Set the server name, password and advertisement there, or use native Console commands. Existing roles, world settings and mods remain native.',
 'Back up the whole data directory, including Saves, Mods, ModConfig and player records. Custom --dataPath options require their own backups. Stop uses the native /stop command.',
 'The managed engine is under .voltra/vintage-story/current. Updating retains the previous engine directory. Same-version reinstalls retain operator overrides. Original root-level installation files are left untouched.',
 'Stable and unstable use publisher checksums. Explicit pre releases remain available but currently have no publisher checksum. Only the pinned stable build is eligible for the recorded acceptance scope.',
]};
fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');
console.log('Vintage Story profile generated; live runtime verification remains separate.');
