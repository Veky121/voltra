import fs from 'node:fs';
const dir='.local/source-third',base='internal/panel/game_library/scripts/';fs.mkdirSync(dir,{recursive:true});
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
const helpers=['steam-template.py','source-install.py','bundle-debian-python.py','native-console.py','source-runtime.py','source-next-install.py','source-l4d.py','source-third-install.py','source-third-runtime.py'];
for(const [recipe,kind,app,memory,disk]of [['counter_strike/counter_strike_2/egg-counter--strike2.json','cs2',730,4096,65536],['svencoop/egg-sven-co-op.json','sven',276060,2048,16384],['team_fortress_2_classic/egg-team-fortress-2-classic.json','tf2classic',244310,4096,32768]]){
 const entry=catalog.entries.find(e=>e.path===recipe);if(!entry)throw Error('Missing exact imported recipe');const egg=structuredClone(entry.egg);
 egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
 egg.docker_images={'Debian Steam runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/source_third_runtime.py';
 egg.config={files:'{}',startup:JSON.stringify({done:'VOLTRA_SOURCE_THIRD_MAP_READY'}),logs:'{}',stop:'quit'};
 const add=(key,name,value,rules,description,hidden=false)=>{const previous=egg.variables.find(v=>v.env_variable===key);const fields={name,default_value:value,rules,description,user_viewable:!hidden,user_editable:!hidden,field_type:'text'};if(previous)Object.assign(previous,fields);else egg.variables.push({env_variable:key,...fields});};
 const safe='nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f"\\\\;]/';
 add('VOLTRA_SOURCE_THIRD','Native profile',kind,`required|string|in:${kind}`,'Fixed imported recipe identity.',true);
 add('AUTO_UPDATE','Automatic updates',egg.variables.find(v=>v.env_variable==='AUTO_UPDATE')?.default_value||'0','required|boolean','Check public publisher updates on native startup. Existing native configuration is restored through successful and failed updates.');
 add('SRCDS_BETAID','Steam branch',kind==='tf2classic'?'previous2021':'',kind==='tf2classic'?'required|string|in:previous2021':'nullable|string|max:64|regex:/^[A-Za-z0-9_.-]+$/','Legacy TF2C retains its original previous2021 SDK branch. Empty selects publisher public for other profiles.');
 add('SRCDS_BETAPASS','Protected beta password','','nullable|string|max:128','Retained control. Protected Steam credentials are currently rejected before download; no credentials are logged.');
 if(kind!=='sven')add('SERVER_NAME','Server name',egg.variables.find(v=>v.env_variable==='SERVER_NAME')?.default_value||entry.egg.name+' server',safe.replace('nullable','required'),'Literal native browser name.');
 if(kind==='tf2classic'){add('SERVER_PASSWORD','Join password','',safe,'Empty permits joining without a password.');add('RCON_PASSWORD','RCON password','',safe,'Optional native administration password.');add('TF2C_SHA256','Expected legacy archive SHA256','','nullable|string|regex:/^[a-f0-9]{64}$/','Optional independently supplied expected archive checksum. Computed provenance is recorded even without an expected checksum.');}
 if(kind==='sven')add('RCON_PASSWORD','RCON password','',safe,'Optional native administration password.');
 if(kind==='cs2')add('TV_PORT','SourceTV port','0','required|integer|between:0,65535','Zero selects the distinct additional allocation automatically. Explicit values must match that allocation.');
 for(const v of egg.variables){
  if(['SC_MAP','SRCDS_MAP'].includes(v.env_variable))v.rules='required|string|max:128|regex:/^[A-Za-z0-9_\\/-]+$/';
  if(['SC_NAME','SC_PASSWORD','SERVER_NAME','SERVER_PASSWORD','RCON_PASSWORD'].includes(v.env_variable))v.rules=(['SC_NAME','SERVER_NAME'].includes(v.env_variable)?'required':'nullable')+safe.slice('nullable'.length);
  if(v.env_variable==='GAMEVERSION')v.rules='required|string|max:20|regex:/^(latest|[0-9]+(\\.[0-9]+){1,3})$/';
  if(v.env_variable==='MAXPLAYERS')v.rules='required|integer|between:1,32';
  if(['GAME_MODE','GAME_TYPE'].includes(v.env_variable))v.rules='required|integer|between:0,10';
  if(v.env_variable==='SRCDS_APPID')v.rules=`required|string|in:${app}`;
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6 zstd\nmkdir -p .voltra\n';
 for(const name of helpers)script+=`cat > .voltra/${name.replaceAll('-','_')} <<'VOLTRA_SOURCE'\n${fs.readFileSync(base+name,'utf8')}\nVOLTRA_SOURCE\n`;
 script+='python3 .voltra/bundle_debian_python.py\nPYTHONPATH=.voltra python3 - <<\'VOLTRA_INSTALL\'\nfrom pathlib import Path\nimport os\nfrom source_third_install import install\ninstall(Path.cwd(),dict(os.environ))\nVOLTRA_INSTALL\n';
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 profiles[recipe]={upstream_sha256:entry.sha256,revision:'source-third-v1',platforms:['linux/amd64'],required_ports:kind==='cs2'?2:1,defaults:{memory,disk},egg,verification:current[recipe]?.verification||'not_verified',detail:current[recipe]?.detail||'Typed imported recipe implemented; native acceptance pending.',setup_steps:[
  kind==='cs2'?'Allocate a primary game/query/RCON port and a distinct SourceTV port. The publisher app730 includes the dedicated server; allow at least64GiB disk.':'Allocate one primary game/query/RCON port on a Linux x64 node.',
  kind==='tf2classic'?'This is the original TF2 Classic legacy mod and its previous2021 SDK, not the newer Classified Steam game. The official legacy versions endpoint returned404 during review; installation reports that publisher failure and does not substitute another game or download untrusted mirrors. Explicit original legacy versions remain selectable.':'SteamCMD acquires the original dedicated application anonymously. Account and protected beta credentials remain explicitly gated until the shared parser supports them safely.',
  kind==='cs2'?'Retains VAC, RCON, game type, game mode, SourceTV, GSLT, map, slots, server name and passwords. Public hosting requires a real publisher token and reachable ports; no token is fabricated.':kind==='sven'?'Retains the original map,2–32slots,40-character browser name, join password and documented Steam region. Keep AngelScript plugins and admins.txt under svencoop.':'Retains GAMEVERSION, map, MAXPLAYERS, fixed game directory and original SDK branch. Archive downloads are bounded and confined; optional expected SHA256 supplements recorded computed provenance.',
  'Operator server.cfg remains intact; a separate private managed wrapper loads it before form settings. Native CFG, RC, INI, VDF, map cycles, MOTDs and gameinfo survive Steam validation, including failures.',
  'Console and Stop use the shared native process terminal. Readiness requires a genuine query matching the map, browser name and password flag. Fixtures do not prove native launch, public listing or player gameplay.'
 ]};
}
fs.writeFileSync(dir+'/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged three disjoint Source profiles.');
