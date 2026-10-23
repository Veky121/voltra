import fs from 'node:fs';
const base='internal/panel/game_library/scripts/',catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),previous=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
for(const [path,game] of [['trackmania/egg-trackmania.json','trackmania'],['truck-simulator/american-truck-simulator/egg-american-truck-simulator-dedicated-server.json','ats'],['truck-simulator/euro-truck-simulator2/egg-euro-truck-simulator2-dedicated-server.json','ets2']]){
 const entry=catalog.entries.find(x=>x.path===path),egg=structuredClone(entry.egg),truck=game!=='trackmania',revision=game+'-native-v1';
 egg.docker_images={'Pinned native Debian runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 if(truck)egg.features=[...new Set([...(egg.features??[]),'voltra_steam_template'])];
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/truck-trackmania-native.py run ${game}`;
 egg.config={...egg.config,files:'{}',stop:'^SIGTERM'};
 for(const v of egg.variables){
  if(['MASTERSERVER_LOGIN','MASTERSERVER_PASSWORD'].includes(v.env_variable))v.rules='nullable|'+v.rules;
  if(v.env_variable==='QUERY_PORT'){v.default_value='';v.rules='nullable|integer|between:1,65535';v.user_editable=true;v.description='Distinct allocated Steam query port. Blank selects an additional allocation. SCS documents27015..27020 for LAN browser discovery; direct session search is separate.';}
  if(!['AUTO_UPDATE','SRCDS_APPID','QUERY_PORT'].includes(v.env_variable))v.rules=v.rules.replace(/\|$/,'')+'|not_regex:/[\\x00-\\x1f\\x7f]/';
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 for(const source of ['truck-trackmania-native.py','native-config.py','native-release.py','native-console.py','steam-template.py','source-install.py','bundle-debian-python.py'])script+=`cat > .voltra/${source==='steam-template.py'?'steam_template.py':source} <<'VOLTRA_NATIVE_SOURCE'\n${fs.readFileSync(base+source,'utf8')}\nVOLTRA_NATIVE_SOURCE\n`;
 script+=`python3 .voltra/bundle-debian-python.py\npython3 .voltra/truck-trackmania-native.py install ${game}\n`;
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
 profiles[path]={upstream_sha256:entry.sha256,revision,platforms:['linux/amd64'],required_ports:truck?2:1,port_rules:truck?[{environment:'QUERY_PORT',condition:'nonzero',allocated_value:true,exclude_primary:true,minimum:1,maximum:65535,count:2}]:[],defaults:{memory:1024,disk:4096},verification:previous[path]?.revision===revision?previous[path].verification:'not_verified',detail:previous[path]?.revision===revision?previous[path].detail:'Publisher native adapter implemented; real prerequisite/native acceptance pending.',egg,setup_steps:truck?[
 'Installs the official SCS Linux dedicated server anonymously through SteamCMD. Game ownership is not required for this download; private Steam-account credentials are unnecessary.',
 'First launch generates the native server_config.sii in .local/share/'+(game==='ats'?'American Truck Simulator':'Euro Truck Simulator 2')+'. Upload your own matching server_packages.sii and server_packages.dat exported by export_server_packages from the running game with the desired map/DLC/mod selection. No third-party player exports or client assets are supplied.',
 'Original lobby name, optional Steam logon token, query port and automatic-update controls remain. Empty token uses the publisher anonymous session ID; a persistent token requires ownership and the game AppID, not the dedicated-server AppID.',
 'Select distinct allocated connection and query ports. Both TCP and UDP must be reachable for public use; SCS documents query27015..27020 for LAN browser discovery. Virtual ports stay in the publisher config and need no forwarding.',
 'All other SII session/moderator/game options remain editable in Files. Configuration, package exports and modified operator files survive reinstall including Steam failures. Stop forwards native Ctrl-C and records its real exit status. No ready session, driving or client compatibility is implied by installing the server.',
 ]:[
 'Downloads the official Ubisoft Trackmania2020 dedicated-server2026-05-15 ZIP over HTTPS, verifies SHA256 and retains publisher assets/scripts. It is proprietary publisher software; no open-source license or client-game substitution is claimed.',
 'Empty master login/password select native LAN mode, proven with the official bundled Training map. Internet hosting requires a real dedicated-server login/password created at https://www.trackmania.com/player/dedicated-servers, separate from your Ubisoft account password. No fake account is created. Dedicated server joins are PC-only per Ubisoft documentation.',
 'All original master login/password, match settings path, name, comment and join password controls remain. XML text is escaped; comments, unknown settings, authorization levels and XML-RPC options are retained.',
 'Game Config is relative to the publisher UserData/Maps directory, such as MatchSettings/example.txt. Upload legitimate maps and edit playlists/scripts in Files. XML-RPC remains native and loopback-only by publisher default; change authorization passwords before enabling remote controllers. No new public administration endpoint is created.',
 'Reinstall preserves UserData, MatchSettings and modified operator files. Stop forwards the original native Ctrl-C. Native LAN map loading and authenticated loopback XML-RPC are distinct from internet-account authentication, client joins and gameplay; those require their own proof.',
 ]};
}
fs.mkdirSync('.local/truck-trackmania',{recursive:true});fs.writeFileSync('.local/truck-trackmania/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged ATS, ETS2 and Trackmania.');
