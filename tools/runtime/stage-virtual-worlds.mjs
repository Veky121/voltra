import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const profiles={};
const definitions=[
 ['neos','neosvr/egg-neos-v-r.json','Mono legacy headless','327404b6358bdc3b558587713b21fbc1719c10b369a38f32b33045954ab4627b',2048,8192],
 ['resonite','resonite/egg-resonite.json','.NET 10 headless','9173704345a6ea815622cede2ef15cd7f317f4374d4b7a361929d2d4756ed351',4096,12288],
];
for(const[game,path,label,digest,memory,disk]of definitions){
 const entry=catalog.entries.find(e=>e.path===path);if(!entry)throw Error('Missing original recipe '+path);
 const egg=structuredClone(entry.egg);
 egg.docker_images={[label]:'ghcr.io/ptero-eggs/yolks@sha256:'+digest};
 egg.startup='exec python3 .voltra/virtual_worlds_runtime.py '+game;
 egg.config={files:'{}',startup:JSON.stringify({done:game==='nwn'?'VOLTRA_NWN_READY':'World running'}),logs:'{}',stop:game==='nwn'?'^C':'shutdown'};
 if(game!=='nwn'){
  // Shared React setup derives bool/secret controls from these same variables.
  // Keep original defaults, visibility/editability and entitlement rules.
  egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
  for(const variable of egg.variables){
   if(['STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS'].includes(variable.env_variable))
    variable.description+=' Preserved entitlement control. Private Steam transport is unavailable and fails before writes. To run your own legally acquired headless files, disable AUTO_UPDATE; do not share access codes.';
   if(variable.env_variable==='ENABLE_MODLOADER')variable.description+=' Pinned LGPL loader plus MIT Harmony installed only when enabled. Existing different loader bytes are preserved and require explicit version resolution.';
  }
 }
 if(game==='nwn')for(const variable of egg.variables){
  if(variable.env_variable==='NWN_VERSION')variable.description+=' latest selects the newest numeric version in the official Beamdog archive index, verified by publisher SHA256. Outdated Beamdog Docker tags are not used.';
  if(variable.env_variable==='SAVE_SLOT')variable.description+=' Now applies -load; slots 0 and 1 are reserved. A nonblank slot takes precedence over MODULE_NAME.';
  if(['MIN_LEVEL','MAX_LEVEL'].includes(variable.env_variable)){variable.rules='required|integer|min:1|max:40';variable.description+=' Current native 8193.37-17 supports levels 1 through 40; the old max-level default 100 is rejected by the publisher.';}
  if(variable.env_variable==='MAX_LEVEL')variable.default_value='40';
  if(['PLAYER_PASSWORD','DM_PASSWORD'].includes(variable.env_variable))variable.description+=' Written to owner-private user/settings.tml; never included in process arguments or native environment.';
 }
 let script='#!/bin/bash\nset -euo pipefail\ncd /mnt/server\nmkdir -p .voltra\n';
 for(const source of ['steam-template.py','native-console.py','virtual-worlds-runtime.py','virtual-worlds-install.py','virtual-worlds-releases.json'])
  script+=`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_VIRTUAL_WORLDS_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_VIRTUAL_WORLDS_SOURCE\n`;
 if(game==='nwn')script+='export DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates libstdc++6 libnss-wrapper=1.1.15-2\npython3 .voltra/virtual_worlds_install.py nwn\n';
 else script+="printf '%s\\n' 'Headless installation is unavailable: entitled private Steam credential transport is not enabled. Runtime helper files were prepared only. Upload your own legal headless payload and disable AUTO_UPDATE to run it.' >&2\nexit 1\n";
 egg.scripts.installation={container:'mcr.microsoft.com/dotnet/sdk@sha256:8dd1a57fe6b7b8b1b357635db67e272c2f9e9d76d1dd0a32711c4c33c57d7b43',entrypoint:'bash',script};
 profiles[path]={revision:game+'-virtual-worlds-v1',upstream_sha256:entry.sha256,platforms:['linux/amd64'],required_ports:1,defaults:{memory,disk},verification:'not_verified',egg,
  detail:game==='nwn'?'Source adapter with official archive SHA256, typed original controls, private TOML passwords and saved-slot loading. Native console, module load, networking and persistence acceptance are pending.':
   'Source adapter only. Entitled private Steam branch installation and automatic updates are blocked by unverified private credential transport. Operator-acquired headless files can run with AUTO_UPDATE=0; no native or entitlement acceptance claim.',
  setup_steps:game==='nwn'?[
   'Choose a Linux x64 node and one allocated UDP port. Install the official archive, with publisher checksum verification.',
   'Upload a legally owned module to user/modules or choose an existing save slot. The dedicated archive does not include a playable campaign module.',
   'Configure existing startup controls. Passwords stay in private user/settings.tml; user saves, vaults, databases, custom modules and unknown settings are preserved.',
   'Modified or unmanaged program collisions fail instead of being overwritten. Native acceptance remains pending.'
  ]:[
   'The original headless branch requires a publisher supporter entitlement, your own Steam account and a private beta access code. Private Steam authentication and updates are not enabled in this app.',
   'Installation currently fails closed. For operator-acquired legal payloads, upload the correct headless directory, retain the publisher license and set AUTO_UPDATE=0.',
   game==='neos'?'Neos expects Neos.exe at the volume root and Mono. Resonite files are not compatible.':'Current Resonite expects Headless/Resonite.dll and .NET 10; the original Mono/Resonite.exe startup is obsolete.',
   'Existing Config/Config.json, worlds, databases and plugins remain operator-owned. A missing configuration gets a private Grid session on the allocated LNL port; configure accounts and public hosting explicitly.',
   'Additional listener protocols and worlds require selected allocations. Peer connectivity, entitlement login, plugin compatibility and clean native shutdown are not yet verified.'
  ]};
}
fs.mkdirSync('.local/virtual-worlds',{recursive:true});
fs.writeFileSync('.local/virtual-worlds/profiles.json',JSON.stringify(profiles,null,2)+'\n');
console.log('Staged two source-only virtual-world profiles; canonical overrides untouched.');
