import fs from 'node:fs';
const base='internal/panel/game_library/scripts/',catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),previous=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
for(const [path,game] of [['colony_survival/egg-colony-survival.json','colony'],['hurtworld/egg-hurtworld.json','hurtworld'],['holdfast/egg-holdfast-na-w.json','holdfast'],['rising_world/unity/egg-rising-world-unity.json','rising']]){
 const entry=catalog.entries.find(e=>e.path===path),egg=structuredClone(entry.egg),revision=game+'-native-v1';
 egg.docker_images={'Pinned Linux native Steam runtime':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
 egg.features=[...new Set([...(egg.features??[]),'voltra_steam_template'])];
 egg.startup='exec env '+(game==='rising'?'VOLTRA_NATIVE_LD_LIBRARY_PATH="${LD_LIBRARY_PATH}" ':'')+`PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/steam-native-next.py run ${game}`;
 egg.config={...egg.config,files:'{}',stop:'^SIGTERM'};
 const add=(key,value,rules,description)=>{if(!egg.variables.some(v=>v.env_variable===key))egg.variables.push({name:key,env_variable:key,default_value:value,rules,description,user_viewable:true,user_editable:true,field_type:'text'});};
 if(game==='holdfast')add('AUTO_UPDATE','1','required|boolean','Typed public Steam update on startup; native configuration, moderation files and operator content are retained.');
 for(const v of egg.variables){
  if(['SERVER_STEAMPORT','QUERY_PORT','SERVER_COMM_PORT','SERVER_QUERY_PORT'].includes(v.env_variable)){v.default_value='';v.rules='nullable|integer|between:1,65535';v.user_editable=true;v.description+=' Distinct selected allocation; blank chooses an additional port.';}
  if(v.env_variable==='RCON_PORT'){v.default_value='';v.rules='nullable|integer|between:1,65535';v.user_editable=true;v.description+=' When RCON=true, blank selects a distinct additional allocated port.';}
  if(v.env_variable==='FPSMAX'){v.default_value='60';v.rules='required|integer|between:1,1000';v.user_editable=true;}
  if(v.env_variable==='PLAYERS'){v.default_value='32';v.rules='required|integer|between:1,250';v.user_editable=true;}
  if(game==='hurtworld'&&v.env_variable==='MAX_PLAYERS')v.rules='required|integer|between:1,2147483647';
  if(game==='hurtworld'&&v.env_variable==='ADMINS')v.rules='nullable|string|regex:/^[0-9]{17}$/';
  if(game==='hurtworld'&&v.env_variable==='HOSTNAME')v.rules+='|not_regex:/[;"\\\\]/';
  if(!['AUTO_UPDATE','SRCDS_APPID','MAX_PLAYERS','SERVER_STEAMPORT','QUERY_PORT','SERVER_COMM_PORT','SERVER_QUERY_PORT','PLAYERS','FPSMAX','RCON_PORT','INSTALL_OXIDE','CREATIVE_MODE'].includes(v.env_variable))v.rules=v.rules.replace(/\|$/,'')+'|not_regex:/[\\x00-\\x1f\\x7f]/';
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 for(const source of ['steam-native-next.py','native-config.py','native-release.py','native-console.py','steam-template.py','source-install.py','bundle-debian-python.py'])script+=`cat > .voltra/${source==='steam-template.py'?'steam_template.py':source} <<'VOLTRA_STEAM_NATIVE_SOURCE'\n${fs.readFileSync(base+source,'utf8')}\nVOLTRA_STEAM_NATIVE_SOURCE\n`;
 if(game==='hurtworld')script+=`cat > .voltra/Oxide-Hurtworld-LICENSE.txt <<'VOLTRA_OXIDE_LICENSE'\n${fs.readFileSync('internal/panel/game_library/licenses/oxide-hurtworld-MIT.txt','utf8')}\nVOLTRA_OXIDE_LICENSE\n`;
 script+=`python3 .voltra/bundle-debian-python.py\npython3 .voltra/steam-native-next.py install ${game}\n`;
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
 const roles=game==='colony'?['SERVER_STEAMPORT']:game==='hurtworld'?['QUERY_PORT']:game==='holdfast'?['SERVER_COMM_PORT','SERVER_QUERY_PORT']:[];
 const port_rules=roles.map(environment=>({environment,condition:'nonzero',allocated_value:true,auto_allocate:true,exclude_primary:true,minimum:1,maximum:65535,count:game==='holdfast'?3:2}));
 if(game==='rising')port_rules.push({minimum:1,maximum:65535,count:2,offsets:[-1]},{environment:'RCON_PORT',condition:'nonzero',allocated_value:true,auto_allocate:true,when_environment:'RCON',when_value:'true',exclude_primary:true,exclude_offsets:[-1],minimum:1,maximum:65535,count:3});
 profiles[path]={upstream_sha256:entry.sha256,revision,platforms:['linux/amd64'],required_ports:game==='holdfast'?3:2,port_rules,defaults:{memory:game==='colony'?2048:4096,disk:game==='holdfast'?16384:8192},verification:previous[path]?.revision===revision?previous[path].verification:'not_verified',detail:previous[path]?.revision===revision?previous[path].detail:'Typed native implementation and source fixtures ready; live game acceptance pending.',egg,setup_steps:[
  'Installs the original public Linux dedicated Steam tool anonymously. No owning game account or additional server token is required for the default public branch. Publisher game binaries remain proprietary and are downloaded directly by Steam, not included in this repository.',
  ...(game==='colony'?[
   'All original world/name/player limit/game and Steam port controls remain. Current publisher server.config.json is preserved, including NewOptions versus LoadOptions, world generation, difficulty, mods, networking/listing and RCON settings. Missing config uses checksum-pinned publisher commit23c8dad2; original +server.steamport is retained for native compatibility rather than silently discarded.',
   'Select distinct game and Steam allocations. Existing gamedata/savegames/world state and modstate remain operator owned. A new world can take time to generate. Stop forwards native Ctrl-C; actual saving/restart/query/client compatibility requires native proof.',
  ]:game==='hurtworld'?[
   'All original host/name/query/maxplayers/creative/admin/auto-update controls remain. Hurtworld reparses its semicolon -exec command language: names containing semicolons, quotes or backslashes are explicitly rejected to prevent injecting additional commands. Optional owner uses one SteamID64; no fabricated administrator is supplied.',
   'Optional INSTALL_OXIDE installs checksum-pinned official MIT Oxide.Hurtworld2.0.4112, retaining legal notices. INSTALL_PLUGINS keeps the original comma-separated plugin names; spaces are removed as before, traversal/HTML responses are rejected, each newly downloaded C# source receives a SHA256 receipt, and existing operator plugin edits are retained. Plugins retain their own author licenses. Compatibility and actual plugin execution require native proof.',
   'Select distinct allocated host/query ports. Native console remains available; output uses the Unity stdout log option. Saves, autoexec, oxide config/data/plugins and edited assets survive real Steam validation/reinstall. Stop forwards native Ctrl-C and keeps the actual exit code.',
  ]:game==='holdfast'?[
   'All13 original controls remain: selected configs, name/MOTD/region/admin/join passwords, players, communications/query ports, frame rate, log archive and Steam build flags. Original empty numeric defaults now have usable typed defaults. Select three distinct allocated game/Steam communications/query ports.',
   'Keeps the original holdfastnaw-dedicated layout and every output/admin/player/score/chat/archive/workshop/mute/ban path. Managed native globals are composed after imports and before map rotations; unknown maps, mods, permissions and comments remain. Publisher default config is copied only when selected config is missing. No unpinned third-party config Git clone or shared foreign host address is used.',
   'EXTRA_FLAGS supports -beta branch and optional -betapassword, mapped to typed Steam options. Private beta-password transport remains explicitly unsupported by the shared Steam helper until faithful native parsing is proved. Public default does not need credentials. Native console and Ctrl-C remain; runtime/remote administration/query proof is separate from installation.',
  ]:[
   'All11 original Unity controls remain, including public beta branch, original library path, name/password/world/game mode and optional RCON. Uses current Unity RisingWorldServer.x64; no Java-server substitution. World_GameMode is applied natively and only governs new-world creation per publisher documentation.',
   'Allocate primary game port and exactly primary-minus-one query port on the same address. If RCON=true, allocate a third distinct port and use a password of at least six characters. RCON remains native and optional; no new public web administration endpoint is added.',
   'server.properties, Worlds, permissions and plugins survive validation/reinstall. Comments and unknown properties remain. Native console and original Ctrl-C are forwarded; actual query/RCON, save/restart and game-client compatibility require separate proof.',
  ]),
  'Steam install, native readiness, protocol queries, saving/restart and game-client gameplay are reported separately. AUTO_UPDATE is handled by the typed Steam helper with operator-file retention rather than image shell expansion.',
 ]};
}
fs.mkdirSync('.local/steam-native-next',{recursive:true});fs.writeFileSync('.local/steam-native-next/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged Colony, Hurtworld, Holdfast and Rising World Unity.');
