import fs from 'node:fs';
import crypto from 'node:crypto';
const base='internal/panel/game_library/scripts/';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const games={abiotic:'abiotic_factor/egg-abiotic-factor.json',humanitz:'humanitz/egg-humanit-z.json',front:'thefront/egg-the-front.json'};
const metadata={},profiles={};
for(const [game,path] of Object.entries(games)){
 const entry=catalog.entries.find(e=>e.path===path),egg=structuredClone(entry.egg);
 const defaults=Object.fromEntries(egg.variables.map(v=>[v.env_variable,String(v.default_value)]));
 if(game==='front')defaults.WINDOWS_INSTALL='0';
 const info={app:Number(defaults.SRCDS_APPID),platform:game==='abiotic'?'windows':'linux',defaults,types:{},ports:game==='front'?['BEACON_PORT','QUERY_PORT','SHUTDOWN_PORT']:['QUERY_PORT'],ready:game==='abiotic'?'IpNetDriver listening on port':game==='humanitz'?'Success => Session created!':JSON.parse(egg.config.startup).done};
 info.binaries=game==='abiotic'?['AbioticFactor/Binaries/Win64/AbioticFactorServer-Win64-Shipping.exe']:game==='humanitz'?['HumanitZServer/Binaries/Linux/HumanitZServer-Linux-Shipping','TSSGame/Binaries/Linux/TSSGameServer-Linux-Shipping']:['ProjectWar/Binaries/Linux/TheFrontServer','ProjectWar/Binaries/Win64/TheFrontServer.exe'];
 info.preserve=game==='abiotic'?['AbioticFactor/Saved']:game==='humanitz'?['TSSGame/GameServerSettings.ini','TSSGame/Saved','HumanitZServer/GameServerSettings.ini','HumanitZServer/Saved','HumanitZServer/*.txt','TSSGame/*.txt']:['TheFrontManager','ProjectWar/Saved'];
 for(const v of egg.variables){if(/boolean|in:true,false/.test(v.rules))info.types[v.env_variable]='boolean';else if(/numeric|integer/.test(v.rules))info.types[v.env_variable]='number';}
 if(game==='humanitz'){
  info.ini={};for(const f of Object.values(JSON.parse(egg.config.files)))for(const [key,value] of Object.entries(f.find)){
   const match=key.match(/^\[([^\]]+)\]\.(.+)$/),env=value.match(/env\.([A-Z_]+)/)[1];
   (info.ini[match[1]]??={})[match[2]]=env;
  }
 }
 if(game==='front'){
  info.args={};for(const m of egg.startup.matchAll(/-([A-Za-z.]+)=(?:"?)\{\{([A-Z_]+)\}\}/g))info.args[m[1]]=m[2];
  delete info.args.OutIPAddress;
  info.fixed_args=['-EnableParallelCharacterMovementTickFunction','-EnableParallelCharacterTickFunction','-UseDynamicPhysicsScene','-Game.PhysicsVehicle=false','-ansimalloc','-Game.MaxFrameRate=35','-MaxQueueSize=50','-QueueValidTime=120','-GMOverlapRatio=2'];
 }
 metadata[game]=info;
 for(const variable of egg.variables){
  if(game==='humanitz'){
   const legacy=['ONLY_ALLOWED_PLAYERS','CLEAR_INFECTION','EAGLE_EYE','LOOT_RARITY','HUMAN_DIFFICULTY'];
   if(legacy.includes(variable.env_variable))variable.description+=' Current publisher reference settings do not list this legacy control. Its behavior'+(variable.env_variable==='ONLY_ALLOWED_PLAYERS'?', including whitelist enforcement,':'')+' has not been verified.';
   if(variable.env_variable==='SAVE_INTERVAL_SEC')variable.description+=' In the tested current Linux build, a configured interval of 30 seconds was reported by the game as 60 seconds. Other values have not been exhaustively verified.';
  }
  if(game==='front'&&variable.env_variable==='WINDOWS_INSTALL')variable.default_value='0';
  if(info.ports.includes(variable.env_variable)){
   variable.default_value='';variable.user_editable=true;variable.rules='nullable|integer|between:1024,65535';
   variable.description+=' Blank chooses a distinct selected allocation.';
  }
 }
 if(game==='front')egg.description+=' WINDOWS_INSTALL now defaults to0 to match the original Linux startup binary. Windows=1 remains explicit but requires a publisher-compatible Windows depot and is not verified.';
 egg.features=[...new Set([...(egg.features??[]),'voltra_steam_template'])];
 egg.docker_images={'Pinned dedicated Linux / private Proton runtime':'ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8'};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/unreal_survival_runtime.py ${game}`;
 egg.config={files:'{}',startup:JSON.stringify({done:info.ready}),logs:'{}',stop:'^C'};
 profiles[path]={upstream_sha256:entry.sha256,revision:'unreal-survival-v1',platforms:['linux/amd64'],required_ports:info.ports.length+1,defaults:{memory:game==='humanitz'?6144:game==='front'?10240:8192,disk:32768},verification:'not_verified',detail:'Typed source implementation; native install, shutdown/save and transport acceptance pending.',port_rules:info.ports.map(environment=>({environment,condition:'nonzero',allocated_value:true,auto_allocate:true,exclude_primary:true,minimum:1024,maximum:65535,count:info.ports.length+1})),egg,setup_steps:[
  'All original startup controls remain literal argv or managed native INI fields. Allocate distinct native gameplay and service ports. Blank service ports resolve from selected allocations instead of conflicting imported fixed defaults.',
  'Steam updates preserve operator settings, worlds, saves and private prefix state. Public anonymous Steam transport is supported; private account/Guard/password-protected beta transport fails closed until compatible secure authentication is implemented.',
  game==='humanitz'?'Uses the original linuxbranch. Detects modern HumanitZServer or legacy TSSGame layout and applies every original Host Settings and World Settings mapping. Unknown settings and INI comments remain. Current publisher acceptance of each legacy setting still needs native proof.':game==='abiotic'?'Downloads Windows app2857200 and checksum-pinned private GE-Proton. All original performance flags, player count, name, password and query controls remain. Preserves the original Win64 working directory for publisher steam_appid.txt discovery and forwards fresh native file-log bytes through bounded, no-symlink, redacted supervision. Windows-through-Proton startup and challenged query were observed; normal Stop returned raw254, so clean shutdown, save-on-Stop, world persistence and client/password enforcement remain unverified.':'Uses the Linux dedicated server by default. The optional Windows payload requires a matching publisher depot and is not verified. Start with 10 GiB of RAM and adjust for player load. Keep the same save-directory name to retain existing data. Automatic updates are off by default; use Reinstall for game updates.',
  'Stop forwards Ctrl-C and retains the real native status. No interactive server-console or saving claim is made before native acceptance. Back up worlds before publisher version changes.',
 ]};
}
fs.writeFileSync(base+'unreal-survival-release.json',JSON.stringify(metadata,null,2)+'\n');
const sources=['steam-template.py','bundle-debian-python.py','native-config.py','native-console.py','enshrouded-proton.py','unreal-survival-install.py','unreal-survival-runtime.py','unreal-survival-release.json'];
for(const [game,path] of Object.entries(games)){
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6 libvulkan1\nmkdir -p .voltra\n';
 for(const source of sources)script+=`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_UNREAL_SOURCE'\n${fs.readFileSync(base+source,'utf8')}\nVOLTRA_UNREAL_SOURCE\n`;
 script+=`python3 .voltra/bundle_debian_python.py\npython3 .voltra/unreal_survival_install.py ${game}\n`;
 profiles[path].egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
}
const output='.local/unreal-survival';fs.mkdirSync(output+'/sources',{recursive:true});
const hashes={};for(const source of sources){const bytes=fs.readFileSync(base+source);fs.writeFileSync(output+'/sources/'+source,bytes);hashes[source]=crypto.createHash('sha256').update(bytes).digest('hex');}
fs.writeFileSync(output+'/profiles.json',JSON.stringify(profiles,null,2)+'\n');
fs.writeFileSync(output+'/source-manifest.json',JSON.stringify(hashes,null,2)+'\n');
console.log('Staged three Unreal profiles and reconstructable source archive; canonical overrides unchanged.');
