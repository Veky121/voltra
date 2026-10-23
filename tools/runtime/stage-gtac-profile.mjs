import fs from 'node:fs';
const path='gta/gtac/egg-grand-theft-auto-connected.json',revision='gtac-native-v1';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')),entry=catalog.entries.find(e=>e.path===path),egg=structuredClone(entry.egg),prior=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
egg.docker_images={'Debian12 native dedicated server':'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/gtac-runtime.py';
egg.config={files:'{}',startup:JSON.stringify({done:'Server is now listening on port'}),logs:'{}',stop:'^SIGINT'};
egg.variables.find(v=>v.env_variable==='DL_VERSION').default_value='1.7.3';
egg.variables.find(v=>v.env_variable==='SERVERBROWSER').default_value='false';
for(const [name,key,value,rules,description]of[
 ['Player limit','MAX_PLAYERS','32','required|integer|between:1,128','Native player limit; compatible clients and game resources remain operator-controlled.'],
 ['Join password','SERVER_PASSWORD','','nullable|string|max:128','Optional native join password.'],
 ['Other release checksum','GTAC_RELEASE_SHA256','','nullable|string|regex:/^[A-Fa-f0-9]{64}$/','Other exact versions and latest require an explicitly reviewed publisher archive SHA256.'],
])egg.variables.push({name,env_variable:key,default_value:value,rules,description,user_viewable:true,user_editable:true,field_type:'text'});
egg.variables.push({name:'Installer owns updates',env_variable:'AUTO_UPDATE',default_value:'0',rules:'required|in:0',description:'Disable base-image Steam updater.',user_viewable:false,user_editable:false,field_type:'text'});
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\nmkdir -p .voltra\n';
for(const name of['gtac-install.py','gtac-runtime.py','gta-install.py','gta-runtime.py','native-release.py','native-config.py','native-console.py','bundle-debian-python.py'])script+=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')}\nVOLTRA_SOURCE\n`;
script+=`cat > .voltra/steam_template.py <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/steam-template.py','utf8')}\nVOLTRA_SOURCE\npython3 .voltra/bundle-debian-python.py\npython3 .voltra/gtac-install.py 2>&1 | tee .voltra/gtac-install.log\n`;
egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
const profile={upstream_sha256:entry.sha256,revision,platforms:['linux/amd64'],defaults:{memory:1024,disk:4096},required_ports:1,egg,verification:prior[path]?.revision===revision?prior[path].verification:'not_verified',detail:prior[path]?.revision===revision?prior[path].detail:'Implemented; native acceptance pending.',setup_steps:[
 'Publisher GTA Connected Linux dedicated server1.7.3 is pinned by SHA256. No GTA client/game assets are supplied. Each player must provide their legally owned compatible GTA game and GTAC client.',
 'Select any original supported game: GTAIII, Vice City, San Andreas, Underground, IV or Episodes from Liberty City. The bundled freeroam resource targets GTAIII; other games need compatible resource spawning/camera logic. A successful dedicated-server startup does not prove every game mode or client gameplay.',
 'One allocated numeric port carries UDP game traffic and TCP native HTTP resource downloads. Public master listing defaults off; enabling it is an explicit operator choice.',
 'Native server.xml resources, modules, CVars, rules, custom settings and scripts remain editable through Files. Installation preserves operator XML and modified stock resources. Existing root server.xml/resources/modules are imported once with originals retained.',
 'Console forwards native commands; Stop requests quit. Keep resources, native configuration and custom persistent script data in backups. Other versions or rolling latest require a reviewed GTAC_RELEASE_SHA256 rather than accepting changed bytes.',
 ]};
fs.mkdirSync('.local/gta-next',{recursive:true});let profiles={};const stage='.local/gta-next/profiles.json';if(fs.existsSync(stage))profiles=JSON.parse(fs.readFileSync(stage));profiles[path]=profile;fs.writeFileSync(stage,JSON.stringify(profiles,null,2)+'\n');console.log('Staged GTAC independently; native verification pending.');
