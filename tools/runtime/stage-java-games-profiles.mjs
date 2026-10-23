import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const profiles={};
const reviewed=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const settings=[
 ['necesse','necesse/egg-necesse.json',1,2048,8192,'Type help for list of commands.','stop'],
 ['starmade','starmade/egg-starmade.json',1,4096,8192,'SenableGameState(1)','/shutdown 0'],
 ['rising-world-java','rising_world/legacy/egg-rising-world-legacy.json',7,3072,8192,'Steam Query Server bind to ANY (','shutdown'],
];
for(const [kind,path,ports,memory,disk,ready,stop]of settings){
 const entry=catalog.entries.find(x=>x.path===path);if(!entry)throw Error('Missing catalog recipe '+path);
 const egg=structuredClone(entry.egg);
 egg.features=[...new Set([...(egg.features||[]),...(kind==='starmade'?[]:['voltra_steam_template'])])];
 egg.docker_images={'Pinned Debian native runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 egg.startup='exec env VOLTRA_GAME_LD_LIBRARY_PATH="$LD_LIBRARY_PATH" PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/java_games_runtime.py '+kind;
 egg.config={files:'{}',startup:JSON.stringify({done:ready}),logs:'{}',stop};
 const changes=kind==='necesse'?{
  SAVE_NAME:{rules:'required|string|max:20|not_regex:/[\\x00-\\x1f\\x7f\\\\\\/]/',description:'Persistent world name under saves/. Keep unchanged to resume it. Spaces are supported; paths are rejected.'},
  SERVER_SLOTS:{rules:'required|integer|min:1|max:250'},SRCDS_APPID:{rules:'required|string|in:1169370'},
  SERVER_PASSWORD:{rules:'nullable|string|max:32|not_regex:/[\\x00-\\x1f\\x7f]/'},
 }:kind==='starmade'?{SERVER_JARFILE:{rules:'required|string|max:64|not_regex:/[\\x00-\\x1f\\x7f]/',description:'Server jar within this volume. The reviewed publisher release installs StarMade.jar.'}}:{
  SERVER_NAME:{rules:'required|string|max:32|not_regex:/[\\x00-\\x1f\\x7f]/'},MAX_PLAYERS:{rules:'required|integer|min:1|max:64'},
  RCON_PORT:{description:'A separate allocated port outside gameplay-1..gameplay+4 is selected automatically; this preferred value is used when allocated.',rules:'required|integer|min:1|max:65535'},
  RCON_PASSWORD:{rules:'required|string|min:6|max:20|not_regex:/[\\x00-\\x1f\\x7f]/'},SERVER_PASSWORD:{rules:'nullable|string|max:20|not_regex:/[\\x00-\\x1f\\x7f]/'},SRCDS_APPID:{rules:'required|string|in:339010'},
  SRCDS_BETAID:{default_value:'java',description:'Current publisher branch for the Java legacy edition. The older legacy value remains an alias for java; Unity has a separate recipe.'},
 };
 for(const variable of egg.variables)Object.assign(variable,changes[variable.env_variable]);
 if(kind==='necesse')egg.variables.push({name:'Pause empty worlds',description:'Pause simulation when no players are connected.',env_variable:'PAUSE_EMPTY',default_value:'1',user_viewable:true,user_editable:true,rules:'required|boolean',field_type:'text'});
 if(kind==='rising-world-java')egg.variables.push({name:'Steam automatic update',description:'Use the typed helper to update this legacy server on startup.',env_variable:'AUTO_UPDATE',default_value:'0',user_viewable:true,user_editable:true,rules:'required|boolean',field_type:'text'});
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 for(const [source,target]of [['steam-template.py','steam_template.py'],['bundle-debian-python.py','bundle_debian_python.py'],['native-config.py','native_config.py'],['native-console.py','native_console.py'],['java-games-runtime.py','java_games_runtime.py'],['java-games-install.py','java_games_install.py']])script+=`cat > .voltra/${target} <<'VOLTRA_JAVA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_JAVA_SOURCE\n`;
 script+='python3 .voltra/bundle_debian_python.py\nPYTHONPATH=.voltra python3 .voltra/java_games_install.py '+kind+'\n';
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 profiles[path]={upstream_sha256:entry.sha256,revision:kind+'-native-v1',platforms:['linux/amd64'],required_ports:ports,...(kind==='rising-world-java'?{consecutive_ports:true,consecutive_ports_count:6,consecutive_primary_offset:1}:{}),defaults:{memory,disk},egg,verification:reviewed[path]?.verification||'not_verified',detail:reviewed[path]?.detail||'Reviewed typed Java setup staged; native acceptance pending.',setup_steps:kind==='necesse'?[
  'Select a Linux x64 node and one gameplay port. The publisher bundled Java runtime is retained.',
  'World name, player slots and password are passed as literal native arguments. No shell expands them.',
  'World saves and mod data stay under saves/, cfg/ and mods/. Keep the world name unchanged; back up these directories before updates.',
  'Use native console commands and Stop for an orderly save. Reinstall preserves an existing cfg/server.cfg.',
 ]:kind==='starmade'?[
  'Select a Linux x64 node with one gameplay port. The publisher 0.305.11 archive and Eclipse Temurin 21 runtime are pinned by SHA-256. This release requires Java 21; older Java 8/16 recipes cannot launch it.',
  'The original server jar option remains available. The normal jar is StarMade.jar.',
  'Edit server.cfg, admins.txt and native world settings through Files. Keep server-database/ and operator blueprints backed up.',
  'Use KEY = value or // comment lines in server.cfg. The publisher parser stops on empty lines before applying settings; keep this native file free of blank lines.',
  'Reinstall replaces publisher program files while retaining existing operator configuration, worlds and mods. Stop uses native /shutdown 0.',
 ]:[
  'Select Linux x64 and seven ports: gameplay-1 through gameplay+4 must be consecutive; RCON uses a separate allocated port.',
  'The publisher renamed its legacy branch to java. The original legacy value still works as an alias, and all original settings remain available. This is the Java legacy edition, not the separate Unity recipe.',
  'Name, slots and actual allocated ports use literal native arguments. Managed passwords in server.properties receive private backups; unknown settings and comments remain editable.',
  'Keep Worlds/, plugins/, permissions and server.properties backed up. Reinstall preserves existing server.properties. Native Stop sends shutdown.',
 ]};
}
fs.mkdirSync('.local/java-games',{recursive:true});fs.writeFileSync('.local/java-games/profiles.json',JSON.stringify(profiles,null,2)+'\n');
console.log('Staged Java family profiles: '+Object.keys(profiles).join(', '));
