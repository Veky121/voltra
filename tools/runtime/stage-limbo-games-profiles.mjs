import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const reviewed=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profiles={};
for(const [kind,path]of [['limbo','minecraft/java/limbo/egg-limbo.json'],['nano-limbo','minecraft/java/nanolimbo/egg-nano-limbo.json']]){
 const entry=catalog.entries.find(x=>x.path===path);if(!entry)throw Error('Missing '+path);
 const egg=structuredClone(entry.egg);
 egg.features=[...new Set([...(egg.features||[]),'java_version'])];
 egg.docker_images={'Java 21 (reviewed default)':'ghcr.io/pterodactyl/yolks:java_21',...egg.docker_images};
 egg.voltra={java_config:{enabled:true,required_major:21,memory_mode:'command',jvm_args:'-Dterminal.jline=false -Dterminal.ansi=false'}};
 egg.startup='java -Xms128M -jar "{{SERVER_JARFILE}}"';
 if(kind==='nano-limbo'){
  egg.description='A lightweight Minecraft limbo server for holding players while a main server is unavailable. Configure messages, player list, boss bar and connection behavior in settings.yml. Native console commands include help, conn, mem, version and stop.';
  egg.config.stop='stop';
 }
 for(const variable of egg.variables){
  if(variable.env_variable==='SERVER_JARFILE')variable.rules='required|regex:/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,120}\\.jar$/';
  if(variable.env_variable==='VERSION')variable.description='latest selects the reviewed immutable v1.13.0 release. An explicit official GitHub tag is also supported; unknown versions fail clearly.';
  if(variable.env_variable==='DOWNLOAD_URL')variable.description='Optional executable jar at a public HTTPS URL. Supply its SHA-256 below when available. Existing settings.yml is preserved.';
 }
 if(kind==='nano-limbo')egg.variables.push({name:'Custom download SHA-256',description:'Optional 64-digit SHA-256 for a custom Download URL. Official reviewed v1.13.0 is always checksum verified.',env_variable:'DOWNLOAD_SHA256',default_value:'',rules:'nullable|regex:/^[0-9a-fA-F]{64}$/',user_viewable:true,user_editable:true,field_type:'text'});
 const source=fs.readFileSync('internal/panel/game_library/scripts/limbo-install.py','utf8');
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script:'#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\ncd /mnt/server\nmkdir -p .voltra\ncat > .voltra/limbo-install.py <<\'VOLTRA_LIMBO_SOURCE\'\n'+source+'\nVOLTRA_LIMBO_SOURCE\npython3 .voltra/limbo-install.py '+kind+'\n'};
 profiles[path]={upstream_sha256:entry.sha256,revision:kind+'-managed-java-v1',platforms:['linux/amd64'],required_ports:1,defaults:{memory:1024,disk:2048},egg,verification:reviewed[path]?.verification||'not_verified',detail:reviewed[path]?.detail||'Standalone limbo setup uses existing managed Java controls; native acceptance pending.',setup_steps:[
  'Choose one TCP gameplay port. Current reviewed releases require Java21; the shared Java controls manage runtime, heap and JVM options.',
  kind==='limbo'?'The default is immutable official Limbo CI build76 (2026.0.3-ALPHA), pinned by SHA-256. Edit server.properties, whitelist, permissions, plugins and schematic files through Files.':'The default is official NanoLimbo v1.13.0 with its publisher SHA-256. Original version, custom HTTPS download and jar filename controls remain available.',
  kind==='limbo'?'The allocated bind address/port use the original properties parser. Native console commands include stop.':'The allocated bind address/port use the original YAML parser. Current NanoLimbo has native help, conn, mem, version and stop commands; Stop exits normally through its shutdown hook.',
  'Reinstall replaces the selected executable jar and preserves existing native configuration byte-for-byte, including owner and mode. Keep operator files backed up.',
 ]};
}
fs.mkdirSync('.local/limbo-games',{recursive:true});fs.writeFileSync('.local/limbo-games/profiles.json',JSON.stringify(profiles,null,2)+'\n');
console.log('Staged Limbo and NanoLimbo profiles with existing managed Java settings.');
