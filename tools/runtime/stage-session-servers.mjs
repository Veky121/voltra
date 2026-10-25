import fs from 'node:fs';
import crypto from 'node:crypto';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const sources=['steam-template.py','native-config.py','native-console.py','session-servers-runtime.py','session-servers-install.py'];
const profiles={};
const previous=process.argv.includes('--kf2-only')?JSON.parse(fs.readFileSync('.local/session-servers/profiles.json')):{};
for(const [game,path,memory,disk,ports] of [['scp','scpsl/dedicated/egg-scpsl.json',3072,8192,1],['exiled','scpsl/exiled/egg-s-c-p--s-l--exiled.json',4096,8192,1],['kf2','killing_floor_2/egg-killing-floor2.json',4096,65536,3]]){
 if(game!=='kf2' && previous[path]){profiles[path]=previous[path];continue;}
 const entry=catalog.entries.find(e=>e.path===path);if(!entry)throw Error('Missing original '+path);
 const egg=structuredClone(entry.egg);
 egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
 egg.docker_images={'Pinned Debian Trixie native runtime':'ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8'};
 egg.startup='exec python3 .voltra/session_servers_runtime.py '+game;
 egg.config={files:'{}',startup:JSON.stringify({done:game==='kf2'?'DevOnline: Playfab server registered with lobby ID ':'Waiting for players'}),logs:'{}',stop:'^SIGTERM'};
 if(game==='scp')egg.variables.push({name:'Accept SCP:SL EULA',description:'Read https://link.scpslgame.com/eula . Enable only if you agree to the publisher EULA. Default off does not accept terms; LocalAdmin prompts in Console. Existing persisted agreement is retained.',env_variable:'SCPSL_ACCEPT_EULA',default_value:'0',user_viewable:true,user_editable:true,rules:'required|boolean'});
 if(game==='exiled')egg.variables.push({name:'Update base server at startup',description:'Added explicit typed Steam update control. Default off preserves the original EXILED recipe startup. Reinstall resolves EXILED_VERSION and EXILED_PRE_RELEASES.',env_variable:'AUTO_UPDATE',default_value:'0',user_viewable:true,user_editable:true,rules:'required|boolean'});
 for(const variable of egg.variables){
  if(['STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS'].includes(variable.env_variable))variable.description+=' Private Steam credentials/password branches are currently unsupported and rejected before filesystem/process changes.';
  if(variable.env_variable==='EXTRA_FLAGS')variable.description+=' Original field now supports literal optional native -switch[=value] arguments; shell syntax is never executed. Managed ports/admin/path overrides are rejected.';
  if(variable.env_variable==='DOTNET_BUNDLE_EXTRACT_BASE_DIR')variable.description+=' Resolved beneath the server volume; absolute paths, traversal and symlinks are rejected.';
  if(variable.env_variable==='EXILED_VERSION')variable.description+=' Latest selects current maintained ExMod-Team release; exact version must exist and supply a publisher SHA256 archive digest. No fallback to another version. v9.15.2 is pinned.';
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\ncd /mnt/server\nmkdir -p .voltra\n';
 for(const source of sources)script+=`cat > .voltra/${source.replaceAll('-','_')} <<'VOLTRA_SESSION_SERVERS_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SESSION_SERVERS_SOURCE\n`;
 script+='python3 .voltra/session_servers_install.py '+game+'\n';
 egg.scripts.installation={container:'mcr.microsoft.com/dotnet/sdk@sha256:8dd1a57fe6b7b8b1b357635db67e272c2f9e9d76d1dd0a32711c4c33c57d7b43',entrypoint:'bash',script};
 profiles[path]={revision:'session-servers-source-v1',upstream_sha256:entry.sha256,platforms:['linux/amd64'],required_ports:ports,defaults:{memory,disk},verification:'not_verified',detail:'Source-only adapter. No game payload downloaded and no native startup, port/query, console, configuration, preservation or runtime-image compatibility acceptance performed.',egg,setup_steps:['Choose a Linux x64 node. Every original variable remains available through the shared setup form.','Anonymous public Steam only. Original private/account/password-branch fields are retained with an explicit unsupported prerequisite; no credential workaround.','Existing config/admin/plugin files remain operator-owned. Reinstall preserves the original configuration trees; the typed console forwards original commands and shutdown without normalizing exit status.']};
 if(game!=='kf2')profiles[path].setup_steps.push('LocalAdmin remains the native parent, working directory is the volume root and EXIT is sent on Stop. A private pinned Microsoft .NET9.0.21 runtime follows the current publisher guide; actual LocalAdmin/runtime compatibility remains unverified.');
 if(game==='scp')profiles[path].setup_steps.push('Fresh vanilla LocalAdmin uses publisher --useDefault only when neither its per-port nor global configuration exists. Existing operator configuration and hoster_policy.txt AppData layout remain authoritative. This initializes configuration only; EULA agreement stays separate and defaults off.');
 if(game==='scp')profiles[path].setup_steps.push('Read https://link.scpslgame.com/eula before enabling Accept SCP:SL EULA. It defaults off; only your explicit enabled setting passes the publisher-supported ACCEPT_SCPSL_EULA=TRUE. Existing LocalAdmin agreement under .config remains operator-owned and is preserved by Reinstall. While the first-run EULA prompt is unanswered, EXIT does not stop it: answer no to decline.');
 if(game==='exiled')profiles[path].setup_steps.push('Maintained ExMod-Team EXILED uses the documented SHA256-checked manual archive layout under .config. Original exact/latest/prerelease controls are retained. Releases without publisher digests fail explicitly; compatibility with the selected SCP branch must be accepted separately.');
 if(game==='kf2'){
  profiles[path].revision='session-servers-source-v2-kf2-ports';
  profiles[path].port_rules=[{minimum:1025,maximum:65535,count:3,offsets:[12783]},{environment:'QUERY_PORT',condition:'nonzero',allocated_value:true,auto_allocate:true,exclude_primary:true,exclude_offsets:[12783],minimum:1025,maximum:65535,count:3},{environment:'WEB_ADMIN_PORT',condition:'nonzero',when_environment:'WEB_ADMIN',when_value:'true',allocated_value:true,auto_allocate:true,exclude_primary:true,exclude_offsets:[12783],minimum:1025,maximum:65535,count:4}];
  profiles[path].setup_steps.push('Select three distinct allocations on the same address: game UDP, Steam UDP at game + 12783, and QUERY_PORT UDP. Game port must be <=52752. Enabling WebAdmin requires a fourth distinct TCP allocation. The shared form reserves the fixed Steam companion before selecting query/WebAdmin roles; overflow, missing allocations and collisions fail before writes. Workshop subscriptions, mutators, map cycles and MultiAdmin files remain editable. The documented Steam socket formula still requires native observation before runtime acceptance.');
 }
}
fs.mkdirSync('.local/session-servers',{recursive:true});
fs.writeFileSync('.local/session-servers/profiles.json',JSON.stringify(profiles,null,2)+'\n');
fs.writeFileSync('.local/session-servers/source-hashes.json',JSON.stringify(Object.fromEntries(sources.map(source=>[source,crypto.createHash('sha256').update(fs.readFileSync('internal/panel/game_library/scripts/'+source)).digest('hex')])),null,2)+'\n');
console.log('Three source-only profiles staged; shared overrides untouched.');
