import fs from 'node:fs';
import crypto from 'node:crypto';
const base='internal/panel/game_library/scripts/';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const games={brickadia:'brickadia/egg-brickadia.json',longvinter:'longvinter/egg-longvinter.json',frozen:'frozen_flame/egg-frozen-flame.json'};
const metadata={},profiles={};
for(const [game,path] of Object.entries(games)){
 const entry=catalog.entries.find(e=>e.path===path),egg=structuredClone(entry.egg);
 const info={app:Number(egg.variables.find(v=>v.env_variable==='SRCDS_APPID').default_value),defaults:Object.fromEntries(egg.variables.map(v=>[v.env_variable,String(v.default_value)])),ready:JSON.parse(egg.config.startup).done,ports:game==='brickadia'?[]:game==='longvinter'?['QUERY_PORT']:['QUERY_PORT','RCON_PORT']};
 if(game==='brickadia')Object.assign(info,{binary:'Brickadia/Binaries/Linux/BrickadiaServer-Linux-Shipping',config:'.config/Epic/Brickadia/Saved/Config/LinuxServer/GameUserSettings.ini',preserve:['.config/Epic/Brickadia/Saved']});
 else if(game==='longvinter')Object.assign(info,{server_app:1639880,binary:'longvinter-linux-server/Longvinter/Binaries/Linux/LongvinterServer-Linux-Shipping',config:'longvinter-linux-server/Longvinter/Saved/Config/LinuxServer/Game.ini',preserve:['longvinter-linux-server/Longvinter/Saved'],ini:{'/Game/Blueprints/Server/GI_AdvancedSessions.GI_AdvancedSessions_C':{ServerName:'SERVER_NAME',ServerTag:'SERVER_TAG',MaxPlayers:'MAX_PLAYERS',ServerMOTD:'SERVER_MOTD',Password:'SERVER_PASSWORD',CommunityWebsite:'COMMUNITY_WEBSITE'},'/Game/Blueprints/Server/GM_Longvinter.GM_Longvinter_C':{AdminSteamID:'ADMIN_ID',PVP:'ENABLE_PVP',TentDecay:'ENABLE_TENTDECAY',MaxTents:'MAX_TENTS'}}});
 else Object.assign(info,{binary:'FrozenFlame/Binaries/Linux/FrozenFlameServer-Linux-Shipping',config:'FrozenFlame/Saved/Config/LinuxServer/Game.ini',preserve:['FrozenFlame/Saved'],default_config:{url:'https://raw.githubusercontent.com/DreamsideInteractive/FrozenFlameServer/5ba636b3b11c1371f382e506091b67b66fea795e/Game.ini',sha256:'05c25149123a6f12ff40abfdcc9a4d0b3551b472959e0b7ef8c615585d535813'}});
 metadata[game]=info;
 for(const variable of egg.variables)if(info.ports.includes(variable.env_variable)){
  variable.default_value='';variable.user_editable=true;variable.rules='nullable|integer|between:1024,65535';variable.description+=' Blank chooses a distinct selected allocation.';
 }
 egg.features=[...new Set([...(egg.features??[]),'voltra_steam_template'])];
 egg.docker_images={'Pinned dedicated Linux runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/unreal_building.py run ${game}`;
 egg.config={files:'{}',startup:JSON.stringify({done:info.ready}),logs:'{}',stop:game==='brickadia'?'exit':'^C'};
 profiles[path]={upstream_sha256:entry.sha256,revision:'unreal-building-v1',platforms:['linux/amd64'],required_ports:info.ports.length+1,defaults:{memory:game==='longvinter'?3072:4096,disk:16384},verification:'not_verified',detail:'Typed source implementation and isolated fixtures only; native installation, readiness, persistence and peer gameplay pending.',port_rules:info.ports.map(environment=>({environment,condition:'nonzero',allocated_value:true,auto_allocate:true,exclude_primary:true,minimum:1024,maximum:65535,count:info.ports.length+1})),egg,setup_steps:[
  'Uses original controls and typed Linux dedicated acquisition. Blank service ports select distinct operator-selected allocations. Original fixed query/RCON numbers are no longer silently assumed; invalid65536 is rejected.',
  game==='brickadia'?'Original Steam app3017590, optional world, server name/password/listing and hosting token remain. Create your own dedicated hosting token at brickadia.com/account. Token remains the original native -token argument and is redacted from console output, but same-UID process inspection can see it. Config/worlds remain under .config/Epic/Brickadia/Saved. Console exit is retained. No token authentication or world loading claim before native proof.':game==='longvinter'?'Publisher retired/reinitialized the original Git/LFS server repository and officially moved Linux distribution to Steam app1639880. Original hidden SRCDS_APPID1007 still installs the SDK; the current server tool installs into the original longvinter-linux-server path. All10 name/tag/MOTD/password/website/admin/PVP/tent settings remain. No untrusted packagecloud shell, git restore/stash, world deletion or chmod777. AUTO_UPDATE gates managed startup updates, and reinstall preserves saves in either setting.':'Original Steam app1348640 and all8 variables remain, including query/RCON ports/password and optional blank-app-ID auto-update suppression. Missing Game.ini uses checksum-pinned publisher commit5ba636b3. Existing game settings, custom balance values and saves are retained. The imported malformed curl overwrite and printable ^^C stop are corrected. Native RCON uses original argv password; upstream clients use admin:<password>. No RCON authentication or saving proof yet.',
  'Retains unknown native INI fields/comments and restores operator saves/config bytes/mode/UID/GID after publisher validation or failure. Private Steam account/Guard/beta-password acquisition remains failclosed. Console and native process exit statuses remain real.',
 ]};
}
fs.writeFileSync(base+'unreal-building-release.json',JSON.stringify(metadata,null,2)+'\n');
const sources=['steam-template.py','native-console.py','native-config.py','bundle-debian-python.py','unreal-building.py','unreal-building-release.json'];
for(const [game,path] of Object.entries(games)){
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 for(const source of sources)script+=`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_BUILDING_SOURCE'\n${fs.readFileSync(base+source,'utf8')}\nVOLTRA_BUILDING_SOURCE\n`;
 script+=`python3 .voltra/bundle_debian_python.py\npython3 .voltra/unreal_building.py install ${game}\n`;
 profiles[path].egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
}
const output='.local/unreal-building';fs.mkdirSync(output+'/sources',{recursive:true});const hashes={};
for(const source of sources){const bytes=fs.readFileSync(base+source);fs.writeFileSync(output+'/sources/'+source,bytes);hashes[source]=crypto.createHash('sha256').update(bytes).digest('hex');}
fs.writeFileSync(output+'/profiles.json',JSON.stringify(profiles,null,2)+'\n');fs.writeFileSync(output+'/source-manifest.json',JSON.stringify(hashes,null,2)+'\n');
console.log('Staged Brickadia, Longvinter and Frozen Flame; canonical profiles unchanged.');
