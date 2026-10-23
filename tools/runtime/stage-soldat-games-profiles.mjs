import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),previous=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
const image='ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b';
for(const [path,game] of [['soldat/egg-soldat.json','soldat'],['soldat_2/egg-soldat2.json','soldat2']]){
 const entry=catalog.entries.find(e=>e.path===path),egg=structuredClone(entry.egg);
 egg.docker_images={'Debian12 native server':image};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/soldat-native.py run ${game}`;
 egg.config={files:'{}',startup:JSON.stringify({done:game==='soldat'?'Done':'ALL RULES SCRIPTS INITIALIZED'}),logs:'{}',stop:game==='soldat'?'^SIGTERM':'^SIGTERM'};
 const add=(name,key,description,value,rules)=>egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
 for(const variable of egg.variables){
  if(['SRV_PWD','SERVER_PASSWORD'].includes(variable.env_variable)){variable.default_value='';variable.rules=variable.rules.replace(/^required\|/,'nullable|');}
  if(['ADMIN_PASSWD','RCON_PASSWORD'].includes(variable.env_variable)){variable.default_value='';variable.rules=variable.rules.replace(/^required\|/,'nullable|');variable.description+=' Empty generates a persistent private administrator password when enabled, stored under .voltra/'+game+'/admin-password.';}
  if(variable.env_variable==='ADMIN_PLAYFAB_ID')variable.default_value='';
  if(variable.env_variable==='SERVER_NAME')variable.description='Native server name, including spaces; passed without shell expansion.';
  if(variable.env_variable==='MAX_PLAYERS'&&game==='soldat')variable.rules='required|integer|between:1,20';
  if(!/^(MAX_PLAYERS|SRCDS_APPID|WEBSOCKETS_PORT|RCON_PORT)$/.test(variable.env_variable))variable.rules+='|not_regex:/[\\x00-\\x1f\\x7f]/';
 }
 add('Public server listing','PUBLIC_SERVER','0 keeps this acceptance-friendly private/LAN server out of the public list.','0','required|in:0,1');
 if(game==='soldat2')add('Publisher archive SHA-256','RELEASE_SHA256','Pinned official publisher archive from soldat2.com/downloads. If the mutable publisher URL changes, review and supply its trusted SHA-256.','','nullable|string|size:64|regex:/^[a-f0-9]+$/');
 egg.variables.push({name:'Native installer ownership',env_variable:'AUTO_UPDATE',description:'Reinstall uses the selected native publisher installer.',default_value:'0',rules:'required|in:0',user_viewable:false,user_editable:false,field_type:'text'});
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1'+(game==='soldat2'?' nodejs':'')+'\nmkdir -p .voltra\n';
 for(const name of ['soldat-native.py','native-release.py','native-config.py','steam-template.py','source-install.py','bundle-debian-python.py'])script+=`cat > .voltra/${name==='steam-template.py'?'steam_template.py':name} <<'VOLTRA_SOLDAT_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')}\nVOLTRA_SOLDAT_SOURCE\n`;
 if(game==='soldat2'){
  for(const name of ['soldat2-modifier.mjs','soldat2-lifecycle.cs'])script+=`cat > .voltra/${name} <<'VOLTRA_SOLDAT_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')}\nVOLTRA_SOLDAT_SOURCE\n`;
  script+='mkdir -p .voltra/vendor/jju/lib\n';
  for(const name of ['index.js','package.json','LICENSE','README.md',...fs.readdirSync('internal/panel/game_library/vendor/jju/lib').map(n=>'lib/'+n)])script+=`cat > .voltra/vendor/jju/${name} <<'VOLTRA_JJU_SOURCE'\n${fs.readFileSync('internal/panel/game_library/vendor/jju/'+name,'utf8')}\nVOLTRA_JJU_SOURCE\n`;
 }
 script+=`python3 .voltra/bundle-debian-python.py\npython3 .voltra/soldat-native.py install ${game}\n`;
 if(game==='soldat2')script+='node .voltra/soldat2-modifier.mjs /mnt/server\n';
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 const revision=game+'-native-v1';
 profiles[path]={upstream_sha256:entry.sha256,revision,defaults:{memory:game==='soldat'?512:1024,disk:4096},platforms:['linux/amd64'],egg,required_ports:game==='soldat'?2:1,
  port_rules:game==='soldat'?[{minimum:1,maximum:65535,count:2,offsets:[10]}]:['WEBSOCKETS_PORT','RCON_PORT'].map(environment=>({environment,condition:'nonzero',allocated_value:true,minimum:1,maximum:65535,count:2})),
  verification:previous[path]?.revision===revision?previous[path].verification:'not_verified',detail:previous[path]?.revision===revision?previous[path].detail:'Adapter implemented; native acceptance pending.',
  setup_steps:game==='soldat'?[
   'Installs the original Soldat dedicated server from Steam app638500 anonymously. This is the original catalog game, not a substitute OpenSoldat fork. Native Steam release metadata records the installed build.',
   'Allocate TCP/UDP gameplay/admin port and TCP primary+10 for native map downloads. The shared setup form selects that exact sparse pair; the launcher checks both allocations before starting.',
   'Name, maximum players, join password and admin password remain original Startup controls. Empty join password allows passwordless play. Empty administrator password generates a private persistent value under .voltra/soldat/admin-password. Read it privately in Files for native TCP administration.',
   'Keep soldat.ini, maps, textures, scenery, scripts, bans, remote.txt and custom files. Steam validation preserves native configuration and operator-modified files with bytes and permissions. Private listing is the default. Stop requests the native SIGTERM path, with raw exit status retained.',
  ]:[
   'Installs the official Soldat2 Linux x86_64 Unity dedicated server from the publisher download page, with reviewed archive SHA-256. The native banner reports0.8.71.A; the bundled changelog ends at0.8.70a. This is publisher software, not claimed open source.',
   'All original name, player limit, greet message, PlayFab administrator ID, join password, RCON password and optional WebSocket ports remain available. Spaces and shell punctuation in values are passed as literal arguments. Passwords are configured through native INI rather than visible process arguments.',
   'WebSocket controls default to0. Native RCON uses a separate allocated port and password; blank generates a private persistent value under .voltra/soldat2/admin-password when enabled. The publisher0.8.71.A server accepts WebSocketsPort but does not start a WebSocket gameplay listener. That original control remains available without a transport claim.',
   'Keep autoconfig.ini, Levels, Rules, Modifiers, Cycles, Scripts, greet.txt and operator files. The native engine rewrites its configuration when stopping, so edit only while stopped. Reinstall preserves operator modifications. Native publisher patch settings remain file-editable; review them before allowing self-updates.',
   'Private/LAN listing is the default. An included server-only script composes with native modifier script lists while retaining publisher security checks. Stop writes a private nonce request consumed on the native main thread to request Application.Quit and configuration save. Missing hooks time out with explicit raw failure evidence. Client joins and gameplay require separate evidence.',
  ]};
}
fs.mkdirSync('.local/soldat-games',{recursive:true});fs.writeFileSync('.local/soldat-games/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged Soldat and Soldat2 independently.');
