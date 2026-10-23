import fs from'node:fs';
const path='gta/ragecoop/egg-rage-c-o-o-p.json',revision='ragecoop-native-v1',catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),entry=catalog.entries.find(e=>e.path===path),egg=structuredClone(entry.egg),prior=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
egg.docker_images={'Debian12 native dedicated server':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/ragecoop-runtime.py';
egg.config={files:'{}',startup:JSON.stringify({done:'Listening for clients'}),logs:'{}',stop:'^SIGINT'};
egg.variables.find(v=>v.env_variable==='VERSION').default_value='1.5.4.7';
for(const[name,key,value,rules,description]of[
 ['Server name','SERVER_NAME','RAGECOOP server','required|string|max:128','Native displayed server name.'],
 ['Player limit','MAX_PLAYERS','32','required|integer|between:1,128','Native maximum player count.'],
 ['Public listing','PUBLIC_SERVER','0','required|boolean','Explicitly announce to publisher master server. Private LAN default is disabled.'],
 ['Other release checksum','RELEASE_SHA256','','nullable|string|regex:/^[A-Fa-f0-9]{64}$/','Other latest/nightly/exact releases require trusted SHA256 when publisher API has no digest.'],
])egg.variables.push({name,env_variable:key,default_value:value,rules,description,user_viewable:true,user_editable:true,field_type:'text'});
egg.variables.push({name:'Installer owns updates',env_variable:'AUTO_UPDATE',default_value:'0',rules:'required|in:0',description:'Disable base-image Steam updater.',user_viewable:false,user_editable:false,field_type:'text'});
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\nmkdir -p .voltra\n';
for(const name of['ragecoop-install.py','ragecoop-runtime.py','gta-install.py','gta-runtime.py','native-release.py','native-config.py','native-console.py','bundle-debian-python.py'])script+=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')}\nVOLTRA_SOURCE\n`;
script+=`cat > .voltra/steam_template.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/steam-template.py','utf8')}\nVOLTRA_SOURCE\npython3 .voltra/bundle-debian-python.py\npython3 .voltra/ragecoop-install.py 2>&1 | tee .voltra/ragecoop-install.log\n`;
egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
const profile={upstream_sha256:entry.sha256,revision,platforms:['linux/amd64'],defaults:{memory:1024,disk:4096},required_ports:1,egg,verification:prior[path]?.revision===revision?prior[path].verification:'not_verified',detail:prior[path]?.revision===revision?prior[path].detail:'Implemented; native acceptance pending.',setup_steps:[
 'Publisher MIT-licensed RAGECOOP1.5.4.7 Linux dedicated release is SHA256-pinned and includes its license notice. Only dedicated server files are downloaded; players supply their own legally owned GTA V and compatible client dependencies.',
 'The release targets the legacy .NET6 generation. Its publisher Linux artifact is used directly; do not assume newer GTA/client/nightly versions are compatible. The publisher recommends nightly for GTA game builds3258or later; choose VERSION nightly with a reviewed release checksum when needed.',
 'Settings.xml retains native voice/P2P/weather/time/streaming/username/moderation/ZeroTier/autoupdate and other operator settings. Only allocated port, name, maximum players and public announcement are managed. Existing Settings.xml/resources/plugins are imported once with originals retained. ZeroTier defaults off and no external network enrollment or account is created.',
 'Keep Resources, plugins, Settings.xml and custom persistent script data in backups. Console forwards native commands; Stop sends native Ctrl+C through the terminal. Public master listing defaults off.',
 ]};
fs.mkdirSync('.local/gta-next',{recursive:true});const stage='.local/gta-next/profiles.json',profiles=fs.existsSync(stage)?JSON.parse(fs.readFileSync(stage)):{};profiles[path]=profile;fs.writeFileSync(stage,JSON.stringify(profiles,null,2)+'\n');console.log('Staged RAGECOOP independently; native verification pending.');
