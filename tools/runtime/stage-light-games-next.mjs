import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const profiles={};
const definitions=[['banana','banana_shooter/egg-banana-shooter.json',2048,8192,1,'Connect to steam server successfully'],['nuclear','nuclear_option/egg-nuclear-option.json',2048,8192,2,'[DedicatedServerManager] Waiting for Players before loading next map'],['puck','puck/egg-puck.json',1024,4096,2,'Voltra Puck compatibility ready']];
for(const[game,path,memory,disk,ports,ready]of definitions){
 const entry=catalog.entries.find(e=>e.path===path);if(!entry)throw Error('Missing original recipe '+path);
 const egg=structuredClone(entry.egg);
 egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
 egg.docker_images={'Pinned Debian native runtime':'ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8'};
 egg.startup='exec python3 .voltra/light_games_next_runtime.py '+game;
 egg.config={files:'{}',startup:JSON.stringify({done:ready}),logs:'{}',stop:'^SIGTERM'};
 if(game==='banana')for(const v of egg.variables){
  if(['STEAM_USER','STEAM_PASS','STEAM_AUTH'].includes(v.env_variable)){v.rules='nullable|string';v.description='Original account control retained. Current anonymous install was denied No subscription despite older publisher docs. Private Steam account credentials currently fail closed before installation; this prerequisite remains unsupported.';}
  if(v.env_variable==='STEAM_GSLT'){v.rules='nullable|string';v.description='Optional operator-owned publisher game-server login token for public listing. Blank is LAN-only. Preserved in native Login_Token and legacy STEAM_GSLT.';}
 }
 if(game==='puck')for(const v of egg.variables){
  if(v.env_variable==='FRAME_RATE')v.description='Unity server frame target, separate from physics and client input cadence. The publisher-supported server-only compatibility plugin restores this original control.';
  if(v.env_variable==='SERVER_TICK_RATE')v.description='Native server physics and synchronized-object tick rate. Independent from client input rate and the frame target.';
  if(v.env_variable==='CLIENT_TICK_RATE')v.description='Input-send tick rate advertised to stock clients through the native synchronized Server state; no client plugin is required. Very high rates can increase load.';
  if(v.env_variable==='KICK_TIMEOUT')v.description='Seconds a kicked Steam ID must wait before rejoining. This is the native kick timeout; the old egg incorrectly described it as an AFK timer.';
  if(v.env_variable==='QUERY_PORT')v.description='Additional native publisher TCP preview listener. The stock primary TCP/UDP game listener remains available. This is not an invented UDP ping service.';
 }
 for(const v of egg.variables)if(v.env_variable==='QUERY_PORT')v.description+=' Select an explicitly allocated second port distinct from the primary. Legacy defaults are retained and rejected if unallocated; no silent port substitution.';
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\ncd /mnt/server\nmkdir -p .voltra\n';
 for(const source of ['steam-template.py','native-config.py','native-console.py','light-games-next-runtime.py','light-games-next-install.py',...(game==='puck'?['puck-legacy-controls.cs','puck-legacy-controls.csproj']:[])])script+=`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_LIGHT_GAMES_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_LIGHT_GAMES_SOURCE\n`;
 script+='python3 .voltra/light_games_next_install.py '+game+'\n';
 egg.scripts.installation={container:'mcr.microsoft.com/dotnet/sdk@sha256:8dd1a57fe6b7b8b1b357635db67e272c2f9e9d76d1dd0a32711c4c33c57d7b43',entrypoint:'bash',script};
 profiles[path]={revision:game+'-native-v1',upstream_sha256:entry.sha256,platforms:['linux/amd64'],required_ports:ports,defaults:{memory,disk},verification:'not_verified',detail:'Source adapter prepared; publisher depot layout, console shutdown and native acceptance remain unverified.',egg,setup_steps:['Choose a Linux x64 node and '+ports+' allocation'+(ports>1?'s. Explicitly select a distinct query port.':'.'),'Public anonymous Steam installation retains the original app ID and auto-update control. Private credentials are unsupported and rejected before writes.','Existing native JSON, unknown settings, mods, rotations and bans remain operator-owned. Reinstall restores exact existing configuration bytes and metadata.']};
 if(ports>1)profiles[path].port_rules=[{environment:'QUERY_PORT',condition:'nonzero',allocated_value:true,auto_allocate:true,exclude_primary:true,minimum:1025,maximum:65535,count:2}];
 if(game==='banana'){
  profiles[path].detail='Current anonymous Steam install denied No subscription. Original account controls remain, but private Steam credential transport is unsupported. Publisher server layout, token mapping and native lifecycle remain unverified.';
  profiles[path].setup_steps[1]='Publisher entitlement is required: the actual anonymous attempt returned No subscription. Older publisher docs disagree. Private account credentials remain fail-closed; no credential workaround or third-party server mirror is used.';
 }
 if(game==='puck'){
  profiles[path].detail='Current Linux publisher build and server-only MIT compatibility plugin restore original controls through native physics/input/frame/timeout APIs and native TCP preview. Native settings, both query endpoints, private compiler update, reinstall/reload and normal stop passed; root review pending.';
  profiles[path].setup_steps=['Select a Linux x64 node and two allocations: primary UDP/TCP game port plus additional TCP query port. The existing shared form can choose the query allocation automatically.','Original server_configuration.json remains the legacy settings API. Supported values and phase/mod fields migrate to current native server_config.json and public_game_mode_config.json; unknown operator settings remain preserved.','The MIT VoltraLegacyControls plugin uses the publisher local IPuckPlugin loader and shipped HarmonyX. It restores independent physics, client input, frame target, kick timeout and the real query endpoint without a client plugin.','The pinned SDK installer prepares a private 122 MiB .NET10/Roslyn compiler with Microsoft license notices. Automatic updates can recompile against the installed publisher API without a global SDK. Current public Steam credentials remain anonymous.'];
 }
}
fs.mkdirSync('.local/light-games-next',{recursive:true});fs.writeFileSync('.local/light-games-next/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged three unverified native profiles; shared overrides untouched.');
