import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const prior=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profiles={};
const image='ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b';
const recipes=[['among_us/bettercrewlink_server/egg-better-crewlink-server.json','crewlink'],['among_us/impostor_server/egg-among-us--impostor-server.json','impostor']];
for(const [path,game] of recipes){
 const entry=catalog.entries.find(e=>e.path===path),egg=structuredClone(entry.egg);
 egg.docker_images={'Debian12 with private supported runtime':image};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/among-us-runtime.py ${game}`;
 egg.config={files:'{}',startup:JSON.stringify({done:game==='crewlink'?'BetterCrewLink Server started':'Matchmaker is listening on'}),logs:'{}',stop:'^SIGINT'};
 const add=(name,key,description,value,rules)=>egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
 if(game==='impostor'){
  egg.variables.find(v=>v.env_variable==='VERSION').default_value='v1.10.9';
  add('Advertised address','PUBLIC_IP','LAN/public IPv4 address or DNS name clients can reach. The listener binds all container interfaces.','127.0.0.1','required|string|max:250|regex:/^[A-Za-z0-9._:-]+$/');
  add('Advertised external port','PUBLIC_PORT','Optional router external port. Empty uses the assigned allocation.','','nullable|integer|between:1,65535');
  add('Older release checksum','RELEASE_SHA256','Only required when an older selected GitHub release has no publisher digest. Supply its trusted SHA256. Invalid/missing versions fail without silently installing another version.','','nullable|string|regex:/^[a-fA-F0-9]{64}$/');
  add('Native .NET runtime','DOTNET_CHANNEL','8 is the supported reviewed release. Original historical runtime choices6/7 are retained for old server versions, but are end-of-life and not recommended. Change then reinstall to install its checksum-verified publisher runtime.','8','required|in:6,7,8');
 }else{
  add('Source update policy','SOURCE_POLICY','pinned keeps reviewed master snapshot. follow_branch resolves the current selected branch head on reinstall, preserving the original clone-at-branch-head behavior. Other explicit branches/tags always resolve to their current publisher commit.','pinned','required|in:pinned,follow_branch');
  for(const v of egg.variables){
   if(v.env_variable==='PORT'){v.default_value='';v.rules='nullable|integer|between:1,65535';v.description='Empty uses your assigned allocation. A custom port must also be allocated to this server.';}
   if(v.env_variable==='NAME')v.default_value='My BetterCrewLink';
   if(v.env_variable==='BRANCH'){v.rules='required|string|max:100|regex:~^[A-Za-z0-9_./-]+$~';v.description='master uses reviewed immutable commit0e1d4b12. Another branch/tag/commit resolves through the original publisher GitHub repository; its exact commit and source hash are recorded.';}
   if(v.env_variable==='HTTPS')v.description='Native upstream behavior: any nonempty value enables HTTPS, including "false". Leave empty to use HTTP. Upload privkey.pem and fullchain.pem under crewlink or set SSLPATH.';
   if(v.env_variable==='SSLPATH')v.description='Certificate directory relative to server root, or absolute inside /home/container. Defaults to crewlink. Paths outside the owned volume are rejected.';
  }
 }
 egg.variables.push({name:'Native installer owns updates',env_variable:'AUTO_UPDATE',description:'Avoid the base Steam image legacy updater.',default_value:'0',rules:'required|in:0',user_viewable:false,user_editable:false,field_type:'text'});
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates libicu72 libssl3 libstdc++6 zlib1g\nmkdir -p .voltra\n';
 for(const name of ['among-us-install.py','among-us-runtime.py','native-release.py','native-config.py','bundle-debian-python.py'])script+=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')}\nVOLTRA_SOURCE\n`;
 script+=`python3 .voltra/bundle-debian-python.py\npython3 .voltra/among-us-install.py ${game}\n`;
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 const revision=game+'-native-v1';
 profiles[path]={upstream_sha256:entry.sha256,revision,platforms:['linux/amd64'],defaults:{memory:512,disk:4096},egg,verification:prior[path]?.revision===revision?prior[path].verification:'not_verified',detail:prior[path]?.revision===revision?prior[path].detail:'Implemented; native acceptance pending.',setup_steps:game==='impostor'?[
  'Reviewed publisher release1.10.9 supports Among Us2024.6.18 through19.0. A newer client is not automatically supported. The installer bundles pinned ASP.NET8.0.32 and retains its notices; release assets are verified using SHA256.',
  'Set Advertised address to the node address clients can reach. The assigned port serves both native UDP gameplay and TCP HTTP authentication. Keep HttpServer enabled for modern clients. Among Us16.0.5 and newer require HTTPS: configure your own TLS reverse proxy to the allocated TCP port and use its domain in the client region file. Native UDP gameplay must remain directly reachable; do not send UDP through an HTTP proxy. Publisher instructions: https://github.com/Impostor/Impostor/blob/v1.10.9/docs/Http-server.md . This is not a Steam game.',
  'Native config.json, plugins, plugin-config and logs are under impostor. Only advertised/listen addresses and ports are managed. Anticheat, compatibility, logging and plugin settings remain editable in Files. Original root config/plugin files are copied once and retained when importing an old installation.',
  'Reinstall retains modified operator files and same-release engine contents. Back up plugins/configuration. SIGINT requests native .NET shutdown; no gameplay or player connection is implied by HTTP/socket readiness.',
 ]:[
  'This is the separate BetterCrewLink voice-signaling service, not an Among Us game server. All players need compatible BetterCrewLink clients and must select this server URL. Reviewed master snapshot uses pinned Node24 and frozen Yarn dependency resolutions.',
  'The assigned TCP allocation is used when Port is empty. Set Server name and Domain for your users. Any nonempty HTTPS value enables TLS under original upstream semantics. Upload your own private certificate files; no certificates or credentials are supplied.',
  'Native crewlink/config/peerConfig.yml controls STUN/TURN and forceRelayOnly. The default uses peer-to-peer signaling with external STUN; integrated TURN is disabled. If enabling integrated TURN, allocate/forward its listener and complete relay range and configure advertised addresses; a single web allocation cannot relay voice by itself. External TURN remains supported in the native YAML.',
  'All original branch/name/domain/TLS/port controls remain. Custom branches resolve to an immutable source commit and record its hash. Original root .env, peerConfig.yml and certificates are copied once without deleting them. Files live under crewlink; protect .env, certificates, peer settings and custom assets.',
  'The GPL server source and license remain installed. A marked source modification closes native Socket.IO/HTTP and optional TURN listeners on SIGINT, allowing Node to exit naturally. Native voice exchange and client gameplay require separate client testing.',
 ]};
}
fs.mkdirSync('.local/among-us-games',{recursive:true});fs.writeFileSync('.local/among-us-games/profiles.json',JSON.stringify(profiles,null,2)+'\n');
console.log('Staged two Among Us profiles; native acceptance remains separate.');
