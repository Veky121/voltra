import fs from 'node:fs';
import {ensureRuntimeUpdateControl} from './runtime-update-control.mjs';
import crypto from 'node:crypto';
const base='internal/panel/game_library/scripts/';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const games={aloft:'aloft/egg-aloft.json',astro:'astro_colony/egg-astro-colony.json',aska:'Aska/egg-aska.json'};
const release={},profiles={};
for(const [game,path] of Object.entries(games)){
 const entry=catalog.entries.find(e=>e.path===path),egg=structuredClone(entry.egg);ensureRuntimeUpdateControl(egg);
 const defaults=Object.fromEntries(egg.variables.map(v=>[v.env_variable,String(v.default_value)]));
 const info={app:Number(defaults.SRCDS_APPID),platform:game==='astro'?'linux':'windows',defaults,binary:game==='astro'?'AstroColony/Binaries/Linux/AstroColonyServer':game==='aloft'?'Aloft.exe':'AskaServer.exe',ready:JSON.parse(egg.config.startup).done,types:{}};
 for(const v of egg.variables){if(/boolean/.test(v.rules))info.types[v.env_variable]='boolean';else if(/numeric|integer/.test(v.rules))info.types[v.env_variable]='number';}
 if(game==='aloft'){
  info.defaults.WORLD_GENERATION_SYNTAX='legacy';info.defaults.ISLAND_PRESET='normal';info.defaults.CORRUPTION_PRESET='normal';
  for(const [key,name,value,rules,description] of [
   ['WORLD_GENERATION_SYNTAX','World creation syntax','legacy','required|in:legacy,current','Legacy retains original NUM_ISLANDS integer and combined create token. Current uses documented independent world preset tokens. Only affects a missing world.'],
   ['ISLAND_PRESET','Current island preset','normal','required|in:0,1,2,normal,big,huge','Only used by current creation syntax. Original NUM_ISLANDS remains effective in legacy mode.'],
   ['CORRUPTION_PRESET','Current corruption preset','normal','required|in:0,1,2,normal,lots,shrooms','Only used by current creation syntax.'],
  ])egg.variables.push({env_variable:key,name,default_value:value,rules,description,user_viewable:true,user_editable:true,field_type:'text'});
  info.preserve=[defaults.SAVE_PATH,'ServerRoomCode*','*.log'];
 }else{
  const files=JSON.parse(egg.config.files);
  if(game==='astro'){
   info.ini={};for(const file of Object.values(files))for(const [key,value] of Object.entries(file.find)){
    const match=key.match(/^\[([^\]]+)\]\.(.+)$/),env=value.match(/env\.([A-Z_]+)/)[1];
    (info.ini[match[1]]??={})[match[2]]=env;
   }
   info.preserve=['AstroColony/Saved'];
   const variable=egg.variables.find(v=>v.env_variable==='SERVER_QUERY_PORT');variable.default_value='';variable.user_editable=true;variable.rules='nullable|integer|between:1,65535';variable.description+=' Blank selects a distinct allocation.';
  }else{
   info.properties={};for(const file of Object.values(files))for(const [key,value] of Object.entries(file.find))info.properties[key.replace(/\s*=\s*$/,'')]=value.match(/env\.([A-Za-z_]+)/)[1];
   info.preserve=['server properties.txt','savegame_*'];
  }
 }
 release[game]=info;
 egg.features=[...new Set([...(egg.features??[]),'voltra_steam_template'])];
 egg.docker_images={'Pinned runtime':'ghcr.io/ptero-eggs/'+(game==='astro'?'steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b':'yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8')};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/unreal_survival_next.py run ${game}`;
 egg.config={files:'{}',startup:JSON.stringify({done:info.ready}),logs:'{}',stop:'^C'};
 profiles[path]={upstream_sha256:entry.sha256,revision:'unreal-survival-next-v1',platforms:['linux/amd64'],required_ports:game==='astro'?2:1,defaults:{memory:6144,disk:32768},verification:'not_verified',detail:'Source implementation and isolated fixtures only; native install, server readiness, save/restart and peer gameplay remain unverified.',...(game==='astro'?{port_rules:[{environment:'SERVER_QUERY_PORT',condition:'nonzero',allocated_value:true,auto_allocate:true,exclude_primary:true,minimum:1,maximum:65535,count:2}]}:{}),egg,setup_steps:[
  'All imported variables remain available with their original names/defaults unless the explicit notes below describe a correction. Uses shared React setup metadata, typed Steam acquisition, literal native arguments and operator-file retention.',
  game==='aloft'?'Aloft app1660080 is the game client with a built-in dedicated mode, not an anonymous dedicated tool. Official wiki requires an owning Steam account/client. Current secure account transport is unavailable and fails closed; no anonymous-success claim. Operator-provided legitimately acquired files still need native Steam/session acceptance. Original Wine prefix/save path, debug/DLL overrides and literal Winetricks verbs are retained. Original old create syntax remains selectable/default legacy; current publisher presets are explicit alternatives. Existing world is loaded without generation.':'',
  game==='astro'?'Original Linux app2934900 and all11 ServerSettings.ini fields remain, including game password, admins, map seed/name, gameplay flags, load-latest and autosave controls. Actual primary allocation is now explicitly passed with -Port instead of silently binding the Unreal default7777. Query port blank now selects the second allocation. Comments/unknown INI fields and saves remain.':game==='aska'?'Original Windows app3246670, SteamAppId1898300 and all6 server properties remain. Supply an operator-owned GSLT created for game1898300; blank token explicitly blocks startup. Token/password are stored in private mode0600 properties, not appended to argv. Unknown properties/save ID remain. No token is generated or fabricated.':'',
  'Stock pinned Wine runtime is used for Windows titles with a volume-local .wine prefix. Original ASKA propertiesPath filename is preserved. Ctrl-C uses a real PTY ETX, not printable characters. Saving/shutdown behavior still requires native acceptance.',
  'Private Steam username/password/Guard and password-protected beta acquisition remain unsupported and fail closed. No experimental credential transport is enabled. Public shared libraries/bootstrap are acquired by the shared reviewed helper.',
 ].filter(Boolean)};
}
fs.writeFileSync(base+'unreal-survival-next-release.json',JSON.stringify(release,null,2)+'\n');
const sources=['steam-template.py','native-config.py','native-console.py','bundle-debian-python.py','unreal-survival-next.py','unreal-survival-next-release.json'];
for(const [game,path] of Object.entries(games)){
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 for(const source of sources)script+=`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_UNREAL_NEXT'\n${fs.readFileSync(base+source,'utf8')}\nVOLTRA_UNREAL_NEXT\n`;
 script+=`python3 .voltra/bundle_debian_python.py\npython3 .voltra/unreal_survival_next.py install ${game}\n`;
 profiles[path].egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
}
const output='.local/unreal-survival-next';fs.mkdirSync(output+'/sources',{recursive:true});const manifest={};
for(const source of sources){const bytes=fs.readFileSync(base+source);fs.writeFileSync(output+'/sources/'+source,bytes);manifest[source]=crypto.createHash('sha256').update(bytes).digest('hex');}
fs.writeFileSync(output+'/profiles.json',JSON.stringify(profiles,null,2)+'\n');fs.writeFileSync(output+'/source-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log('Staged Aloft, Astro Colony and ASKA; canonical overrides untouched.');
