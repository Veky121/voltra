import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const reviewed=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const releases=JSON.parse(fs.readFileSync('internal/panel/game_library/scripts/paper-family-releases.json'));
const profiles={};
for(const project of ['paper','folia','purpur']){
 const path=`minecraft/java/${project}/egg-${project}.json`,entry=catalog.entries.find(x=>x.path===path);if(!entry)throw Error('Missing '+path);
 const egg=structuredClone(entry.egg),release=releases[project];
 egg.features=[...new Set([...(egg.features||[]),'minecraft'])];
 egg.docker_images={'Java 25 (default)':'ghcr.io/pterodactyl/yolks:java_25',...egg.docker_images};
 egg.voltra={java_config:{enabled:true,required_major:8,default_major:25,memory_mode:'command',jvm_args:'-Dterminal.jline=false -Dterminal.ansi=false'+(project==='purpur'?' --add-modules=jdk.incubator.vector':'')}};
 egg.startup='java -Xms128M -jar "{{SERVER_JARFILE}}" --nogui';
 for(const variable of egg.variables){
  if(variable.env_variable==='MINECRAFT_VERSION')Object.assign(variable,{default_value:release.version,description:'Minecraft version. The default is pinned to the current stable release. latest selects that reviewed default; explicit supported versions remain available. Choose a compatible Java runtime for older versions.'});
  if(variable.env_variable==='BUILD_NUMBER')Object.assign(variable,{default_value:release.build,description:'Exact official build number. latest uses the pinned build for the default version, or the newest stable published build for another explicit version. Invalid builds fail clearly.'});
  if(variable.env_variable==='SERVER_JARFILE')variable.rules='required|regex:/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,74}\\.jar$/|max:80';
  if(variable.env_variable==='DL_PATH')variable.description='Optional public HTTPS executable jar URL. {{PROJECT}}, {{MINECRAFT_VERSION}}, {{BUILD_NUMBER}} and {{SERVER_JARFILE}} placeholders are supported without shell evaluation. Supply a custom SHA-256 when available.';
 }
 if(!egg.variables.some(v=>v.env_variable==='DL_PATH'))egg.variables.push({name:'Download Path',description:'Optional public HTTPS server jar URL. Supports project/version/build/jar placeholders without shell evaluation.',env_variable:'DL_PATH',default_value:'',user_viewable:false,user_editable:false,rules:'nullable|string',field_type:'text'});
 egg.variables.push({name:'Custom download SHA-256',description:'Optional 64-digit SHA-256 for a custom Download Path. Official default builds are always verified.',env_variable:'DOWNLOAD_SHA256',default_value:'',user_viewable:false,user_editable:false,rules:'nullable|regex:/^[0-9a-fA-F]{64}$/',field_type:'text'});
 egg.variables.push({name:'Minecraft plugin compatibility',description:project==='folia'?'Folia-compatible plugins only. Ordinary Paper plugins may not support region scheduling.':'Paper-compatible plugin catalog.',env_variable:'MINECRAFT_LOADER',default_value:project==='folia'?'folia':'paper',user_viewable:false,user_editable:false,rules:'required|in:'+(project==='folia'?'folia':'paper'),field_type:'text'});
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\ncd /mnt/server\nmkdir -p .voltra\n';
 for(const [source,target]of [['internal/panel/game_library/minecraft-install.py','minecraft_install.py'],['internal/panel/game_library/scripts/limbo-install.py','limbo_install.py'],['internal/panel/game_library/scripts/paper-family-install.py','paper_family_install.py'],['internal/panel/game_library/scripts/paper-family-releases.json','paper-family-releases.json']])script+=`cat > .voltra/${target} <<'VOLTRA_PAPER_SOURCE'\n${fs.readFileSync(source,'utf8')}\nVOLTRA_PAPER_SOURCE\n`;
 script+=`python3 .voltra/paper_family_install.py ${project}\n`;
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
 profiles[path]={upstream_sha256:entry.sha256,revision:project+'-managed-java-v1',platforms:['linux/amd64'],required_ports:1,defaults:{memory:4096,disk:8192},egg,verification:reviewed[path]?.verification||'not_verified',detail:reviewed[path]?.detail||'Managed Java/Minecraft setup implemented; native acceptance pending.',setup_steps:[
  `Default official build: ${project} ${release.version} build ${release.build}, verified by SHA-256. Existing Java controls choose Java25 automatically; explicitly choose an older compatible runtime for historical or custom jars.`,
  'Minecraft version, exact build, custom jar filename and administrator download URL remain supported. Custom URL placeholders are expanded as data, never evaluated as shell commands.',
  'Accept the Minecraft EULA through the existing console flow. Reinstall preserves EULA, properties, worlds, plugins and JVM files; it only replaces program files and public release metadata.',
  project==='folia'?'The default is the current stable 1.21.11 build; newer 26.3 builds are ALPHA and require Java25. Use only plugins explicitly supporting Folia region scheduling.':'Use the shared Minecraft setup and Paper-compatible plugin tools. Back up worlds/ and plugins/ before changing Minecraft versions.',
 ]};
}
fs.mkdirSync('.local/paper-family',{recursive:true});fs.writeFileSync('.local/paper-family/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged Paper, Folia and Purpur using shared managed Java/Minecraft controls.');
