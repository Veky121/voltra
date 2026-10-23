import fs from 'node:fs';
const path='ddnet/egg-d-d-net.json',entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===path);
const file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file)),egg=structuredClone(entry.egg);
egg.description+=' Publisher-verified native DDNet, pinned to 20.1.1 by default. No Steam login is needed. Dashboard console uses the supported private input FIFO; native databases, maps, votes, RCON and external console remain available.';
egg.docker_images={'Ubuntu 24.04':'ghcr.io/ptero-eggs/yolks@sha256:85cc85e658366d2398288b1f829a4bab4de2d02a3bea4193f8d502db7b2dd29b'};
egg.startup='exec python3 .voltra/ddnet_runtime.py';
egg.config={files:'{}',startup:JSON.stringify({done:'Voltra DDNet console ready'}),logs:'{}',stop:'shutdown'};
for(const v of egg.variables){
 if(['STEAM_USER','STEAM_PASS'].includes(v.env_variable)){v.rules='nullable|string';v.description='Legacy API compatibility field. The publisher-native installer does not need Steam credentials.';}
 if(v.env_variable==='AUTO_UPDATE')v.description='Check and repair the selected publisher release before startup. With RELEASE_VERSION=latest this follows publisher stable releases. With a pinned version it retains that version. Off skips startup maintenance; Reinstall still checks the selected release.';
 if(v.env_variable==='MAX_PLAYERS'){v.rules='required|integer|between:1,128';v.description='Maximum connected clients. DDNet 20.1.1 supports 128. A compatible legacy 0.7 client can show a mapped 64-slot view. Older selected versions may have a lower native limit.';}
 if(v.env_variable==='SERVER_NAME')v.rules='required|string|max:127|not_regex:/[\\r\\n\\x00]/';
 if(v.env_variable==='SERVER_PASS'){v.rules='nullable|string|max:255|not_regex:/[\\r\\n\\x00]/';v.description='Native join password, maximum 255 UTF-8 bytes. Empty permits passwordless joins.';}
 if(v.env_variable==='SERVER_MAP'){v.rules='required|string|max:127|not_regex:/[\\r\\n\\x00]/';v.description='Map basename without .map, including spaces or punctuation. Upload custom maps to ddnet/maps. Native byte limit is 127.';}
}
for(const [name,key,description,value,rules]of [
 ['Publisher version','RELEASE_VERSION','Pinned reviewed default 20.1.1. latest opts into the publisher stable release. Other published stable versions remain selectable but require separate runtime acceptance.','20.1.1','required|string|max:30|regex:/^(latest|[0-9]+\\.[0-9]+(\\.[0-9]+)?)$/'],
 ['Teeworlds 0.7 support','SIXUP','Keep native sixup support enabled for compatible 0.7 clients. Native 0.6/DDNet connectivity remains available.','1','required|boolean'],
 ['Test commands','TEST_COMMANDS','Enable native practice/test commands. Disabled by default for normal play, overriding the publisher example configuration.','0','required|boolean'],
 ['RCON password','RCON_PASSWORD','Native administrator password, maximum 127 UTF-8 bytes. Empty generates and privately retains .voltra/ddnet/rcon-password.','','nullable|string|max:127|not_regex:/[\\r\\n\\x00]/'],
])egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends ca-certificates python3\nmkdir -p .voltra\n';
for(const [source,name]of [['native-release.py','native_release.py'],['ddnet-install.py','ddnet_install.py'],['ddnet-runtime.py','ddnet_runtime.py']])script+=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SOURCE\n`;
script+='python3 .voltra/ddnet_install.py\n';
egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
const previous=profiles[path]||{};
profiles[path]={upstream_sha256:entry.sha256,revision:'ddnet-20.1.1-native-v1',platforms:['linux/amd64'],defaults:{memory:1024,disk:4096},egg,verification:previous.verification||'not_verified',detail:previous.detail||'Native installation and FIFO integration under review; live acceptance pending.',setup_steps:[
 'Start from Console after installation and connect directly to the allocated UDP address with a compatible DDNet client. Private listing is the default. Native 0.7 support is enabled unless explicitly disabled.',
 'The publisher-native installer needs no Steam credentials. Original Steam fields remain only for API compatibility. Keep 20.1.1 for the reviewed default; latest with Auto Update opts into publisher stable updates.',
 'Use ddnet/autoexec_server.cfg or the existing ddnet/data/autoexec_server.cfg for native tuning, votes, race rules, database and moderator settings. The form supplies managed fields after native configuration loads.',
 'Upload custom maps through Files to ddnet/maps. For 0.7 clients, also provide the converted matching map under ddnet/maps7; the publisher includes map_convert_07. The tested fixture supplied both formats. Native SQLite scores default to ddnet/ddnet-server.sqlite with generated local storage settings. Existing storage.cfg and database configuration remain operator-owned.',
 'Console input uses the native private FIFO. Stop sends native shutdown. Generated RCON credentials remain private under .voltra/ddnet/rcon-password; native external console remains available separately.',
 'Back up the complete volume, including ddnet databases, maps, demos, configuration and generated credentials. Reinstall retains configuration, maps and modified stock assets. Changed managed files are backed up under .voltra/ddnet/previous-* before publication.',
]};
fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');console.log('DDNet native profile generated; live acceptance remains separate.');
