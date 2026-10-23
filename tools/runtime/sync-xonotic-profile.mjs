import fs from 'node:fs';
const path='xonotic/egg-xonotic.json';
const entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===path);
const file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file)),egg=structuredClone(entry.egg);
egg.description+=' Checked publisher native dedicated package. Stable releases and explicit autobuild updates retain operator data, publisher source and licenses.';
egg.docker_images={'Ubuntu 24.04':'ghcr.io/ptero-eggs/yolks@sha256:85cc85e658366d2398288b1f829a4bab4de2d02a3bea4193f8d502db7b2dd29b'};
egg.startup='exec python3 .voltra/xonotic_runtime.py';
egg.config={files:'{}',startup:JSON.stringify({done:'Xonotic native UDP server ready'}),logs:'{}',stop:'quit'};
egg.variables.find(v=>v.env_variable==='MAX_PLAYERS').rules='required|integer|between:1,99';
Object.assign(egg.variables.find(v=>v.env_variable==='VERSION'),{rules:'required|string|max:20|regex:/^[0-9]+\\.[0-9]+\\.[0-9]+$/',description:'Published stable release. Default 0.8.6 has a pinned publisher checksum. Other versions require the publisher SHA-512 file. Ignored when the explicit autobuild channel is selected.'});
for(const [name,key,description,value,rules]of [
 ['Update channel','UPDATE_CHANNEL','Stable releases by default. Autobuild explicitly selects the publisher moving development package; its SHA-512 must match before publication. Reinstall while stopped to apply updates.','release','required|string|in:release,autobuild'],
 ['Server name','SERVER_NAME','Native server name. Quotes and dollar signs are escaped using DarkPlaces syntax. Backslashes cannot be encoded in native server-info replies. Up to 255 UTF-8 bytes.','Xonotic server','required|string|max:255|not_regex:/[\\\\\\x00-\\x1f\\x7f]/'],
 ['Initial map','GAME_MAP','Installed map basename without .bsp. Native custom PK3 packages under .xonotic/data are supported.','stormkeep','required|string|max:63|regex:/^[A-Za-z0-9_-]+$/'],
 ['Game type','GAME_TYPE','Native mode. Choose a map that supports it. Other tuning, rotation, mutators, custom game modes and voting remain available in server.cfg and Console.','dm','required|string|in:dm,tdm,ctf,ca,ft,kh,as,dom,lms,ka,inv,ons,rc,cts,nb'],
 ['Minimum players','MIN_PLAYERS','Native bot fill target for teamless modes, including connected players. Must not exceed maximum players. Zero disables bot fill.','0','required|integer|between:0,99'],
 ['Minimum per team','MIN_PLAYERS_PER_TEAM','Native bot fill target per team in team modes. The engine caps the combined total to available player slots.','0','required|integer|between:0,99'],
 ['Bots without players','BOT_JOIN_EMPTY','Allow bot fill when no humans are connected. Native default is off.','0','required|boolean'],
 ['Bot skill','BOT_SKILL','Native bot difficulty from zero to ten.','5','required|integer|between:0,10'],
 ['Public listing','PUBLIC_SERVER','Private by default. Enable native master-server listing for an Internet server. Allocated UDP connections work in either mode.','0','required|boolean'],
 ['Server password','SERVER_PASSWORD','Optional native join password, up to 127 UTF-8 bytes.','','nullable|string|max:127|not_regex:/[\\x00-\\x1f\\x7f]/'],
 ['RCON password','RCON_PASSWORD','Optional single native RCON password without spaces. Empty creates a private credential under .voltra/xonotic/rcon-password. Secure challenge RCON is enabled.','','nullable|string|max:127|not_regex:/[\\x00-\\x20\\x7f]/'],
])egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends ca-certificates python3\nmkdir -p .voltra\n';
for(const [source,name]of [['native-release.py','native_release.py'],['native-zip-release.py','native_zip_release.py'],['xonotic-install.py','xonotic_install.py'],['xonotic-runtime.py','xonotic_runtime.py']])script+=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_SOURCE\n`;
script+='python3 .voltra/xonotic_install.py\n';
egg.scripts.installation={script,container:'debian:bookworm-slim',entrypoint:'bash'};
const previous=profiles[path]||{};
profiles[path]={upstream_sha256:entry.sha256,revision:'xonotic-native-v1',platforms:['linux/amd64'],defaults:{memory:2048,disk:12288},egg,verification:previous.verification||'not_verified',detail:previous.detail||'Native setup implemented; publisher-package runtime acceptance pending.',setup_steps:[
 'Install, then start from Console. Connect using the allocated UDP address with a matching Xonotic client. The default is private and starts stormkeep in deathmatch mode.',
 'VERSION selects the published stable package. UPDATE_CHANNEL=autobuild explicitly selects the publisher development build. Stop before reinstalling to update. HTTPS downloads must match the publisher SHA-512 before replacing the managed tree.',
 'Writable native data remains in .xonotic/data. Put server.cfg, custom PK3 packages, maps, map rotation, mutator configuration and persistent game data there. The engine, bundled packages, source and licenses are under xonotic.',
 'Native server.cfg loads before managed settings. The form controls name, initial map, game type, player/bot counts, join/RCON passwords and public listing. Other native configuration remains editable through Files and Console.',
 'Stop sends native quit. Managed settings use DarkPlaces quoting. Names preserve literal quotes and dollar signs but reject backslashes, which native server-info replies cannot encode. The form accepts one RCON password without spaces; generated credentials and managed config have private permissions. Native secure challenge RCON is enabled.',
 'Back up the whole server volume, especially .xonotic and .voltra/xonotic/rcon-password. Updates preserve operator changes and keep the previous managed engine tree under .voltra/xonotic/previous-*. Publisher updater scripts are retained but are not run automatically; use panel reinstall for the managed update path.',
]};
fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');
console.log('Xonotic native profile generated; runtime verification remains separate.');
