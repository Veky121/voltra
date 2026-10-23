import fs from 'node:fs';
const base='internal/panel/game_library/scripts/';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const overrides=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const pins=JSON.parse(fs.readFileSync(base+'automation-sims-pins.json')),profiles={};
for(const [path,game]of [['eco/egg-eco.json','eco'],['foundry/egg-foundry.json','foundry'],['fortresscraft_evolved/egg-fortresscraft-evolved.json','fortress']]){
 const entry=catalog.entries.find(e=>e.path===path);if(!entry)throw Error('Missing original '+path);
 const egg=structuredClone(entry.egg),pin=pins[game];
 egg.docker_images={'Pinned reviewed platform runtime':pin.runtime};
 egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
 egg.startup=game==='foundry'?'exec /usr/bin/python3 .voltra/automation-sims.py run foundry':`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/automation-sims.py run ${game}`;
 egg.config={...egg.config,files:'{}',stop:'^SIGTERM'};
 for(const v of egg.variables){
  if(['WEB_PORT','RCON_PORT','QUERY_PORT'].includes(v.env_variable)){v.default_value='';v.rules='nullable|integer|between:1,65535';v.description+=' Select a distinct allocation, or leave blank for automatic selection.';v.user_editable=true;}
  if(game==='foundry'&&v.env_variable==='SERVER_NAME')v.default_value='Foundry dedicated server';
  if(game==='foundry'&&v.env_variable==='WINETRICKS_RUN'){v.rules='required|in:mono';v.description+=' Original fixed Mono initialization is owned by this pinned stock Wine image, within the server prefix. Other verbs fail explicitly.';}
  if(game==='eco'&&v.env_variable==='MAX_CON')v.rules='required|integer|between:-1,1000000';
  if(game==='foundry'&&v.env_variable==='MAX_PLAYERS')v.rules='required|integer|between:1,1024';
  if(game==='foundry'&&v.env_variable==='AUTOSAVE_INTERVAL')v.rules='required|integer|between:1,86400';
  if(game==='foundry'&&v.env_variable==='MAP_SEED')v.rules='required|integer|between:0,18446744073709551615';
  if(v.env_variable==='SLG_PW')v.description+=' Required publisher account/license password, transported as one native argv value and redacted from supervised output; this is separate from unsupported Steam login credentials.';
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 for(const source of ['automation-sims.py','steam-native-next.py','native-config.py','native-release.py','native-console.py','steam-template.py','source-install.py',...(game==='foundry'?[]:['bundle-debian-python.py'])])script+=`cat > .voltra/${source==='steam-template.py'?'steam_template.py':source} <<'VOLTRA_AUTOMATION_SOURCE'\n${fs.readFileSync(base+source,'utf8').replace(/\r\n/g,'\n')}\nVOLTRA_AUTOMATION_SOURCE\n`;
 if(game!=='foundry')script+='python3 .voltra/bundle-debian-python.py\n';
 script+=`python3 .voltra/automation-sims.py install ${game}\n`;
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
 const roles=game==='eco'?['WEB_PORT','RCON_PORT']:game==='foundry'?['QUERY_PORT']:['RCON_PORT'];
 profiles[path]={upstream_sha256:entry.sha256,revision:game+'-typed-automation-v1',platforms:['linux/amd64'],required_ports:roles.length+1,port_rules:roles.map(environment=>({environment,condition:'nonzero',allocated_value:true,auto_allocate:true,exclude_primary:true,minimum:1,maximum:65535,count:roles.length+1})),defaults:{memory:4096,disk:game==='foundry'?20480:16384},verification:overrides[path]?.verification||'not_verified',detail:overrides[path]?.detail||'Typed original configuration and supervised launch implemented; source fixtures only, native acceptance pending.',egg,setup_steps:[
  'All original variables and publisher controls remain. Uses shared React setup, typed allocated ports and Steam installation. Proprietary game assets are downloaded directly by Steam; none are redistributed here.',
  'Private Steam username/password/auth and private beta passwords remain explicitly unsupported by the shared command parser and fail before downloading. Original credential/branch fields are retained rather than silently ignored.',
  game==='eco'?'Eco uses anonymous Steam739590 for acquisition and a separate required SLG account/license at startup. Original name/password/public/UPnP/description/playtime/limits/Discord/category/language/web URL and RCON controls map to typed JSON, retaining legacy Description/MaxConnections when present. Unknown publisher settings and operator files remain. Stop submits original exit command.':game==='foundry'?'Foundry retains the original Windows2915550 plus Steam SDK1007, stock Wine/Xvfb/Mono initialization and console. All11 App.cfg controls remain, including world name, pause-empty, autosave, public/query ports, save path and full unsigned map seed. Official mapseed spelling is applied; original map_seed is synchronized if present. Unix save paths are confined to this volume and mapped to Wine Z: paths. Stop forwards original Ctrl-C; native Windows console/exit behavior requires acceptance.':'FortressCraft retains app443600 linux_server_headless branch, all world/difficulty/flat/rush/care-package controls, RCON/player/world/public/auto-pause settings and original Unity logfile/console filtering. Publisher examples initialize missing INI files only; existing operator settings/comments are retained. Original Ctrl-C is forwarded; native persistence remains untested.',
  'AUTO_UPDATE uses the typed Steam helper with operator-file preservation. Configs, worlds, saves, mods and private Wine state are retained. Public installation, actual native readiness, console/stop, protocol queries and save/reinstall are separate acceptance steps; no gameplay is claimed by source fixtures.',
 ]};
}
fs.mkdirSync('.local/automation-sims',{recursive:true});fs.writeFileSync('.local/automation-sims/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged Eco, Foundry and FortressCraft with original typed controls.');
