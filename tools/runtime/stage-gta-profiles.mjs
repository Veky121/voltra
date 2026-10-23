import fs from'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),prior=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
const image='ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b';
for(const[path,game]of[['gta/openmp/egg-open-m-p.json','openmp'],['gta/mtasa/egg-multi-theft-auto.json','mtasa']]){
 const entry=catalog.entries.find(e=>e.path===path),egg=structuredClone(entry.egg),revision=game+'-native-v1';
 egg.docker_images={'Debian12 native dedicated server':image};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/gta-runtime.py ${game}`;
 egg.config={files:'{}',startup:JSON.stringify({done:game==='openmp'?'Legacy Network started on':'Server started and is ready to accept connections'}),logs:'{}',stop:'^SIGINT'};
 const add=(name,key,description,value,rules)=>egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
 add('Server name','SERVER_NAME','Native displayed name. Quotes and literal characters are stored as configuration data.',game==='openmp'?'My open.mp server':'My MTA server','required|string|max:128');
 add('Player limit','MAX_PLAYERS','Native maximum players.',game==='openmp'?'50':'32',game==='openmp'?'required|integer|between:1,1000':'required|integer|between:1,4096');
 add('Join password','SERVER_PASSWORD','Optional native server join password.','','nullable|string|max:64');
 if(game==='openmp'){
  const password=egg.variables.find(v=>v.env_variable==='RCON_PASSWORD');password.rules='nullable|string|max:32';password.description='Native remote-console password. Empty creates a private persistent credential under .voltra/openmp/rcon-password. Never use the publisher changeme password.';
  egg.variables.find(v=>v.env_variable==='VERSION').default_value='v1.6.7.3218';
  add('Native RCON enabled','RCON_ENABLED','Enable native UDP remote console with its private password.','1','required|boolean');
  add('Public listing','PUBLIC_SERVER','Enable publisher master listing. Query remains available for private LAN use.','0','required|boolean');
  add('Model artwork HTTP port','ARTWORK_PORT','0 uses the game port over TCP. Another value must be allocated on this server address. Native config still owns model/CDN behavior.','0','required|integer|between:0,65535');
  add('Older release SHA256','RELEASE_SHA256','Only needed when a historical publisher release lacks a SHA256 digest. Invalid versions fail without installing another version.','','nullable|string|regex:/^[A-Fa-f0-9]{64}$/');
 }else{
  const port=egg.variables.find(v=>v.env_variable==='SERVER_WEBPORT');port.default_value='0';port.user_editable=true;port.rules='required|integer|between:0,65535';port.description='0 automatically uses a separate additional allocation. HTTP is independently configurable; the old recipe +3 description is incorrect. This port does not have to be adjacent to the game port.';
  add('ASE listing/query','ASE_ENABLED','Enable native ASE. Requires a third allocation exactly game port+123, separate from HTTP. Private default disables it.','0','required|boolean');
  add('Updated stable engine SHA256','MTA_RELEASE_SHA256','Optional operator-reviewed SHA256 if the publisher replaces its rolling stable download. Default verifies reviewed1.6.0-release-24153; a mismatch stops installation without accepting changed bytes.','','nullable|string|regex:/^[A-Fa-f0-9]{64}$/');
 }
 egg.variables.push({name:'Native updates owned by installer',env_variable:'AUTO_UPDATE',description:'Disable unrelated base-image Steam updater.',default_value:'0',rules:'required|in:0',user_viewable:false,user_editable:false,field_type:'text'});
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\n'+(game==='openmp'?'dpkg --add-architecture i386\n':'')+'apt-get update\napt-get install -y --no-install-recommends python3 ca-certificates'+(game==='openmp'?' libatomic1:i386':'')+'\nmkdir -p .voltra\n';
 for(const name of['gta-install.py','gta-runtime.py','native-release.py','native-config.py','native-console.py','bundle-debian-python.py'])script+=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')}\nVOLTRA_SOURCE\n`;
 script+=`cat > .voltra/steam_template.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/steam-template.py','utf8')}\nVOLTRA_SOURCE\npython3 .voltra/bundle-debian-python.py\npython3 .voltra/gta-install.py ${game} 2>&1 | tee .voltra/gta-install.log\n`;
 egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
 profiles[path]={upstream_sha256:entry.sha256,revision,platforms:['linux/amd64'],defaults:{memory:1024,disk:8192},required_ports:game==='mtasa'?2:1,port_rules:game==='mtasa'?[{environment:'ASE_ENABLED',value:'1',minimum:1,maximum:65535,count:3,offsets:[123]}]:[],egg,verification:prior[path]?.revision===revision?prior[path].verification:'not_verified',detail:prior[path]?.revision===revision?prior[path].detail:'Implemented; native acceptance pending.',setup_steps:game==='openmp'?[
  'Publisher open.mp1.6.7.3218 is pinned and verified by SHA256. Native x86 components run on the x64 Linux node with its32-bit runtime libraries. No GTA client/game data is distributed. Players need a compatible legally owned GTA:San Andreas installation and multiplayer client.',
  'Keep openmp/config.json, bans.json, Pawn gamemodes/filterscripts, plugins, components, scriptfiles and custom models. Only server identity, allocated network/artwork ports, join password, player limit and RCON settings are managed. Other native options remain editable in Files. Original root operator data is copied once and retained.',
  'The default publisher gungame mode is included. Upload compatible Pawn.amx or compile your own sources using the included publisher qawno compiler. Native plugins and extra components stay supported in their original directories; select compatible32-bit Linux libraries.',
  'Console forwards native commands, including cmdlist, varlist, banip, reloadbans and exit. Stop requests native exit. Blank RCON password generates a persistent private service credential; read it privately in Files. Back up native game-mode/scriptfiles state and bans before changes.',
 ]:[
  'Publisher MTA1.6.0-release-24153 and its default configuration are checksum-pinned. Default resources come from immutable official source commit0c8be6ac, including their license. The publisher stable engine URL is rolling; a changed download fails integrity validation until you explicitly review/update its SHA256 or provide the reviewed cached archive.',
  'Use two allocations on the same address: UDP game plus separate TCP HTTP. The HTTP port is configurable independently. Enabling ASE additionally requires UDP game port+123; the shared setup form selects this exact offset. No public listing or client gameplay is implied by native query tests.',
  'Keep mtasa/mods/deathmatch/mtaserver.conf, ACL, accounts databases, bans, resources, script/module data and custom x64 modules. The installer seeds configuration/resources only once, preserving later edits and deliberate deletions. Original root mods/module files are copied once and retained.',
  'Native resource administration remains available through Console and publisher HTTP resources. Use refresh/start/stop/restart for resources and shutdown to save/stop. Native admin account creation and ACL membership are operator-controlled; no administrator account is fabricated. Players require compatible MTA and their own legally owned GTA:San Andreas client data.',
  'For the built-in HTTP admin browser, open http://node-address:HTTP-port/resourcebrowser/ directly. The reviewed publisher redirects the bare root URL to HTTPS even when native TLS is not configured; use the direct HTTP resource path or configure your own HTTPS reverse proxy. Native HTTP administration requires your own account and ACL permissions; do not expose its login publicly over plain HTTP.',
 ]};
}
fs.mkdirSync('.local/gta-games',{recursive:true});fs.writeFileSync('.local/gta-games/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged OpenMP and MTASA profiles separately from reviewed catalog.');
