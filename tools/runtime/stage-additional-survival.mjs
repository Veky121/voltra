import fs from'node:fs';
const base='internal/panel/game_library/scripts/';const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const existing=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profiles={};const add=(egg,name,key,value,rules,description='')=>egg.variables.push({name,env_variable:key,default_value:value,rules,description,user_viewable:true,user_editable:true,field_type:'text'});
for(const game of ['barotrauma','enshrouded']){
 const entry=catalog.entries.find(e=>e.path===game+'/egg-'+game+'.json');if(!entry)throw Error('Pinned recipe absent');
 const egg=structuredClone(entry.egg),windows=game==='enshrouded';
 const image=windows?'ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b';
 egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];egg.docker_images={[windows?'Pinned Debian trixie Wine base with private GE-Proton':'Pinned Debian Steam runtime']:image};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/${game}_runtime.py`;
 egg.config={files:'{}',startup:JSON.stringify({done:windows?"[Session] 'HostOnline' (up)!":'Server started'}),logs:'{}',stop:windows?'^C':'quit'};
 if(!windows){
  add(egg,'Server name','SERVER_NAME','Barotrauma server','required|string|max:60');
  add(egg,'Maximum players','MAX_PLAYERS','8','required|integer|between:1,16');
  add(egg,'Join password','SERVER_PASSWORD','','nullable|string|max:128','Empty permits passwordless joins. Stored in private native serversettings.xml.');
  add(egg,'Public listing','PUBLIC_SERVER','0','required|boolean','Default LAN/private. Public registration needs both gameplay and Steam query ports reachable.');
  add(egg,'Query port','QUERY_PORT','','nullable|integer|between:1,65535','Empty chooses the second selected allocation.');
 }else{
  for(const variable of egg.variables){
   if(variable.env_variable==='MAX_PLAYERS')variable.rules='required|integer|between:1,16';
   if(variable.env_variable==='SRV_NAME')variable.rules='required|string|max:128';
  }
  add(egg,'Difficulty preset','GAME_PRESET','Default','required|in:Default,Relaxed,Hard,Survival,Custom','Custom preserves native gameSettings; configure the detailed values in Files.');
  add(egg,'Voice chat','VOICE_CHAT','0','required|boolean');add(egg,'Text chat','TEXT_CHAT','0','required|boolean');
  egg.variables.push({name:'Headless dedicated runtime',env_variable:'XVFB',default_value:'0',rules:'required|in:0',description:'Dedicated server runs headless; image-wide Xvfb must not be killed before native saving.',user_viewable:false,user_editable:false});
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6'+(windows?' libvulkan1':'')+'\nmkdir -p .voltra\n';
 const sources=['steam-template.py','bundle-debian-python.py','native-config.py','additional-survival-install.py',...(!windows?['native-console.py']:['enshrouded-proton.py']),game+'-runtime.py'];
 for(const source of sources)script+=`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_SOURCE'\n${fs.readFileSync(base+source,'utf8')}\nVOLTRA_SOURCE\n`;
 script+=`python3 .voltra/bundle_debian_python.py\nPYTHONPATH=.voltra python3 .voltra/additional_survival_install.py ${game}\n`;
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
 profiles[entry.path]={upstream_sha256:entry.sha256,revision:game+'-native-v'+(windows?'4':'2'),platforms:['linux/amd64'],required_ports:windows?1:2,defaults:{memory:windows?12288:3072,disk:windows?32768:8192},verification:'not_verified',detail:'Reviewed configuration and typed Steam setup implemented; native acceptance pending.',egg,setup_steps:windows?[
  'Choose a Linux x64 node with at least 12 GiB memory and enough disk for Proton, Steam staging and the world. The primary allocation is the native query/game connection port.',
  'The original four user-group passwords remain available and must be distinct, nonempty and not purely numeric. Existing role permissions, custom groups and other native JSON fields are preserved.',
  'Windows server files use typed Steam platform selection. A verified private GE-Proton11-9 installation and bundled Vulkan loader support SteamUtils011 in current Enshrouded releases; the older image bridge is not used. Keep .steam/steam/steamapps/compatdata/2278520 for its private prefix.',
  'Keep savegame and enshrouded_server.json to retain the world. Managed form fields apply on startup; edit detailed custom gameSettings through Files while offline.',
  'The dedicated server has no interactive stdin console. Stop forwards SIGINT to the Proton process group; native world saving and shutdown still require acceptance.',
 ]:[
  'Choose a Linux x64 node and two available allocations on the same address. The primary is gameplay; the second is the Steam query port.',
  'LAN/private is the default. Name, slot count, listing and password are managed in private serversettings.xml; other XML attributes, nested settings and comments are retained by the launcher.',
  'The shared terminal supervisor supplies the native interactive console. Stop sends quit and waits for the native process; gameplay and campaign acceptance are recorded separately.',
  'Keep serversettings.xml, config_player.xml, Data account/permission files, LocalMods and campaign saves. Installation preserves operator configuration across Steam validation.',
 ]};
 if(existing[entry.path]?.revision===profiles[entry.path].revision){
  profiles[entry.path].verification=existing[entry.path].verification??'not_verified';
  if(existing[entry.path].detail)profiles[entry.path].detail=existing[entry.path].detail;
 }
}
fs.mkdirSync('.local/additional-survival',{recursive:true});fs.writeFileSync('.local/additional-survival/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged Barotrauma and Enshrouded; no overrides changed.');
