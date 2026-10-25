import fs from 'node:fs';
import crypto from 'node:crypto';
const base='internal/panel/game_library/scripts/';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const definitions=[['generic','wine/generic/egg-wine-generic.json',2048,8192],['nova','novalife_amboise/egg-nova--life--amboise.json',8192,16384],['modiverse','modiverse/egg-modiverse.json',4096,16384]];
const selected=Object.fromEntries(definitions.map(([game,path])=>[game,catalog.entries.find(e=>e.path===path)]));
for(const[game]of definitions)if(!selected[game])throw Error('Exact canonical recipe missing '+game);
const seed=selected.nova.egg.scripts.installation.script.match(/echo -n "(\{[^\r\n]+\})" \| jq/);
if(!seed)throw Error('Original Nova seed changed');
const values={SERVER_NAME:'',SERVER_LIST_NAME:'A Pterodactyl server',SERVER_SLOTS:'25',SERVER_PORT:'7777'};
const nova=JSON.parse(seed[1].replaceAll('\\"','"').replace(/\$\{(SERVER_NAME|SERVER_LIST_NAME|SERVER_SLOTS|SERVER_PORT)\}/g,(_,key)=>values[key]));
const modSource=base+'sandbox-servers-modiverse-seed.json';
if(crypto.createHash('sha256').update(fs.readFileSync(modSource)).digest('hex')!=='5f3d035b8a84d25a064fe11a99da3cdc3fdbac7f52d0e2f5575fa3f7e5a1a831')throw Error('Pinned MIT Modiverse configuration seed changed');
const modiverse=JSON.parse(fs.readFileSync(modSource));
fs.writeFileSync(base+'sandbox-servers-defaults.json',JSON.stringify({nova,modiverse},null,2)+'\n');
const shared=['steam-template.py','native-config.py','native-console.py','fantasy-worlds-runtime.py','fantasy-worlds-install.py','fantasy-worlds-wine.py','fantasy-worlds-wine-build.py'];
const sources=[...shared,'sandbox-servers.py','sandbox-servers-release.py','sandbox-servers-defaults.json'];
const stable='ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8';
const add=(egg,name,key,value,rules,description,view=true,edit=true)=>egg.variables.push({name,env_variable:key,default_value:value,rules,description,user_viewable:view,user_editable:edit,field_type:'text'});
const profiles={};
for(const[game,path,memory,disk]of definitions){
 const original=selected[game],egg=structuredClone(original.egg);
 egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template',...(game==='generic'?['voltra_typed_wine']:[])])];
 egg.docker_images=game==='generic'?{
  'Wine Latest, pinned':stable,
  'Wine Staging, pinned':'ghcr.io/ptero-eggs/yolks@sha256:c1fd6f4e6bdf84fc9049ef770b6b71cfe503263945f9d9df917c04eead1ed52b',
  'Wine Devel, pinned':'ghcr.io/ptero-eggs/yolks@sha256:c20277ab115b7ee8bd7ead76edabd15d6c17cc814a2a147a78c414293b2fd486',
 }:{'Pinned Linux runtime with Python':stable};
 add(egg,'Owned display supervision','XVFB','0','required|in:0','Image-wide Xvfb is disabled; generic Wine uses a private owned display. Linux dedicated servers run headless.',false,false);
 if(game==='generic'){
  add(egg,'Disable unrelated Steam updates','AUTO_UPDATE','0','required|in:0','Generic archive installation has no Steam application. Disable image-level Steam updates.',false,false);
  add(egg,'Installation source','INSTALL_SOURCE','download','required|in:download,uploaded','download requires HTTPS and an independently verified SHA256. uploaded uses your own legal archive or existing executable/files. No game or client assets are supplied.');
  add(egg,'Archive SHA256','DOWNLOAD_SHA256','','required_if:INSTALL_SOURCE,download|nullable|string|size:64','Required before a download. Optional for your own uploaded archive. Obtain the digest from a trusted publisher or independently verified build.');
  add(egg,'Uploaded archive','UPLOAD_ARCHIVE','','nullable|string|max:4096','Optional server-volume ZIP, gzip tar or XZ tar path in uploaded mode. Blank uses existing legal files at the original root-relative SERVER_EXECUTABLE path.');
  add(egg,'Literal server arguments','SERVER_ARGUMENTS','[]','required|string|max:65536','JSON array of literal arguments, for example ["-port","28015"]. No shell, expansion or command string parsing. The original executable field remains one literal path.');
  add(egg,'Observed readiness text','READINESS_MARKER','','nullable|string|max:1024','Original marker change me is not evidence of readiness. Supply a real message observed from your chosen server. Blank makes no readiness claim. Native connectivity remains unverified.');
  add(egg,'Private console secrets','CONSOLE_SECRETS','[]','required|string|max:65536','JSON array of private values to redact from native output, never arguments. Arbitrary third-party server configuration is retained and remains operator-managed.');
  add(egg,'Preserved paths','PRESERVE_PATHS','[".wine","Config","Saved","Saves","Worlds","Mods","Plugins","ServerConfig.toml","Resources"]','required|string|max:65536','JSON array of root-relative configuration/world/mod paths excluded from archive publication. Modified or unmanaged program collisions fail without overwriting operator files.');
 }
 if(game==='nova')for(const[key,label]of [['QUERY_PORT','Query port'],['STEAM_PORT','Steam port']])add(egg,label,key,'','nullable|integer|between:1,65535','Optional explicit native listener override. Blank retains existing native configuration or leaves the original seed unchanged. Nonblank/existing values require distinct selected allocations. Current native public-listing behavior remains unverified.');
 egg.startup='exec python3 .voltra/sandbox_servers.py '+game+' run';
 egg.config={files:'{}',startup:JSON.stringify({done:game==='generic'?'VOLTRA_GENERIC_READY':JSON.parse(original.egg.config.startup).done}),logs:original.egg.config.logs,stop:'^C'};
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 for(const source of sources)script+=`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_SANDBOX_SOURCE'\n${fs.readFileSync(base+source,'utf8')}\nVOLTRA_SANDBOX_SOURCE\n`;
 script+='python3 .voltra/sandbox_servers.py '+game+' install\n';
 egg.scripts.installation={container:'mcr.microsoft.com/dotnet/sdk@sha256:8dd1a57fe6b7b8b1b357635db67e272c2f9e9d76d1dd0a32711c4c33c57d7b43',entrypoint:'bash',script};
 profiles[path]={revision:game+'-sandbox-servers-v1',upstream_sha256:original.sha256,platforms:['linux/amd64'],verification:'not_verified',defaults:{memory,disk},required_ports:game==='modiverse'?2:1,
  port_rules:game==='modiverse'?[{environment:'QUERY_PORT',condition:'nonzero',allocated_value:true,auto_allocate:false,exclude_primary:true,minimum:1,maximum:65535,count:2}]:game==='nova'?['QUERY_PORT','STEAM_PORT'].map(environment=>({environment,condition:'nonzero',allocated_value:true,auto_allocate:false,exclude_primary:true,minimum:1,maximum:65535,count:3})):[],egg,
  detail:'Source adapter and bounded offline fixtures only. Native installation, console, shutdown/save, network/listing/client compatibility remain unverified. '+(game==='generic'?'Generic download requires an independent publisher SHA256, or use your own legal uploaded files. Original placeholder readiness is not claimed.':'Original public Steam application and all original startup variables are retained. Private Steam credentials fail closed.'),
  setup_steps:[
   'Choose a Linux amd64 node. Defaults are initial setup estimates, not measured acceptance results. Publisher and Windows dependency licenses remain operator prerequisites.',
   game==='generic'?'Retain the original download URL, INSTALL_DIR and root-relative SERVER_EXECUTABLE semantics. Download mode accepts only checksum-verified HTTPS ZIP/gzip-tar/XZ-tar archives. Uploaded mode accepts a legal archive or existing extracted files. Stable, staging and development Wine choices are separately pinned; none has native acceptance.':game==='nova'?'Set SERVER_NAME to the existing profile directory under Servers. Changing it selects another profile and never renames or deletes previous saves. Server-list name, slots and primary port apply without discarding administrator, whitelist, map, shop, autosave or unknown fields.':'Allocate the primary game port and locked original QUERY_PORT=27015 separately. Preserve the original ServerData UGC argument, InitUGCs behavior, map cycle/assets, PIN/RCON settings and native mod folders.',
   game==='generic'?'Arguments are a JSON array of literal strings. Existing configuration/mods remain operator-managed. Supply required Windows runtime dependencies under their licenses; no implicit license acceptance. Set an observed readiness message only after verifying it for your program.':'Public installation uses the reviewed original Steam AppID. Unknown private branches/credential transport remain blocked; operator legal files can run with AUTO_UPDATE=0.',
   'Console and Ctrl+C use shared native PTY supervision. Generic Wine owns a private display/prefix and never kills a shared wineserver. Native input delivery, clean stop, saves and gameplay still require acceptance.',
  ]};
}
fs.mkdirSync('.local/sandbox-servers',{recursive:true});
fs.writeFileSync('.local/sandbox-servers/profiles.json',JSON.stringify(profiles,null,2)+'\n');
fs.writeFileSync('.local/sandbox-servers/source-hashes.json',JSON.stringify(Object.fromEntries(sources.map(source=>[source,crypto.createHash('sha256').update(fs.readFileSync(base+source)).digest('hex')])),null,2)+'\n');
console.log('Staged exact Wine Generic, Nova-Life and Modiverse recipes; overrides untouched.');
