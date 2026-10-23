import fs from 'node:fs';import path from 'node:path';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
const output=process.argv[2]||'.local/cube-games/profiles.json';
for(const [recipe,kind,disk]of [['cubeengine/assaultcube/egg-assault-cube.json','assaultcube',2048],['cubeengine/cube2/egg-cube2--sauerbraten.json','sauerbraten',8192]]){
 const entry=catalog.entries.find(e=>e.path===recipe),egg=structuredClone(entry.egg);
 egg.description+=' Checked publisher native release, two allocated consecutive UDP ports, private LAN by default and challenge-verified info readiness. Uses native interrupt Stop and retains operator files.';
 egg.docker_images={'Debian Steam runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/cube_runtime.py ${kind}`;
 egg.config={files:'{}',startup:JSON.stringify({done:'VOLTRA_CUBE_NATIVE_READY'}),logs:'{}',stop:'^SIGINT'};
 for(const v of egg.variables){
  if(v.env_variable==='ASSAULT_SERVER_DESCRIPTION'||v.env_variable==='CUBE_SERVERDESCRIPTION')v.default_value=kind==='assaultcube'?'AssaultCube server':'Sauerbraten server';
  if(v.env_variable.endsWith('MAXPLAYERS'))v.rules='required|integer|between:1,16';
  if(v.env_variable.endsWith('ADMINPASSWORD')){v.rules='nullable|string|min:5|max:512';v.description+=' Empty generates a private persistent password in .voltra/'+kind+'/admin-password. Native client administrator commands remain available.';}
 }
 const variable=(name,key,description,value,rules)=>({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
 egg.variables.push(variable('Public listing','PUBLIC_SERVER','Private LAN by default. Enable native master registration using the original Master Server setting.','0','required|boolean'));
 if(kind==='assaultcube'){
  const key=egg.variables.find(v=>v.env_variable==='ASSAULT_SERVER_KEY');key.rules='nullable|required_if:environment.PUBLIC_SERVER,1|string|size:64|regex:/^[0-9a-fA-F]{64}$/';key.description+=' Required for public registration only; private LAN needs no key. No example key is used.';
  egg.variables.find(v=>v.env_variable==='VERSION').description+=' latest resolves publisher metadata. v1.3.0.2 has a reviewed pinned archive hash. Other releases need a GitHub asset digest or the explicit SHA-256 field. Unknown tags fail instead of silently installing another version.';
  egg.variables.push(variable('Release SHA-256','RELEASE_SHA256','Required only when choosing another publisher release whose GitHub asset has no SHA-256 metadata. The reviewed v1.3.0.2 archive is already pinned.','','nullable|string|size:64|regex:/^[0-9a-f]{64}$/'));
 }else{
  egg.variables.push(variable('Server password','SERVER_PASSWORD','Optional native join password. Empty permits passwordless joins.','','nullable|string|max:512'));
  egg.variables.push(variable('Message of the day','SERVER_MOTD','Native message shown when a client joins. Quotes, dollar signs and carets use native CubeScript escaping.','','nullable|string|max:512'));
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends ca-certificates python3\nmkdir -p .voltra\n';
 for(const [source,target]of [['native-release.py','native_release.py'],['steam-template.py','steam_template.py'],['bundle-debian-python.py','bundle_debian_python.py'],['cube-runtime.py','cube_runtime.py'],['cube-query.py','cube_query.py'],['cube-install.py','cube_install.py']])script+=`cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SOURCE\n`;
 script+=`python3 .voltra/bundle_debian_python.py\npython3 .voltra/cube_install.py ${kind}\n`;
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 profiles[recipe]={upstream_sha256:entry.sha256,revision:kind+'-native-v1',platforms:['linux/amd64'],required_ports:2,consecutive_ports:true,defaults:{memory:512,disk},egg,verification:current[recipe]?.verification||'not_verified',detail:current[recipe]?.detail||'Reviewed native setup implemented; runtime acceptance pending.',setup_steps:[
  'Choose two consecutive UDP ports on one address. The primary is gameplay; primary+1 is native server info. Both must be allocated. Start from Console and connect a matching client to the gameplay port.',
  `The native game and writable operator files are under ${kind}. Back up the whole volume, including .voltra/${kind}/admin-password when generated. Reinstall preserves operator configuration, maps and changed stock assets.`,
  kind==='assaultcube'?'Additional native switches can be added one per line to config/voltra-options.txt. Form values are applied afterward. Native config/maprot.cfg, bans, password lists, server parameters, custom packages and demos retain their normal paths. The packaged example servercmdline.txt contains a placeholder key and is retained only as documentation.':'Edit the native server-init.cfg in the game root for other tuning, map voting, co-op editing, authentication and demos. A private userdata/server-init.cfg includes those settings and applies form values afterward. This native server starts with no map until clients select or start a game.',
  'Native dedicated builds do not accept interactive server commands on stdin. Console shows logs; use Files and native client administrator controls. Stop sends the native Ctrl-C interrupt.',
  kind==='assaultcube'?'Private LAN needs no identity key. Public registration requires your real 64-hex-character server key. VERSION retains release selection; non-reviewed releases without a publisher digest require an explicit archive SHA-256.':'The unmodified publisher server has no graceful interrupt handler. Stop uses its original SIGINT behavior. The supervisor records raw SIGINT return status and normalizes only a requested interrupt after native readiness; crashes remain failures. No survival-world save or graceful engine cleanup is claimed.',
 ]};
}
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(profiles,null,2)+'\n');console.log('Staged Cube profiles '+output);
