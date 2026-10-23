import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const dir='.local/source-next';fs.mkdirSync(dir,{recursive:true});
execFileSync(process.execPath,['tools/runtime/sync-source-profiles.mjs',dir+'/base-source.json'],{windowsHide:true,stdio:'inherit'});
const base=JSON.parse(fs.readFileSync(dir+'/base-source.json'))['counter_strike/counter_strike_source/egg-counter--strike--source.json'];
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profiles={};
for(const [recipe,app,game,map,disk]of [['gmod/egg-garry-s-mod.json','4020','garrysmod','gm_flatgrass',16384],['sourcecoop/egg-source-coop.json','346680','bms','bm_c0a0a',32768],['open_fortress/egg-open-fortress.json','244310','open_fortress','dm_2fort',49152],['contagion/egg-contagion.json','293030','contagion','ce_barlowe',24576]]){
 const original=catalog.entries.find(e=>e.path===recipe),egg=structuredClone(original.egg);
 const originalVariables=structuredClone(egg.variables);
 egg.features=[...new Set([...egg.features,'voltra_steam_template'])];egg.docker_images=base.egg.docker_images;
 egg.startup=base.egg.startup.replace('source_runtime.py','source_next_runtime.py');
 egg.config={...base.egg.config,startup:JSON.stringify({done:'VOLTRA_SOURCE_MAP_READY'})};
 for(const v of base.egg.variables){if(['SRCDS_APPID','SRCDS_GAME','STEAM_TOKEN'].includes(v.env_variable))continue;
  const existing=egg.variables.find(e=>e.env_variable===v.env_variable);if(!existing)egg.variables.push(structuredClone(v));
 }
 const set=(key,fields)=>Object.assign(egg.variables.find(v=>v.env_variable===key),fields);
 set('SRCDS_APPID',{default_value:app,rules:`required|string|in:${app}`});
 set('SRCDS_MAP',{default_value:map,rules:'required|string|max:128|regex:/^[A-Za-z0-9_\\/-]+$/'});
 if(game==='garrysmod'){
  set('STEAM_TOKEN',{rules:'nullable|required_if:environment.PUBLIC_SERVER,1|string|max:128|regex:/^[A-Za-z0-9]+$/'});
  set('GAMEMODE',{rules:'required|string|max:64|regex:/^[A-Za-z0-9_-]+$/'});
  set('WORKSHOP_ID',{rules:'nullable|string|max:20|regex:/^[1-9][0-9]*$/'});
  set('TICKRATE',{rules:'required|integer|between:1,100'});
  set('PUBLIC_SERVER',{description:'LAN is the default. Public Garrys Mod hosting requires your real Steam game server login token and reachable game ports.'});
 }else if(game==='bms'){
  egg.variables=egg.variables.filter(v=>!['HOSTNAME','SRCDS_MAP'].includes(v.env_variable));
  set('SERVER_NAME',{rules:'required|string|max:128|not_regex:/[\\x00-\\x1f\\x7f"\\\\;]/'});
  set('SERVER_PASSWORD',{rules:'nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f"\\\\;]/',description:'Empty or 0 allows joining without a password.'});
  set('MMS_BUILD',{default_value:'1155'});set('SM_BUILD',{default_value:'7163'});
  for(const [key,name,value,rules,description]of [
   ['VOLTRA_SOURCE_RECIPE','Source profile','sourcecoop','required|string|in:sourcecoop','Fixed SourceCoop adapter.'],
   ['SM_SERIES','SourceMod release series','auto','required|string|in:auto,1.11,1.12','Auto chooses 1.11 for original legacy builds and 1.12 for builds 7000 or later.'],
   ...['MMS_SHA256','SM_SHA256','SOURCECOOP_SHA256'].map(k=>[k,k,'','nullable|string|regex:/^[a-f0-9]{64}$/','Optional expected SHA256 for a custom upstream build. Reviewed defaults and original legacy builds are pinned automatically.'])
  ])egg.variables.push({env_variable:key,name,default_value:value,rules,description,user_viewable:key!=='VOLTRA_SOURCE_RECIPE',user_editable:key!=='VOLTRA_SOURCE_RECIPE',field_type:'text'});
 }else if(game==='open_fortress'){
  egg.variables=egg.variables.filter(v=>v.env_variable!=='MAX_PLAYERS');
  set('MAXPLAYERS',{rules:'required|integer|between:1,32'});
  set('SRCDS_BETAID',{default_value:'previous2021',rules:'required|string|in:previous2021',description:'The official alpha requires the publisher previous2021 SDK branch. TF2 mounted content stays on public.'});
 }else if(game==='contagion'){
  egg.variables=egg.variables.filter(v=>!['SRCDS_MAP','MAX_PLAYERS','SOURCE_TV'].includes(v.env_variable));
  set('SRV_MAP',{rules:'required|string|max:128|regex:/^[A-Za-z0-9_\\/-]+$/'});
  set('SRV_MAXPLAYERS',{rules:'required|integer|between:1,32'});
  set('SRV_CONFIG',{rules:'required|string|max:128|regex:/^[A-Za-z0-9_\\/-]+\\.cfg$/'});
  set('WINDOWS_INSTALL',{default_value:'1',rules:'required|boolean',name:'Windows package',description:'The original Windows32 package with the pinned Wine image is the supported default. Current publisher Linux build21184730 lacks dedicated.so and cannot start.',user_viewable:true,user_editable:true});
  set('WINEARCH',{rules:'required|string|in:win32,win64'});set('WINEDEBUG',{rules:'nullable|string|max:256|regex:/^[A-Za-z0-9_+,-]*$/'});
  set('WINEPATH',{rules:'required|string|max:1024|not_regex:/[\\x00-\\x1f\\x7f]/'});
  set('WINETRICKS_RUN',{rules:'nullable|string|max:128|regex:/^(vcrun2013|vcrun2015|corefonts)( (vcrun2013|vcrun2015|corefonts))*$/'});
  egg.docker_images={'Recommended WineHQ stable for Windows32':'ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8','Unavailable current publisher Linux package':Object.values(egg.docker_images)[0]};
 }
 let script=base.egg.scripts.installation.script;
 const extra=fs.readFileSync('internal/panel/game_library/scripts/source-next-runtime.py','utf8');
 let additions=`cat > .voltra/source_next_runtime.py <<'VOLTRA_SOURCE'\n${extra}\nVOLTRA_SOURCE\n`;
 additions+=`cat > .voltra/source_l4d.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/source-l4d.py','utf8')}\nVOLTRA_SOURCE\n`;
 if(game==='bms'||game==='open_fortress')additions+=`cat > .voltra/source_next_install.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/source-next-install.py','utf8')}\nVOLTRA_SOURCE\n`;
 if(game==='open_fortress')additions+=`cat > .voltra/source_openfortress_install.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/source-openfortress-install.py','utf8')}\nVOLTRA_SOURCE\n`;
 if(game==='contagion')additions+=`cat > .voltra/source_wine_runtime.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/source-wine-runtime.py','utf8')}\nVOLTRA_SOURCE\n`;
 if(game==='contagion')for(const [source,target]of [['source-wine-build.py','source_wine_build.py'],['source-wine-console.c','source_wine_console.c']])additions+=`cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SOURCE\n`;
 script=script.replace('python3 .voltra/bundle_debian_python.py\n',()=>additions+'python3 .voltra/bundle_debian_python.py\n');
 script=script.replace('update(Path.cwd(),232330,',`update(Path.cwd(),${app},`);
 if(game==='garrysmod')script+=`PYTHONPATH=.voltra python3 - <<'VOLTRA_DEFAULTS'\nfrom pathlib import Path\nroot=Path.cwd().resolve()\ntarget=root/'${game}/lua/autorun/server/workshop.lua'\nif not target.resolve().is_relative_to(root): raise ValueError('Workshop configuration escapes server volume')\nif not target.exists():\n target.parent.mkdir(parents=True,exist_ok=True)\n target.write_text('-- Optional client resources: resource.AddWorkshop("individual addon ID")\\n',encoding='utf-8')\nVOLTRA_DEFAULTS\n`;
 else if(game==='bms')script=script.replace("from source_install import update\nupdate(Path.cwd(),346680,required=('srcds_run',))","from source_next_install import install\nimport os\ninstall(Path.cwd(),dict(os.environ))");
 else if(game==='open_fortress'){
  script=script.replace('lib32stdc++6\n','lib32stdc++6 p7zip-full\n');
  script=script.replace("from source_install import update\nupdate(Path.cwd(),244310,required=('srcds_run',))","from source_openfortress_install import install,provision_tool\nimport os\nroot=Path.cwd().resolve()\nprovision_tool(root)\ninstall(root,dict(os.environ))");
 }else if(game==='contagion')script=script.replace("update(Path.cwd(),293030,required=('srcds_run',))","import os\nwindows=os.environ.get('WINDOWS_INSTALL','0')\nif windows not in ('0','1'): raise ValueError('Choose a supported target platform')\nupdate(Path.cwd(),293030,platform='windows' if windows=='1' else 'linux',required=('contagionds.exe' if windows=='1' else 'contagion_dedicated',))\nif windows=='1':\n from source_wine_build import ensure\n ensure(Path.cwd())");
 egg.scripts.installation={...base.egg.scripts.installation,script};
 for(const v of originalVariables)if(!egg.variables.some(e=>e.env_variable===v.env_variable))throw Error('Lost original control '+v.env_variable);
 profiles[recipe]={...base,upstream_sha256:original.sha256,revision:'source-additional-v1',defaults:{memory:4096,disk},egg,verification:current[recipe]?.verification||'not_verified',detail:current[recipe]?.detail||'Typed Source setup implemented; native acceptance pending.',setup_steps:[
  'Choose a Linux x64 node with three free ports. The primary port serves game/query and RCON; client and SourceTV use the additional allocations.',
  'LAN hosting works without Steam credentials. Internet mode requires a real game server login token. No account or protected beta credential is accepted until the shared Steam parser supports it safely.',
  'Choose an installed gamemode and map. Optional Workshop collection IDs use the native publisher downloader; clients still need the matching addons. Tick rate and Lua refresh retain their original controls.',
  'Keep custom settings in garrysmod/cfg/server.cfg, Lua modules in garrysmod/lua or addons, and plugin state in garrysmod/data. Back these up before updates. Existing native configuration survives Steam validation, including failures.',
  'Console input and Stop reach the native dedicated process. Player joining, Workshop entitlement and public listing require separate client/network verification.'
 ]};
 if(game==='bms')profiles[recipe].setup_steps=[
  'Choose a Linux x64 node with three free ports. SourceCoop installs Black Mesa plus Metamod, SourceMod and the server-only co-op plugin; clients use Black Mesa.',
  'The reviewed current plugin is v1.6 with Metamod 1.11 build 1155 and SourceMod 1.12 build 7163. Keep original build controls for legacy or custom versions. Custom builds use bounded trusted upstream URLs and record their computed digest; optional SHA256 controls add an expected-checksum check.',
  'Keep your native settings in bms/cfg/server.cfg. Co-op defaults load first, then your settings, then only the setup form controls. Password 0 or empty means no password. Friendly fire, map, capacity and data pre-caching retain their original controls.',
  'Plugin configurations, custom addons and SourceCoop savedata retain existing contents and permissions during reinstall. Unmodified managed plugin binaries can update; operator-modified files are preserved. Back up bms/cfg and bms/addons before changing plugin versions.',
  'Automatic updates check the Black Mesa publisher only, matching the original recipe. Reinstall to change the co-op plugin or Metamod/SourceMod builds. Native readiness, plugin loading, persistence and Stop still require acceptance.'
 ];
 if(game==='open_fortress')profiles[recipe].setup_steps=[
  'Choose a Linux x64 node with three allocated ports and at least 48 GiB disk for the SDK, independent TF2 mounted content, Open Fortress alpha and update staging.',
  'The official alpha is checksum pinned. It uses the SDK previous2021 branch recommended by the project; TF2 content installs under tf2 on public. This is the original alpha mod, not the separate unreleased Steam game.',
  'Keep custom settings in open_fortress/cfg/server.cfg. The original map, game directory and MAXPLAYERS controls remain available. Existing configuration, custom content and operator-modified managed files survive reinstall.',
  'The installer safely adds missing relative native-library aliases and patches only the first installed gameinfo mount paths. Keep gameinfo.txt unchanged unless you intend to customize the TF2 mount.',
  'Readiness requires an actual native query matching map, name and password flag. Back up open_fortress and tf2 configuration before updating; player gameplay and third-party plugin support need separate acceptance.'
 ];
 if(game==='contagion')profiles[recipe].setup_steps=[
  'Choose a Linux x64 node and three allocated ports. The default preserves the original Windows32 package on the recommended pinned WineHQ image. Current publisher Linux build21184730 is missing its engine libraries and cannot start.',
  'The original SRV_MAP, SRV_MAXPLAYERS and SRV_CONFIG controls remain available. Use a relative CFG filename; managed voltra-* files are reserved. Operator CFG files survive Steam validation and failed updates.',
  'Windows mode retains the original Wine prefix architecture, debug, library path and Visual C++/font components. The pinned Wine host supplies its existing Winetricks setup. Keep the prefix intact across restarts.',
  'Windows console commands and Stop use this exact dedicated process native Windows console, with no RCON requirement. Optional user RCON settings retain their original network behavior. No new internal password or listener is created.',
  'Readiness verifies the current native map, configuration and Steam initialization; with RCON configured it also authenticates and checks name, map, capacity and password. Public A2S queries were unavailable in LAN acceptance; no spectator, player gameplay or public listing support is claimed. No Steam account or protected beta credential is accepted until the shared Steam parser supports it safely.'
 ];
}
fs.writeFileSync(dir+'/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged '+Object.keys(profiles).length+' additional Source profiles.');
