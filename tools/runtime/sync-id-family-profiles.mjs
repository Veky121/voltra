import fs from 'node:fs';import path from 'node:path';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
const output=process.argv[2]||'.local/id-games/profiles.json';
const variable=(name,key,description,value,rules)=>({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
for(const [recipe,kind]of [['doom/zandronum/egg-zandronum.json','zandronum'],['Nazi Zombies Portable/egg-nazi-zombies--portable.json','nzportable']]){
 const entry=catalog.entries.find(x=>x.path===recipe),egg=structuredClone(entry.egg);
 egg.docker_images={'Ubuntu native runtime':'ghcr.io/ptero-eggs/yolks@sha256:85cc85e658366d2398288b1f829a4bab4de2d02a3bea4193f8d502db7b2dd29b'};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/id_family_runtime.py ${kind}`;
 egg.config={files:'{}',startup:JSON.stringify({done:'VOLTRA_ID_NATIVE_READY'}),logs:'{}',stop:'^SIGTERM'};
 if(kind==='zandronum')for(const v of egg.variables){
  if(v.env_variable==='MAX_PLAYERS'){v.user_editable=true;v.rules='required|integer|between:1,128';}
  if(v.env_variable==='SKILL'){v.default_value='3';v.rules='required|integer|between:0,15';}
  if(['DMFLAGS','DMFLAGS2','ZADMFLAGS','COMPATFLAGS','COMPATFLAGS2','ZACOMPATFLAGS'].includes(v.env_variable)){v.default_value='0';v.rules='required|integer|between:-2147483648,4294967295';}
 }
 egg.variables.push(variable('Server name','SERVER_NAME','Native server browser name.',kind==='zandronum'?'Zandronum server':'Nazi Zombies: Portable server','required|string|max:255'));
 egg.variables.push(variable('Public listing','PUBLIC_SERVER','Private LAN by default; enable native public registration explicitly.','0','required|boolean'));
 if(kind==='zandronum')egg.variables.push(variable('Server password','SERVER_PASSWORD','Optional native server access password.','','nullable|string|max:255'));
 if(kind==='nzportable'){
  egg.variables.push(variable('Engine and compatible clients','NZP_ENGINE','vril: current matched2026 Vril clients. fte_legacy: matched2024 FTE clients and original native/Web protocols. Data/configs are isolated per engine.','vril','required|string|in:vril,fte_legacy'));
  egg.variables.push(variable('Modern Vril player slots','NZP_MAXPLAYERS','Vril only:1..16 native player slots (publisher hard maximum16). Modern mode reserves gameplay+16 consecutive UDP ports for future player-count changes. Legacy FTE retains its native defaults and GAME_ARGS maxclients control.','4','required|integer|between:1,16'));
  egg.variables.find(v=>v.env_variable==='PROTOCOL').description+=' Applied only to legacy FTE. Current Vril uses its native NetQuake transport and matching current clients; it cannot join old FTE/Web clients.';
  egg.variables.find(v=>v.env_variable==='PUBLIC_SERVER').description='Legacy FTE master registration only. Modern Vril uses direct/LAN connections.';
 }
 const packages=kind==='nzportable'?'ca-certificates python3 build-essential make patch git pkg-config libsdl2-dev libsdl2-mixer-dev libgl-dev libglu1-mesa-dev':'ca-certificates python3';
 let script=`#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends ${packages}\nmkdir -p .voltra\n`;
 for(const source of ['native-release','native-zip-release','native-console','steam-template','bundle-debian-python','zandronum-huffman','id-family-install','id-family-runtime','id-family-query',...(kind==='nzportable'?['nzp-engine-build','nzp-install']:[])])script+=`cat > .voltra/${source.replaceAll('-','_')}.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source+'.py','utf8')}\nVOLTRA_SOURCE\n`;
 if(kind==='zandronum'){
  const ini=fs.readFileSync('internal/panel/game_library/scripts/zandronum-default.ini','utf8');
  script+=`cat > .voltra/zandronum-default.ini <<'VOLTRA_INI'\n${ini}\nVOLTRA_INI\n`;
  script+=`if [ "\${GEOIP:-1}" = 1 ] && [ ! -f zandronum/GeoIP.dat ]; then\npython3 - <<'VOLTRA_GEOIP'\nimport sys\nfrom pathlib import Path\nsys.path.insert(0,'.voltra')\nfrom native_release import download\np=Path('.voltra/zandronum-GeoIP.dat')\nif p.exists(): p.unlink()\ndownload(dict(url='https://raw.githubusercontent.com/pterodactyl/game-eggs/${catalog.revision}/doom/zandronum/GeoIP.dat',sha256='2813c828c197b0a848581473dd79643ed5bc155ffbef307fb902af288409ad50',bytes=595714),p)\nVOLTRA_GEOIP\nfi\n`;
 }
 if(kind==='nzportable')script+=`cat > .voltra/nzp-vril-console.patch <<'VOLTRA_PATCH'\n${fs.readFileSync('tools/runtime/nzp-vril-console.patch','utf8')}\nVOLTRA_PATCH\n`;
 script+=`python3 .voltra/bundle_debian_python.py\npython3 .voltra/${kind==='nzportable'?'nzp_install.py':'id_family_install.py zandronum'}\n`;
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 profiles[recipe]={upstream_sha256:entry.sha256,revision:kind+'-native-v1',platforms:['linux/amd64'],required_ports:1,...(kind==='nzportable'?{port_rules:[{environment:'NZP_ENGINE',value:'vril',minimum:1,maximum:65535,count:17,offsets:Array.from({length:16},(_,i)=>i+1)}]}:{}),defaults:{memory:512,disk:kind==='nzportable'?4096:2048},egg,verification:current[recipe]?.verification||'not_verified',detail:current[recipe]?.detail||'Reviewed native engine setup staged; runtime acceptance pending.',setup_steps:[
  `The publisher engine, data and operator files are under ${kind}/. Archives are checksum-checked and immutable cache copies are independent. Reinstall retains operator settings and modified stock files.`,
  kind==='zandronum'?'Freedoom 1 and 2 are bundled with their licenses. Choose an IWAD under IWAD/ and optional PWAD files under PWAD/. Separate multiple PWAD names with spaces; quote names containing spaces. All original gameplay flags, map, skill and GeoIP controls remain available.':'Modern Vril uses the matched2026 package plus a reviewed dedicated console/client-port source patch. It needs17 consecutive allocated UDP ports (gameplay plus16 future client slots). Legacy FTE uses matched2024 assets and compiled FTE server/client/menu QuakeC, retains original PROTOCOL/Web and GAME_ARGS controls, and needs only the primary UDP/TCP port. Current Vril and legacy FTE clients are incompatible; choose the matching engine.',
  ...(kind==='nzportable'?['Engine data and operator files are isolated in nzportable/vril and nzportable/fte_legacy. Edit nzp/voltra-server.cfg within the chosen directory. Modern tick interval maps to sys_ticrate; legacy maps to sv_mintic. Changing engine requires reinstall, retaining the other engine directory.']:[]),
  'Console forwards native commands. Stop sends native quit, allowing engine configuration persistence. No survival-world save semantics are claimed; back up the full volume before updates.',
  'Private LAN by default. Public master registration and actual client connections require separate operator acceptance.',
 ]};
}
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(profiles,null,2)+'\n');console.log('Staged ID-family profiles '+output);
