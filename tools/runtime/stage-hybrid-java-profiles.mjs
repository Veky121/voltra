import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const reviewed=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const pins=JSON.parse(fs.readFileSync('internal/panel/game_library/scripts/hybrid-java-releases.json'));
const profiles={};
for(const project of ['arclight','canvas','spongevanilla']){
 const folder=project==='canvas'?'canvas-mc':project;
 const path=`minecraft/java/${folder}/egg-${project==='spongevanilla'?'sponge-vanilla':folder}.json`;
 const entry=catalog.entries.find(x=>x.path===path);if(!entry)throw Error('Exact catalog recipe missing '+path);
 const egg=structuredClone(entry.egg),pin=project==='arclight'?pins.arclight_beta:pins[project],major=pin.java;
 egg.features=[...new Set([...(egg.features||[]),'minecraft'])];
 egg.docker_images={[`Java ${major} (default)`]:`ghcr.io/pterodactyl/yolks:java_${major}`,...egg.docker_images};
 egg.voltra={java_config:{enabled:true,required_major:project==='canvas'?21:8,default_major:major,memory_mode:'command',jvm_args:'-Dterminal.jline=false -Dterminal.ansi=false'+(project==='canvas'?' --add-modules=jdk.incubator.vector':'')}};
 egg.startup=project==='canvas'?'java -Xms128M -jar server.jar --nogui':'java -Xms128M -jar "{{SERVER_JARFILE}}" nogui';
 for(const variable of egg.variables){
  if(variable.env_variable==='SERVER_JARFILE')variable.rules=project==='spongevanilla'?'required|regex:/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/|max:80':'required|regex:/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,74}\\.jar$/|max:80';
  if(variable.env_variable==='MINECRAFT_VERSION'||variable.env_variable==='MC_VERSION')variable.default_value=pin.version;
  if(variable.env_variable==='ARCLIGHT_CHANNEL'){variable.default_value='beta';variable.description='Recommended default is publisher beta/snapshot1.0.2-494b2c8, tested on Forge1.21.1. stable remains selectable but1.0.1 has a known first-boot core Mixin failure. auto preserves publisher stable preference; no silent fallback.';}
  if(variable.env_variable==='CANVAS_BUILD')variable.default_value=pin.build;
  if(variable.env_variable==='SV_VERSION')variable.default_value=pin.release;
 }
 const add=(env,value,description)=>{if(!egg.variables.some(v=>v.env_variable===env))egg.variables.push({name:env,env_variable:env,default_value:value,description,rules:'required|string|max:120',user_viewable:false,user_editable:false,field_type:'text'})};
 if(project==='canvas')add('MINECRAFT_LOADER','folia','Canvas is Folia-derived: only plugins explicitly supporting Folia region threading are compatible.');
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\ncd /mnt/server\nmkdir -p .voltra\n';
 for(const [source,target]of [['internal/panel/game_library/minecraft-install.py','minecraft_install.py'],['internal/panel/game_library/scripts/limbo-install.py','limbo_install.py'],['internal/panel/game_library/scripts/paper-family-install.py','paper_family_install.py'],['internal/panel/game_library/scripts/paper-family-releases.json','paper-family-releases.json'],['internal/panel/game_library/scripts/hybrid-java-install.py','hybrid_java_install.py'],['internal/panel/game_library/scripts/hybrid-java-releases.json','hybrid-java-releases.json']])script+=`cat > .voltra/${target} <<'VOLTRA_HYBRID_SOURCE'\n${fs.readFileSync(source,'utf8')}\nVOLTRA_HYBRID_SOURCE\n`;
 script+=`python3 .voltra/hybrid_java_install.py ${project} 2>&1 | tee .voltra/hybrid-java-install.log\n`;
 egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
 profiles[path]={upstream_sha256:entry.sha256,revision:project+'-managed-java-v1',platforms:['linux/amd64'],required_ports:1,defaults:{memory:4096,disk:10240},egg,verification:reviewed[path]?.verification||'not_verified',detail:reviewed[path]?.detail||'Original controls integrated with safe pinned Java assets and shared setup; native acceptance pending.',setup_steps:[
  `Pinned default ${project} ${pin.version} ${pin.release||('build '+pin.build)}, automatic Java${major}. Select the compatible Java runtime explicitly for older/custom releases.`,
  'All original version/build/channel/loader/custom-JAR controls remain available. Publisher failures and unsupported combinations fail clearly. Server-only content must match the actual selected loader/API.',
  'Installation preserves EULA, properties, worlds, plugins/mods, libraries and operator settings. Accept the Minecraft EULA through the existing operator flow before starting.',
  project==='arclight'?'Publisher snapshot/beta494b2c8 is the recommended tested default; stable1.0.1 remains selectable with known first-boot Mixin failure. Bukkit World PersistentDataContainer persistence is unsupported in this tested beta. Back up worlds before changing loader/version; NeoForge/Fabric interoperability is not claimed by the Forge/Bukkit acceptance.':project==='spongevanilla'?'Sponge plugins use the Sponge API. The pinned release discovers mods/ and the additional path configured in config/sponge/launch.properties (default mods/plugins), not root plugins/. Bukkit/Paper plugins and Forge mods are not interchangeable. No Bukkit compatibility is claimed.':'Use the existing exact Folia-compatible plugin tools; ordinary Paper/Bukkit plugins are incompatible. Canvas requires the Java vector module, included in managed JVM arguments.',
 ]};
}
fs.mkdirSync('.local/hybrid-java',{recursive:true});fs.writeFileSync('.local/hybrid-java/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Staged Arclight, Canvas and SpongeVanilla with original controls and shared Java setup.');
