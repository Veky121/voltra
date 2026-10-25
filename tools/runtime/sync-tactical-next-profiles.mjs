import fs from'node:fs';import crypto from'node:crypto';
if(process.argv.includes('--groundbranch-relay')){
 const base='internal/panel/game_library/scripts/',current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
 for(const recipe of ['americas_army/proving_grounds/egg-america-s-army--proving-grounds.json','battalion_legacy/egg-b-a-t-t-a-l-i-o-n--legacy.json','ground_branch/egg-ground-branch.json']){
  const profile=structuredClone(current[recipe]);if(!profile)throw Error('Missing current profile');
  let script=profile.egg.scripts.installation.script;
  const marker="cat > .voltra/tactical_next_runtime.py <<'VOLTRA_SOURCE'\n",start=script.indexOf(marker),end=script.indexOf('\nVOLTRA_SOURCE\n',start);
  if(start<0||end<0)throw Error('Missing current runtime heredoc');
  script=script.slice(0,start)+marker+fs.readFileSync(base+'tactical-next-runtime.py','utf8')+script.slice(end);
  if(recipe==='ground_branch/egg-ground-branch.json'){
   const relay="cat > .voltra/native_log.py <<'VOLTRA_SOURCE'\n",body=fs.readFileSync(base+'native-log.py','utf8');
   const old=script.indexOf(relay);
   if(old>=0){const tail=script.indexOf('\nVOLTRA_SOURCE\n',old);if(tail<0)throw Error('Malformed relay heredoc');script=script.slice(0,old)+relay+body+script.slice(tail);}
   else script=script.replace("cat > .voltra/groundbranch_original_Server.ini <<'VOLTRA_DEFAULT'",relay+body+"\nVOLTRA_SOURCE\ncat > .voltra/groundbranch_original_Server.ini <<'VOLTRA_DEFAULT'");
   if(!script.includes(relay))throw Error('Missing Ground Branch insertion point');
  }
  profile.egg.scripts.installation.script=script;profiles[recipe]=profile;
 }
 fs.mkdirSync('.local/groundbranch-relay',{recursive:true});fs.writeFileSync('.local/groundbranch-relay/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged current tactical profiles with Ground Branch native log relay; metadata preserved.');
 process.exit(0);
}
const dir='.local/tactical-next',base='internal/panel/game_library/scripts/';fs.mkdirSync(dir,{recursive:true});
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={},archive=[];
const helpers=['steam-template.py','source-install.py','source-next-install.py','bundle-debian-python.py','native-config.py','native-console.py','tactical-install.py','tactical-runtime.py','tactical-next-install.py','tactical-next-runtime.py'];
for(const [recipe,kind,disk]of [['americas_army/proving_grounds/egg-america-s-army--proving-grounds.json','aapg',16384],['battalion_legacy/egg-b-a-t-t-a-l-i-o-n--legacy.json','battalion',32768],['ground_branch/egg-ground-branch.json','groundbranch',16384]]){
 const entry=catalog.entries.find(e=>e.path===recipe);if(!entry)throw Error('Missing exact imported recipe');const egg=structuredClone(entry.egg);
 const original=Buffer.from(JSON.stringify(entry.egg));fs.writeFileSync(dir+'/'+kind+'-original.json',original);
 archive.push({path:recipe,upstream_sha256:entry.sha256,local_original_json_sha256:crypto.createHash('sha256').update(original).digest('hex'),repository:catalog.repository,revision:catalog.revision});
 egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
 egg.docker_images=kind==='groundbranch'?{'Wine [Latest]':'ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8','Wine [Staging]':'ghcr.io/ptero-eggs/yolks@sha256:c1fd6f4e6bdf84fc9049ef770b6b71cfe503263945f9d9df917c04eead1ed52b'}:{'Debian Steam runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/tactical_next_runtime.py';
 egg.config={files:'{}',startup:entry.egg.config.startup,logs:entry.egg.config.logs,stop:'^C'};
 const add=(key,name,value,rules,description,hidden=false)=>{if(egg.variables.some(v=>v.env_variable===key))return;egg.variables.push({env_variable:key,name,default_value:value,rules,description,user_viewable:!hidden,user_editable:!hidden,field_type:'text'});};
 add('VOLTRA_TACTICAL_NEXT','Original tactical profile',kind,`required|string|in:${kind}`,'Fixed reviewed dedicated recipe.',true);
 add('AUTO_UPDATE','Automatic publisher updates','0','required|boolean','Uses the typed updater. Back up operator content before publisher changes.');
 add('SRCDS_BETAID','Steam branch','','nullable|string|max:64|regex:/^[A-Za-z0-9_.-]+$/','Empty selects public. Original publisher application identity remains fixed.');
 add('SRCDS_BETAPASS','Protected beta password','','nullable|string|max:128','Private Steam credentials remain fail-closed before publisher or filesystem side effects.');
 // Retain every original default and visibility. Correct only impossible port
 // upper bounds in validation; explicit operator ports are never substituted.
 for(const v of egg.variables)if(['QUERY_PORT','AUTH_PORT'].includes(v.env_variable))v.rules='required|integer|between:1025,65535';
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 for(const name of [...helpers,...(kind==='groundbranch'?['native-log.py']:[])])script+=`cat > .voltra/${name.replaceAll('-','_')} <<'VOLTRA_SOURCE'\n${fs.readFileSync(base+name,'utf8')}\nVOLTRA_SOURCE\n`;
 if(kind==='groundbranch'){
  const match=entry.egg.scripts.installation.script.match(/cat > Server.ini << EOF\r?\n([\s\S]*?\r?\n)EOF/);if(!match)throw Error('Original Ground Branch defaults absent');
  const defaults=fs.readFileSync(base+'groundbranch-original-server.ini');if(!defaults.equals(Buffer.from(match[1])))throw Error('Original Ground Branch defaults drifted');
  script+=`cat > .voltra/groundbranch_original_Server.ini <<'VOLTRA_DEFAULT'\n${defaults.toString()}VOLTRA_DEFAULT\n`;
 }
 script+='python3 .voltra/bundle_debian_python.py\nPYTHONPATH=.voltra python3 - <<\'VOLTRA_INSTALL\'\nfrom pathlib import Path\nimport os\nfrom tactical_next_install import install\ninstall(Path.cwd(),dict(os.environ))\nVOLTRA_INSTALL\n';
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 const count=kind==='aapg'?3:2,roles=['QUERY_PORT',...(kind==='aapg'?['AUTH_PORT']:[])];
 profiles[recipe]={upstream_sha256:entry.sha256,revision:'tactical-next-v1',platforms:['linux/amd64'],required_ports:count,port_rules:roles.map(environment=>({environment,condition:'nonzero',minimum:1025,maximum:65535,count,allocated_value:true,exclude_primary:true,auto_allocate:true})),defaults:{memory:4096,disk},egg,verification:current[recipe]?.verification||'not_verified',detail:current[recipe]?.detail||'Original tactical recipe implemented; dedicated publisher/runtime prerequisites and lifecycle acceptance pending.',setup_steps:[
  kind==='aapg'?'Allocate separate original gameplay, Steam authentication and Steam query ports. Keep the original role defaults or explicitly assign their matching ports; explicit ports are never silently replaced.':'Allocate distinct original gameplay and query ports. Original role defaults remain intact and must match assigned ports. Undocumented implicit listeners require a native socket audit.',
  kind==='aapg'?'Preserves dedicated app203300 and Binaries/Linux/AAPG, server name, -SAP and -SQP controls. Original Finished loading level is an initialization marker, not proof of online authentication or public-service availability.':kind==='battalion'?'Preserves app805140, server name, admin password, auto-update and fixed Wartide queue. Supports the original Linux shipping binary or the publisher-pinned BattalionServer/BattalionServer.sh layout, requiring exactly one. The malformed original server-name substitution and printable Stop typo are corrected.':'Preserves Windows app476400, Wine Latest/Staging choices (pinned to current amd64 manifests), hidden win64/WINEDEBUG/WINEPATH controls, original16-player default, original Server.ini template, and VALIDATE repair behavior. The selected Wine image must supply wine and a headless display; no speculative Linux payload or Proton substitution is used.',
  kind==='groundbranch'?'Server.ini keeps native unknown settings and comments; the setup form edits only the original ServerName and MaxPlayers keys. DefaultModding.ini retains its original Workshop16900 ModPath. This original recipe does not automatically acquire Workshop items; keep existing content and admin/map configuration.':'Operator native configuration, saves, server settings, mods and custom maps are retained through publisher success and failure. Advanced native files remain available through the existing file manager.',
  'Private Steam accounts and protected beta passwords are explicitly gated before side effects; anonymous publisher unavailability remains a real error. The installer does not borrow client assets or report stub success.',
  'Console input and Stop use the shared native PTY with actual ETX. Windows Wine signal/save behavior, native queries, current publisher availability, player joining and gameplay remain unverified; no exit code is normalized.'
 ]};
}
fs.writeFileSync(dir+'/profiles.json',JSON.stringify(profiles,null,2)+'\n');fs.writeFileSync(dir+'/source-archive.json',JSON.stringify(archive,null,2)+'\n');console.log('Staged three original tactical profiles and exact source archive identities.');
