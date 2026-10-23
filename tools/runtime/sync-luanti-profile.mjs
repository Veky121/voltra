import fs from 'node:fs';
import crypto from 'node:crypto';
const path='minetest/egg-minetest.json',entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===path),file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file)),egg=structuredClone(entry.egg);
egg.name='Luanti (Minetest)';
egg.description='Luanti 5.17.0 headless server, built from checksum-pinned source. Installs a selected ContentDB game through its JSON API, or accepts manual game uploads. Existing games, worlds, accounts, mods and operator settings survive reinstall. Public listing is disabled by default. Native console and /shutdown are supported.';
egg.docker_images={'Luanti Linux x64 libraries':'ghcr.io/ptero-eggs/games@sha256:42f21573592affb723ca2f00cc745e4afe06f07e03939679e27fa1ce1005bb6e'};
egg.startup='exec python3 .voltra/luanti-runtime.py';
egg.config.files='{}';egg.config.startup=JSON.stringify({done:'VOLTRA_LUANTI_ADMIN_READY'});egg.config.stop='^SIGINT';
const singleLine='not_regex:/[\\r\\n\\x00]/|not_regex:/^\\s|\\s$/|not_regex:/^(?:\\{|"{3})$/';
for(const v of egg.variables){
 const key=v.env_variable;
 if(['SERVER_NAME','SERVER_DESC','SERVER_DOMAIN','SERVER_URL','SERVER_MOTD','SERVER_PASSWORD','SERVER_LIST_URL'].includes(key))v.rules=(key==='SERVER_NAME'?'required':'nullable')+'|string|max:512|'+singleLine;
 if(key==='SERVER_ADMIN_NAME'){v.default_value='Owner';v.rules='required|string|regex:/^[A-Za-z0-9_-]{1,20}$/';v.description='Initial administrator player name and native console identity. Connect using exactly this name. Up to 20 letters, numbers, underscores or hyphens.';}
 if(key==='SERVER_NAME')v.default_value='Luanti server';
 if(key==='SERVER_DESC')v.default_value='';
 if(key==='SERVER_DOMAIN'){v.default_value='';v.description='Optional advertised hostname. Leave blank for direct LAN/IP connections.';}
 if(key==='SERVER_URL'){v.default_value='';v.description='Optional homepage shown in the public server list.';}
 if(key==='SERVER_LIST_URL')v.default_value='https://servers.luanti.org';
 if(key==='SERVER_ANNOUNCE'){v.default_value='false';v.rules='required|in:true,false';v.description='Public listing is disabled by default. Enable only when the allocated UDP port is reachable and your advertised address is correct.';}
 if(key==='SERVER_MAX_USERS'){v.user_editable=true;v.rules='required|integer|between:1,65535';}
 if(key==='SERVER_PASSWORD')v.description='Default password for new accounts, not a universal password for existing accounts. Existing users retain their own passwords. Use a single line without surrounding whitespace.';
 if(key==='WORLD_NAME'){v.rules='required|string|regex:/^[A-Za-z0-9_-]{1,32}$/';v.description='World folder under .minetest/worlds. Use letters, numbers, underscores or hyphens. Changing this starts or selects another world; existing worlds remain intact.';}
 if(key==='DEFAULT_GAME'){v.rules='required|string|regex:/^[A-Za-z0-9_-]{1,64}$/';v.description='Installed game folder ID under .minetest/games. The default ContentDB game installs as minetest. Existing worlds retain their own native game metadata.';}
 if(key==='COMMUNITY_DOWNLOAD'){v.rules='required|in:0,1';v.description='1 downloads a game only if the selected game folder is absent. 0 allows uploading a game manually through Files after installation. Existing game files are never overwritten.';}
 if(key==='COMMUNITY_GAME_NAME'){v.rules='nullable|required_if:environment.COMMUNITY_DOWNLOAD,1|string|regex:/^[A-Za-z0-9_-]{1,64}$/';}
 if(key==='COMMUNITY_GAME_AUTOR'){v.default_value='Luanti';v.rules='nullable|required_if:environment.COMMUNITY_DOWNLOAD,1|string|regex:/^[A-Za-z0-9_-]{1,64}$/';v.description='ContentDB package author, case sensitive. The upstream variable spelling is retained for compatibility.';}
}
egg.variables.push({name:'Game release','env_variable':'COMMUNITY_GAME_RELEASE',description:'Default Minetest Game release 38214. For another package, choose its release ID or set 0 for the newest release compatible with Luanti 5.17.0. Existing games are preserved regardless of this field.',default_value:'38214',rules:'required|integer|between:0,999999999999',user_viewable:true,user_editable:true,field_type:'text'});
egg.variables.push({name:'Create administrator account',env_variable:'BOOTSTRAP_ADMIN',description:'1 creates the configured administrator only if absent. 0 leaves account creation to your game or external authentication provider. Existing account passwords are never changed.',default_value:'1',rules:'required|in:0,1',user_viewable:true,user_editable:true,field_type:'text'});
egg.variables.push({name:'Initial administrator password',env_variable:'SERVER_ADMIN_PASSWORD',description:'Optional first-account password. Blank generates a password stored privately in .minetest/worlds/WORLD_NAME/voltra-admin-password-NAME.json. Existing accounts retain their own password. This differs from the default password for new players.',default_value:'',rules:'nullable|string|max:512|'+singleLine,user_viewable:true,user_editable:true,field_type:'text'});
const runtime=fs.readFileSync('internal/panel/game_library/scripts/luanti-runtime.py','utf8'),game=fs.readFileSync('internal/panel/game_library/scripts/luanti-game-install.py','utf8'),admin=fs.readFileSync('internal/panel/game_library/scripts/luanti-admin.lua','utf8');
const adapter=fs.readFileSync('internal/panel/game_library/scripts/luanti-plain-console.cpp.inc','utf8'),patcher=fs.readFileSync('internal/panel/game_library/scripts/luanti-patch-console.py','utf8');
const buildId='5.17.0-plain-console-v1-'+crypto.createHash('sha256').update(adapter).digest('hex');
egg.scripts.installation={container:'ubuntu:22.04',entrypoint:'bash',script:`#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl python3 cmake g++ make libgmp-dev libjsoncpp-dev libluajit-5.1-dev zlib1g-dev libzstd-dev libsqlite3-dev libcurl4-gnutls-dev libncurses-dev libleveldb-dev libssl-dev
cd /mnt/server
mkdir -p .voltra .minetest/games .minetest/mods .minetest/worlds
mkdir -p .voltra/luanti-libs .voltra/luanti-licenses
cp -L /usr/lib/x86_64-linux-gnu/libjsoncpp.so.25 .voltra/luanti-libs/libjsoncpp.so.25
cp /usr/share/doc/libjsoncpp25/copyright .voltra/luanti-licenses/JsonCpp-copyright
export LD_LIBRARY_PATH=/mnt/server/.voltra/luanti-libs
cat > .voltra/luanti-runtime.py <<'RUNTIME_SOURCE'
${runtime}
RUNTIME_SOURCE
cat > .voltra/luanti-game-install.py <<'GAME_SOURCE'
${game}
GAME_SOURCE
cat > .voltra/luanti-admin.lua <<'ADMIN_SOURCE'
${admin}
ADMIN_SOURCE
cat > .voltra/luanti-plain-console.cpp.inc <<'CONSOLE_SOURCE'
${adapter}
CONSOLE_SOURCE
cat > .voltra/luanti-patch-console.py <<'PATCH_SOURCE'
${patcher}
PATCH_SOURCE
engine_hash=52e7dd315ae0e5c3868a23231e691578cd694bcca5af627fc57c03f32bdc846f
engine_build_id=${buildId}
build_engine=1
if [ -f .voltra/luanti/.voltra-source-sha256 ] && [ -f .voltra/luanti/.voltra-build-id ] && [ "$(cat .voltra/luanti/.voltra-source-sha256)" = "$engine_hash" ] && [ "$(cat .voltra/luanti/.voltra-build-id)" = "$engine_build_id" ]; then
  if .voltra/luanti/bin/luantiserver --version | grep '^Luanti 5.17.0 ' >/dev/null; then build_engine=0; fi
fi
if [ "$build_engine" = 1 ]; then
  stage=$(mktemp -d /mnt/server/.luanti-engine.XXXXXX)
  trap 'rm -rf -- "$stage"' EXIT
  curl --fail --location --retry 3 --output "$stage/source.tar.gz" https://codeload.github.com/luanti-org/luanti/tar.gz/refs/tags/5.17.0
  printf '%s  %s\\n' "$engine_hash" "$stage/source.tar.gz" | sha256sum -c -
  mkdir "$stage/engine"
  tar -xzf "$stage/source.tar.gz" --strip-components=1 -C "$stage/engine"
  python3 .voltra/luanti-patch-console.py "$stage/engine/src/terminal_chat_console.cpp" .voltra/luanti-plain-console.cpp.inc
  cmake -S "$stage/engine" -B "$stage/build" -DCMAKE_BUILD_TYPE=Release -DRUN_IN_PLACE=TRUE -DBUILD_CLIENT=FALSE -DBUILD_SERVER=TRUE -DENABLE_CURSES=TRUE -DENABLE_LEVELDB=TRUE -DBUILD_UNITTESTS=FALSE -DBUILD_BENCHMARKS=FALSE
  cmake --build "$stage/build" --target luantiserver -j2
  "$stage/engine/bin/luantiserver" --version | grep '^Luanti 5.17.0 '
  printf '%s\\n' "$engine_hash" > "$stage/engine/.voltra-source-sha256"
  printf '%s\\n' "$engine_build_id" > "$stage/engine/.voltra-build-id"
  if [ -e .voltra/luanti ]; then mv .voltra/luanti ".voltra/luanti-previous-$(date +%s)-$$"; fi
  mv "$stage/engine" .voltra/luanti
else
  echo 'Reviewed Luanti 5.17.0 engine retained.'
fi
python3 .voltra/luanti-game-install.py
echo 'Luanti engine installation complete. Existing worlds, accounts, mods and games retained.'
`};
const previous=profiles[path]||{};
profiles[path]={
 upstream_sha256:entry.sha256,revision:'luanti-5.17.0-v1',platforms:['linux/amd64'],defaults:{memory:2048,disk:4096},
 setup_steps:[
  'First installation compiles the pinned headless engine and downloads the selected ContentDB game. This can take several minutes.',
  'Start from Console and connect with a compatible Luanti client to the allocated UDP port. Use the exact configured administrator name. An absent account is created with your initial password, or a generated password stored privately in .minetest/worlds/WORLD_NAME/voltra-admin-password-NAME.json. Existing accounts are never reset.',
  'For another ContentDB game, set package author/name, a distinct Game ID, and release ID or 0 for newest compatible. An existing game directory is preserved; changing download settings does not update it.',
  'For manual games, disable Community download and upload the complete game, including game.conf, under .minetest/games/GAME_ID before starting.',
  'World name selects .minetest/worlds/WORLD_NAME. Back up .minetest, including worlds, games, mods, configuration, private generated credentials and account databases. Normal Stop uses native SIGINT and saves the world. A Console /shutdown may trigger Wings automatic restart; use Stop to leave the server offline.',
  'Public listing is disabled by default. The default new-player password differs from the initial administrator password. Existing users retain their own passwords. Disable administrator bootstrap only when your game or authentication provider handles account creation.',
 ],egg,...(previous.verification?{verification:previous.verification,detail:previous.detail}:{}),
};
fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');
console.log('Reviewed Luanti profile generated; runtime verification remains separate.');
