import fs from 'node:fs';
const base='internal/panel/game_library/scripts/',catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),prior=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
const renown=catalog.entries.find(e=>e.path==='renown/egg-renown.json').egg;
const templates={};
for(const[name,marker]of[['Game.ini','GAME_INI'],['Engine.ini','ENGINE_INI']]){
 const script=renown.scripts.installation.script.replaceAll('\r\n','\n'),start=script.indexOf('cat <<EOF > "$'+marker+'"');
 if(start<0)throw Error('original seed missing');
 const tail=script.slice(script.indexOf('\n',start)+1);
 templates[name]=tail.slice(0,tail.indexOf('\nEOF')).replace(/\$\{([A-Z_]+)\}/g,(_,key)=>renown.variables.find(v=>v.env_variable===key)?.default_value??'')+'\n';
}
const config={origin:'Exact imported canonical Renown recipe, MIT game-eggs source; seed missing configs only',eos_args:renown.startup.split(' ').filter(a=>a.startsWith('-ini:Engine:')),templates};
fs.writeFileSync(base+'ghost-love-renown-config.json',JSON.stringify(config,null,2)+'\n');
for(const[path,game]of[['midnight_ghost_hunt/egg-midnight-ghost-hunt.json','ghost'],['no_love_lost/egg-no-love-lost.json','love'],['renown/egg-renown.json','renown']]){
 const entry=catalog.entries.find(e=>e.path===path),egg=structuredClone(entry.egg),revision='ghost-love-renown-'+game+'-typed-v1';
 const variable=key=>egg.variables.find(v=>v.env_variable===key);
 const add=(key,value,rules,description,visible=true)=>{if(!variable(key))egg.variables.push({name:key,env_variable:key,default_value:value,rules,description,user_viewable:visible,user_editable:visible,field_type:'text'});};
 egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
 egg.docker_images={'Pinned Linux Steam and private per-server Proton runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/ghost_love_renown.py run ${game}`;
 egg.config={files:'{}',startup:entry.egg.config.startup,logs:'{}',stop:'^SIGTERM'};
 for(const key of['STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS'])add(key,'','nullable|string|max:255','Original implicit Steam input retained. Public anonymous dedicated tools are supported; reviewed private credential transport is unavailable and fails before credentials are sent.');
 add('SRCDS_BETAID','','nullable|string|max:64','Original public Steam branch input retained; clients and mods must match the selected branch.');
 add('INSTALL_FLAGS','','nullable|string|max:1024','Original implicit installer flags retained as an explicit unavailable prerequisite; arbitrary shell commands are never evaluated.');
 add('WINDOWS_INSTALL',game==='renown'?'0':'1','required|boolean','Exact original dedicated platform: Renown Linux; Ghost/Love Windows64 through a private pinned Proton. Alternate platforms are rejected.',false);
 if(game==='love')add('SERVER_PASSWORD','','nullable|string|max:128','Publisher-documented optional native serverpassword. Blank preserves the original public launch; no password is generated.');
 const roles=game==='love'?['QUERY_PORT']:game==='ghost'?['QUERY_PORT','BEACON_PORT']:['QUERY_PORT','BEACON_PORT','RCON_PORT'];
 const required=roles.length+1;
 const port_rules=[];
 for(const environment of roles){
  const rule={environment,condition:'nonzero',allocated_value:true,exclude_primary:true,minimum:1,maximum:65535,count:required};
  if(game==='renown'){
   const v=variable(environment);v.default_value='';v.rules='nullable|integer|between:1024,65535';v.description+=' Original0 default was invalid against its own mandatory native rules. Blank now selects a distinct allocated port automatically; explicit valid operator values remain.';
   rule.auto_allocate=true;rule.minimum=1024;
  }
  port_rules.push(rule);
 }
 // Unconditional minimum retains exact native role count even while fields auto-select.
 port_rules.unshift({minimum:1,maximum:65535,count:required});
 if(game==='renown'){
  variable('ADMIN_PASSWORD').rules+='|not_in:ChangeMe';variable('ADMIN_PASSWORD').description+=' Set your real private administrator password; original placeholder is retained but not ready.';
  variable('RCON_PASSWORD').rules='nullable|required_if:environment.ENABLE_RCON,True|string|not_in:RconPassword';
  variable('RCON_PASSWORD').description+=' Original placeholder is not a valid enabled RCON credential; disabled RCON may leave this blank.';
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6 libvulkan1\nmkdir -p .voltra\n';
 for(const name of['ghost-love-renown.py','ghost-love-renown-config.json','ark-family.py','native-config.py','native-console.py','steam-template.py','enshrouded-proton.py','bundle-debian-python.py'])script+=`cat > .voltra/${name.endsWith('.json')?name:name.replaceAll('-','_')} <<'VOLTRA_GHOST_LOVE_RENOWN_SOURCE'\n${fs.readFileSync(base+name,'utf8')}\nVOLTRA_GHOST_LOVE_RENOWN_SOURCE\n`;
 script+=`python3 .voltra/bundle_debian_python.py\npython3 .voltra/ghost_love_renown.py install ${game}\n`;
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
 profiles[path]={upstream_sha256:entry.sha256,revision,platforms:['linux/amd64'],required_ports:required,port_rules,defaults:{memory:game==='renown'?8192:4096,disk:game==='renown'?32768:16384},egg,verification:prior[path]?.revision===revision?prior[path].verification:'not_verified',detail:prior[path]?.revision===revision?prior[path].detail:'Source-only typed original controls/configuration and offline failure fixtures; native game/account/protocol/save acceptance has not run.',setup_steps:[
  game==='ghost'?'Original Midnight Ghost Hunt Windows64 app1118810 through private checksum-pinned GE-Proton; all12 original controls/defaults/visibility retained. Game/query/beacon, map/name/game mode/region/bot difficulty/password and additional native options remain typed literal arguments. Map names with spaces are preserved as one native value, fixing original unquoted map expansion.':game==='love'?'Original No Love Lost Windows64 app2833050 through private checksum-pinned GE-Proton; all5 original controls/defaults/visibility retained. Original client steam_appid1873120 and validated Windows SDK1007 remain. Publisher optional serverpassword is additive; blank retains original public server.':'Original Renown app1512690 native Linux, all17 original controls/visibility retained. Three invalid mandatory port defaults0 are explicitly corrected to blank automatic allocation; valid explicit values survive. Original public/private session, map rotation/save identity, first map, first person, players, admin and optional RCON remain typed native INI values. Replace original admin/RCON placeholders with actual private credentials before enabled use.',
  ...(game==='renown'?["Memory starts at 8 GiB. Lower limits may run out of memory while the map loads; allow additional room for players."]:[]),
  `Allocate ${required} distinct same-address native listener ports. Original role defaults remain except reviewed Renown invalid0 correction. Missing/colliding/unallocated roles fail before updates and launch; no undocumented offset ports are inferred.`,
  game==='renown'?'Publisher-linked Linux guide documents the original static EOS dedicated-server flags. These exact public client configuration flags remain, with output redaction; no EOS account, new secret, auth bypass or replacement identity is invented. Game.ini and Engine.ini original complete installer seeds are used only for missing files; all existing gameplay multipliers, bans/admin whitelist, queue, maintenance/decay, party/network/mod settings and saves remain.':'Original SDK1007 is acquired in an isolated stage with its own validated receipt; all64-bit DLL roles are checked before secure publication beside the game. Private GE-Proton11-9 is pinned by SHA256/SHA512 with original archive licenses; no runtime/game acquisition or native compatibility claim occurred during this checkpoint.',
  'Original install account/auth/branch/beta-password/platform/INSTALL_FLAGS fields remain explicit. Public anonymous typed transport is supported; unavailable private credential/flag transport fails closed before mutation. All native INI/CFG/TXT/JSON bytes/mode/timestamps are restored on failed installation, including later SDK/Proton failures; no shell, blanket chown, log deletion or config overwrite occurs.',
  'Shared console preserves stdin/native output/redaction. A confined bounded log follower forwards only new native log bytes without deleting existing logs, handles truncation/rotation and suppresses credentials. Stop sends native SIGINT only to the invocation-owned process group with bounded escalation/actual child return code. No fabricated save command, query response, player join or readiness marker is emitted.',
  'Source-only: no game/runtime acquisitions, native leases, accounts, production build/service or original application changes. Native launch/client listing/query/RCON/mod/save/reinstall compatibility remains unverified; offline fixtures and tiny-process signals do not establish game proof.',
 ]};
}
fs.mkdirSync('.local/ghost-love-renown',{recursive:true});fs.writeFileSync('.local/ghost-love-renown/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged exact Ghost/Love/Renown3, source-only.');
