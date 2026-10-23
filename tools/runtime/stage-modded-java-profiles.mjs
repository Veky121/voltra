import fs from'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),reviewed=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),pins=JSON.parse(fs.readFileSync('internal/panel/game_library/scripts/modded-java-releases.json')),profiles={};
for(const loader of['fabric','forge','neoforge','quilt','spigot']){
 const path='minecraft/java/'+loader+'/egg-'+(loader==='forge'?'forge-enhanced':loader)+'.json',entry=catalog.entries.find(x=>x.path===path);if(!entry)throw Error('Exact catalog recipe missing');
 const egg=structuredClone(entry.egg),pin=pins[loader],argfile=loader==='forge'||loader==='neoforge';
 egg.features=[...new Set([...(egg.features||[]),'minecraft'])];
 egg.docker_images={'Java 25 (default)':'ghcr.io/pterodactyl/yolks:java_25',...egg.docker_images};
 egg.voltra={java_config:{enabled:true,required_major:loader==='quilt'||loader==='neoforge'?17:8,default_major:25,memory_mode:argfile?'argfile':'command',...(argfile?{args_file:'user_jvm_args.txt'}:{}),jvm_args:'-Dterminal.jline=false -Dterminal.ansi=false'}};
 if(loader==='forge')egg.voltra.java_config.legacy_startup='java -jar "{{SERVER_JARFILE}}" nogui';
 egg.startup=argfile?'java @unix_args.txt nogui':'java -Xms128M -jar "{{SERVER_JARFILE}}" nogui';
 for(const variable of egg.variables){
  if(variable.env_variable==='MC_VERSION'||variable.env_variable==='DL_VERSION')Object.assign(variable,{default_value:pin.version,description:variable.description+' The reviewed default is pinned; select a Java runtime compatible with historical/custom versions.'});
  if(variable.env_variable==='FABRIC_VERSION')variable.default_value=pin.installer_version;
  if(variable.env_variable==='LOADER_VERSION')variable.default_value=pin.loader_version;
  if(variable.env_variable==='SERVER_JARFILE')variable.rules='required|regex:/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,74}\\.jar$/|max:80';
  if(variable.env_variable==='DL_PATH')variable.description='Optional administrator-provided public HTTPS Spigot jar. {{DL_VERSION}} and ${DL_VERSION} are substituted as URL data, never shell evaluated. Empty builds official Spigot sources locally using pinned BuildTools.';
 }
 const add=(env,name,value,rules,visible=false,description='')=>{if(!egg.variables.some(x=>x.env_variable===env))egg.variables.push({name,env_variable:env,default_value:value,rules,user_viewable:visible,user_editable:visible,description,field_type:'text'})};
 add('MINECRAFT_LOADER','Minecraft content compatibility',loader,'required|in:'+loader,false,'Exact loader compatibility for the existing content browser. Original version fields remain authoritative.');
 if(loader==='quilt'){add('LOADER_VERSION','Quilt loader version',pin.loader_version,'required|string|max:64',true,'Exact Quilt loader, or latest stable.');add('QUILT_INSTALLER_VERSION','Quilt installer version',pin.installer_version,'required|string|max:64',false,'Exact official Quilt installer version, or latest.');}
 if(loader==='spigot')add('DOWNLOAD_SHA256','Custom download SHA256','','nullable|regex:/^[0-9a-fA-F]{64}$/',false,'Optional strong checksum for an administrator custom download. Official BuildTools defaults are pinned.');
 const sources=[['internal/panel/game_library/minecraft-install.py','minecraft_install.py'],['internal/panel/game_library/scripts/limbo-install.py','limbo_install.py'],['internal/panel/game_library/scripts/modded-java-install.py','modded_java_install.py'],['internal/panel/game_library/scripts/modded-java-releases.json','modded-java-releases.json'],...(loader==='spigot'?[['internal/panel/game_library/scripts/spigot-build-install.py','spigot_build_install.py']]:[])];
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates'+(loader==='spigot'?' git curl':'')+'\ncd /mnt/server\nmkdir -p .voltra\n';
 for(const[source,target]of sources)script+=`cat > .voltra/${target} <<'VOLTRA_MODDED_SOURCE'\n${fs.readFileSync(source,'utf8')}\nVOLTRA_MODDED_SOURCE\n`;
 script+=loader==='spigot'?'python3 .voltra/spigot_build_install.py 2>&1 | tee .voltra/spigot-build-install.log\n':'python3 .voltra/modded_java_install.py '+loader+' 2>&1 | tee .voltra/modded-java-install.log\n';
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
 profiles[path]={upstream_sha256:entry.sha256,revision:loader+'-managed-minecraft-v1',platforms:['linux/amd64'],required_ports:1,defaults:{memory:4096,disk:loader==='spigot'?16384:10240},egg,verification:reviewed[path]?.verification||'not_verified',detail:reviewed[path]?.detail||'Original recipe controls integrated with verified Minecraft installer and shared Java/content setup; native acceptance pending.',setup_steps:[
  `Default Minecraft ${pin.version}, ${loader==='spigot'?'official BuildTools201 local source build':loader+' '+pin.loader_version}, managed Java25. Explicit original version controls and compatible historical Java runtimes remain available.`,
  'Accept the Minecraft EULA through the existing operator flow. Installation never accepts it, and retains properties, worlds, mods/plugins and operator JVM arguments.',
  loader==='spigot'?'Official BuildTools compiles Spigot locally using Git and Java; no server JAR is redistributed. Verified local program/source cache speeds same-release reinstall. Administrator custom download URL remains available.':'Use the existing server-compatible mod browser or upload compatible mods/. Client-only content remains excluded. Verified same-plan program cache is reused only after hashing every retained program file.',
  'Back up worlds and mods/plugins before changing Minecraft or loader versions. Native protocol, mod/plugin load, persistence and cleanup are verified separately from source fixtures.',
 ]};
}
fs.mkdirSync('.local/modded-java',{recursive:true});fs.writeFileSync('.local/modded-java/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged five original Minecraft recipes with shared Java/content controls.');
