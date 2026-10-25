import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Startup-only repair must not refresh installer embeddings or recipe metadata.
export function stageVanillaPublisherStartup(current) {
  const key='terraria/vanilla/egg-terraria-vanilla.json';
  if(!current[key]?.egg)throw Error('Reviewed vanilla recipe missing');
  const profile=structuredClone(current[key]);
  profile.egg.startup='exec /bin/bash /home/container/TerrariaServer -config serverconfig.txt -noupnp';
  return {[key]:profile};
}

export function stageTerrariaProfiles(current, helper, tshockRuntime=fs.readFileSync('internal/panel/game_library/scripts/tshock-runtime.py','utf8'), onlyPaths=null, tmodloaderRuntime=fs.readFileSync('internal/panel/game_library/scripts/tmodloader-runtime.py','utf8')) {
  const profiles={};
  const suffix='-exact-release-v1';
  const steps=['Select an exact compatible release in Startup before reinstalling. Unsupported runtime families fail explicitly. Back up worlds and mod data before changing versions.','Older Terraria or TShock versions may refuse newer worlds. Use a separate world or restore a version-matched backup; the installer preserves existing worlds.','Release receipts distinguish reviewed/publisher checksum assurance from publisher HTTPS. New selectable releases have offline adapter coverage; native runtime verification applies only to the previously recorded pinned release.'];
  const detail=' Exact official release selection adapter added with offline fixture coverage only; existing native acceptance does not cover other versions.';
  const entries=[['terraria/vanilla/egg-terraria-vanilla.json','vanilla','TERRARIA_VERSION'],['terraria/tshock/egg-tshock.json','tshock','TSHOCK_VERSION'],['terraria/tshock/egg-tshock-legacy.json','legacy','TSHOCK_VERSION'],['terraria/tmodloader/egg-t-modloader.json','tmodloader','VERSION']];
  for(const [key,kind,variable] of entries){
    if(onlyPaths&&!onlyPaths.includes(key))continue;
    if(!current[key]?.egg)throw Error('Reviewed base recipe missing: '+key);
    const profile=structuredClone(current[key]),egg=profile.egg;
    profile.revision=profile.revision.replace(/(?:-exact-release-v1)+$/,'')+suffix;
    const selected=egg.variables.find(v=>v.env_variable===variable);if(!selected)throw Error('Original version variable missing');
    selected.rules='required|string|max:20|regex:/\\A'+(kind==='vanilla'?'(latest|v?(1[0-9]{3,5}|1\\.[0-9]\\.[0-9]\\.[0-9]{1,3}))':'(latest|v?[0-9]+(\\.[0-9]+){1,3})')+'\\z/';
    selected.description=kind==='vanilla'?'Exact PC Terraria release, for example 1.4.4.9 or 1449, or latest resolved from the official publisher API. The reviewed default stays unchanged.':kind==='legacy'?'Exact stable TShock 4.x Mono release. Modern .NET releases require the separate modern recipe.':kind==='tshock'?'Exact stable TShock 6.x/.NET9 release or latest; 6.2.1 stays default. TShock5.x uses isolated .NET6.0.36 automatically for legacy compatibility. .NET6 upstream support ended2024-11-12; legacy is not recommended. Matching game/client/world versions are required.':'Exact stable tModLoader release or latest on Linux x64. Supports publisher .NET8/.NET6 releases and 0.11 dedicated MonoKickstart releases. Clients, enabled mods and worlds must match the selected game branch.';
    egg.variables=egg.variables.filter(v=>!['RELEASE_SHA256','VOLTRA_TERRARIA_KIND'].includes(v.env_variable));
    egg.variables.push({name:'Release SHA256 (optional)',env_variable:'RELEASE_SHA256',default_value:'',user_viewable:true,user_editable:true,rules:'nullable|string|regex:/\\A[0-9a-f]{64}\\z/',field_type:'text',description:'Optional independently obtained archive SHA256. Reviewed and publisher hashes are preferred. If absent and no published hash exists, assurance is official publisher HTTPS; a local digest records integrity only.'});
    egg.variables.push({name:'Terraria recipe identity',env_variable:'VOLTRA_TERRARIA_KIND',default_value:kind,user_viewable:false,user_editable:false,rules:'required|string|in:'+kind,field_type:'text',description:'Fixed original recipe and runtime family.'});
    const runtimeEmbed=(['tshock','tmodloader'].includes(kind)?`test ! -L .voltra/tshock_runtime.py\ncat > .voltra/tshock_runtime.py <<'VOLTRA_TSHOCK_RUNTIME'\n${tshockRuntime}\nVOLTRA_TSHOCK_RUNTIME\n`:'')+(kind==='tmodloader'?`test ! -L .voltra/tmodloader_runtime.py\ncat > .voltra/tmodloader_runtime.py <<'VOLTRA_TMODLOADER_RUNTIME'\n${tmodloaderRuntime}\nVOLTRA_TMODLOADER_RUNTIME\n`:'');
    if(kind==='vanilla')egg.startup='exec /bin/bash /home/container/TerrariaServer -config serverconfig.txt -noupnp';
    if(kind==='tshock')egg.startup='exec python3 .voltra/tshock_runtime.py';
    if(kind==='tmodloader')egg.startup='exec python3 .voltra/tmodloader_runtime.py';
    egg.scripts.installation={container:'alpine:3.22',entrypoint:'ash',script:`#!/bin/ash\nset -eu\napk add --no-cache python3 ca-certificates\ncd /mnt/server\ntest ! -L .voltra\nmkdir -p .voltra\ntest ! -L .voltra/terraria_release_install.py\ncat > .voltra/terraria_release_install.py <<'VOLTRA_TERRARIA_RELEASE'\n${helper}\nVOLTRA_TERRARIA_RELEASE\n${runtimeEmbed}python3 - <<'VOLTRA_INSTALL'\nimport os,sys\nfrom pathlib import Path\nsys.path.insert(0,'.voltra')\nfrom terraria_release_install import install\ninstall(Path.cwd(),dict(os.environ))\nVOLTRA_INSTALL\n`};
    profile.setup_steps=[...(profile.setup_steps||[]).filter(step=>!steps.includes(step)),...steps];
    profile.detail=(profile.detail||'').split(detail).join('')+detail;
    if(kind==='tshock'){
      const legacyStep='TShock5 compatibility automatically uses legacy .NET6. Upstream support ended on November 12, 2024. Prefer the default TShock6 unless you need an older matching game and client version.';
      profile.setup_steps=[...profile.setup_steps.filter(step=>!step.startsWith('TShock5 compatibility')),legacyStep];
    }
    if(kind==='tmodloader'){
      const guidance=['Choose matching tModLoader clients, enabled mods and world data. Older versions may reject newer worlds; use a separate world or a version-matched backup. Existing worlds and mods are preserved.','Legacy .NET6 releases use isolated6.0.36 automatically. Upstream .NET6 support ended on November 12, 2024; prefer a supported release when possible.','Native compatibility for additional releases is not yet verified; native runtime verification applies only to the recorded pinned release.'];
      profile.setup_steps=[...profile.setup_steps.filter(step=>!steps.includes(step)&&!guidance.includes(step)),...guidance];
      const familyDetail=' Supports Linux x64 publisher .NET8/.NET6 and0.11 dedicated MonoKickstart releases. Clients, mods and worlds must match. Native compatibility for additional releases is not yet verified.';
      profile.detail=profile.detail.split(detail).join('').split(familyDetail).join('')+familyDetail;
    }
    profiles[key]=profile;
  }
  return profiles;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const startupOnly=process.argv.includes('--vanilla-startup-only');
  const modernOnly=process.argv.includes('--tshock-only'),tmlOnly=process.argv.includes('--tmodloader-only'),output=startupOnly?'.local/terraria-launcher-alignment':modernOnly?'.local/tshock5-compat':tmlOnly?'.local/tmodloader-runtime-family-audit/staged':'.local/terraria-release-compat';fs.mkdirSync(output,{recursive:true});
  const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json','utf8'));
  const helper=fs.readFileSync('internal/panel/game_library/scripts/terraria-release-install.py','utf8');
  fs.writeFileSync(output+'/profiles.json',JSON.stringify(startupOnly?stageVanillaPublisherStartup(current):stageTerrariaProfiles(current,helper,undefined,modernOnly?['terraria/tshock/egg-tshock.json']:tmlOnly?['terraria/tmodloader/egg-t-modloader.json']:null),null,2)+'\n');
  console.log('Staged selected Terraria profiles; canonical overrides unchanged.');
}
