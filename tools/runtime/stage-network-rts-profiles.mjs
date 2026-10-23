import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const existing=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const source=name=>fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8');
const profiles={};
function installation(files,command){let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends ca-certificates python3\nmkdir -p .voltra\n';for(const [file,name]of files)script+=`cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${source(file)}\nVOLTRA_SOURCE\n`;return{script:script+command+'\n',container:'debian:bookworm-slim',entrypoint:'bash'};}
function variable(name,key,description,value,rules){return{name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'};}
const ddPath='ddracenetwork/egg-d-d-race-network.json',entry=catalog.entries.find(x=>x.path===ddPath),egg=structuredClone(entry.egg);
const shared=existing['ddnet/egg-d-d-net.json'];
egg.docker_images=structuredClone(shared.egg.docker_images);egg.startup='exec python3 .voltra/ddrace-network.py';
egg.config={files:'{}',startup:JSON.stringify({done:'Voltra DDNet console ready'}),logs:'{}',stop:'shutdown'};
for(const v of egg.variables){
 if(v.env_variable==='VERSION'){v.default_value='20.1.1';v.rules='required|string|max:30|regex:/^(latest|nightly|[0-9]+\\.[0-9]+(\\.[0-9]+)?)$/';v.description='Pinned publisher stable20.1.1 default. latest follows stable; nightly selects publisher nightly plus its published checksum. Nondefault versions need separate runtime acceptance.';}
 if(v.env_variable==='SERVER_NAME')v.rules='required|string|max:127|not_regex:/[\\r\\n\\x00]/';
 if(v.env_variable==='SERVER_PASSWORD')v.rules='nullable|string|max:255|not_regex:/[\\r\\n\\x00]/';
 if(v.env_variable==='SERVER_MAP')v.rules='required|string|max:127|not_regex:/[\\r\\n\\x00]/';
}
for(const key of ['MAX_PLAYERS','SIXUP','TEST_COMMANDS','RCON_PASSWORD','AUTO_UPDATE']){const v=shared.egg.variables.find(x=>x.env_variable===key);if(v)egg.variables.push(structuredClone(v));}
egg.scripts.installation=installation([['native-release.py','native_release.py'],['ddnet-install.py','ddnet_install.py'],['ddnet-runtime.py','ddnet_runtime.py'],['ddrace-network.py','ddrace-network.py']],'python3 .voltra/ddrace-network.py install');
const prior=existing[ddPath]||{};
profiles[ddPath]={upstream_sha256:entry.sha256,revision:'ddrace-network-publisher-native-v1',platforms:['linux/amd64'],defaults:{memory:1024,disk:4096},egg,verification:prior.verification||'not_verified',detail:prior.detail||'Original DDRaceNetwork controls adapted to shared DDNet native runtime; independent native acceptance pending.',setup_steps:[
 'Original VERSION, SERVER_NAME, SERVER_PASSWORD, SERVER_MAP and SERVER_REGISTER controls remain available. Registration retains the native0/ipv4 choices. No Steam credentials are required.',
 'The publisher20.1.1 package uses ddnet/ as the engine directory. Original root data/maps/maps7/demos, configuration and SQLite files are copied into that layout only when destinations are absent; originals stay untouched. Configure ddnet/autoexec_server.cfg or ddnet/data/autoexec_server.cfg, custom maps in ddnet/maps and compatible converted maps in ddnet/maps7. Existing native storage.cfg and database settings remain operator-owned.',
 'Dashboard input uses the shared native private FIFO. Stop sends native shutdown. Native RCON, votes, race rules, SQLite databases, demos and map tooling remain available. Generated credentials remain private under .voltra/ddnet/.',
 'Back up the entire volume. Reinstall preserves operator configuration, maps, databases and modified stock assets; replaced managed files are backed up. latest/nightly are opt-in and do not inherit pinned-release acceptance.',
]};
for(const [path,mod]of [['openra/openra_dune2000/egg-open-r-a--dune2000.json','d2k'],['openra/openra_red_alert/egg-open-r-a.json','ra'],['openra/openra_tiberian_dawn/egg-open-r-a--tiberian-dawn.json','cnc']]){
 const entry=catalog.entries.find(x=>x.path===path),egg=structuredClone(entry.egg),prior=existing[path]||{};
 egg.docker_images=structuredClone(shared.egg.docker_images);egg.startup=`exec python3 .voltra/openra-family.py ${mod}`;
 egg.config={files:'{}',startup:JSON.stringify({done:'Starting dedicated server for mod:'}),logs:'{}',stop:'^C'};
 for(const v of egg.variables){
  if(v.env_variable==='VERSION'){v.default_value='release-20250330';v.user_viewable=true;v.user_editable=true;v.rules='required|string|max:30|regex:/^(latest|playtest|(release|playtest)-[0-9]{8})$/';v.description='Pinned publisher stable release-20250330 by default. latest follows stable; playtest and explicit date tags remain selectable and need separate acceptance.';}
  if(v.env_variable==='PASSWORD')v.rules='nullable|string|max:255|not_regex:/[\\r\\n\\x00]/';
  if(v.env_variable==='SERVER_NAME')v.rules='required|string|max:255|not_regex:/[\\r\\n\\x00]/';
  if(v.env_variable==='AUTH')v.description='Native Server.RequireAuthentication: require authenticated OpenRA profiles. This original field is now wired to the engine.';
 }
 egg.variables.push(variable('Starting map UID','SERVER_MAP','Optional native40-character SHA1 map UID. Leave empty for the mod default. Upload compatible custom .oramap files to OpenRAData/maps/<mod>/<version>/.','','nullable|string|regex:/^([0-9a-f]{40})?$/'),variable('Record replays','RECORD_REPLAYS','Native dedicated-server replay recording. Actual replay creation requires a played match.','true','required|string|in:true,false'));
 egg.scripts.installation=installation([['native-release.py','native-release.py'],['small-native-install.py','small-native-install.py'],['openra-family.py','openra-family.py']],`python3 .voltra/openra-family.py ${mod} install`);
 profiles[path]={upstream_sha256:entry.sha256,revision:'openra-publisher-appimage-native-v1',platforms:['linux/amd64'],defaults:{memory:1024,disk:4096},egg,verification:prior.verification||'not_verified',detail:prior.detail||'Publisher bundled native dedicated server and original controls implemented; per-mod acceptance pending.',setup_steps:[
  'Connect with the matching OpenRA mod and release version at the allocated TCP address. Public listing is off by default. Authentication, password, single-player, GeoIP and anonymized IP controls use native server settings.',
  'The dedicated headless server uses publisher bundled rules/maps and does not download original commercial game media. Clients must install their own required game assets through OpenRA. Operator-owned content can be uploaded to OpenRAData/Content/<mod>/v2/ when needed; this recipe does not redistribute licensed assets.',
  'OpenRAData/ retains native settings, maps, logs and replays. Existing original Support, .config/openra or .openra data is copied there only for missing files; originals and current files remain untouched. Use native .oramap packages and map UIDs; keep custom content compatible with this exact mod/version. Native settings not managed by the form remain in OpenRAData/settings.yaml.',
  'The publisher dedicated server has output logging and native Ctrl-C Stop, but no interactive stdin command API. No fabricated console command bridge is installed. Replay creation, player authentication and matches require actual clients.',
  'Back up the whole volume. Reinstall retains OpenRAData and modified engine files, backing up replaced managed files under .voltra/openra/. Pinned archives verify the publisher zsync SHA1 and recorded SHA256; the old release API supplied no independent SHA256. Other releases use GitHub digest or publisher zsync checksum when available.',
 ]};
}
fs.mkdirSync('.local/network-rts-games',{recursive:true});fs.writeFileSync('.local/network-rts-games/profiles.json',JSON.stringify(profiles,null,2)+'\n');console.log('Four independent staged profiles generated; existing root verification/detail preserved.');
