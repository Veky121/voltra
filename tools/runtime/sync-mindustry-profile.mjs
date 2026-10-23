import fs from 'node:fs';
const path='mindustry/egg-mindustry.json',entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===path),file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file)),egg=structuredClone(entry.egg);
egg.docker_images={'Java 21':'ghcr.io/ptero-eggs/yolks:java_21'};
egg.startup='exec bash .voltra/mindustry-start.sh';egg.config.files='{}';egg.config.startup=JSON.stringify({done:'VOLTRA_MINDUSTRY_READY'});egg.config.stop='exit';
egg.description='Mindustry v160.7 dedicated server on Java 21. The selected save resumes on startup; if it does not exist, a world is created from the selected map and mode. Names and descriptions are applied literally through native settings APIs. Normal Stop saves the world before exiting. Reinstall preserves config, maps, mods, administrator/player data and saves. Clients need the matching game build and compatible mods.';
for(const v of egg.variables){
 if(v.env_variable==='VERSION'){v.default_value='v160.7';v.rules='required|string|in:v160.7';v.description='Reviewed server release. Clients must use a compatible v160.7 build.';}
 if(v.env_variable==='SERVER_NAME'){v.default_value='Mindustry server';v.rules='required|string|max:100';v.description='Literal server name, including spaces, punctuation and Unicode.';}
 if(v.env_variable==='MAPNAME'){v.rules='required|string|max:100';v.description='Installed map name, used only when creating a new save. Upload custom maps to config/maps. Default: Tendrils.';}
}
for(const [name,key,description,value,rules]of [
 ['Save name','SAVE_NAME','Persistent save under config/saves, without .msav. Change this to start a separate world.','world','required|string|alpha_dash|between:1,100'],
 ['Game mode','GAMEMODE','Mode for a new world. Existing saves retain their own rules.','survival','required|in:survival,sandbox,attack,pvp,editor'],
 ['Maximum players','MAX_PLAYERS','Player limit. 0 means unlimited.','30','required|integer|between:0,999'],
 ['Server description','SERVER_DESCRIPTION','Literal description shown by clients.','','nullable|string|max:100'],
 ['Autosave interval (seconds)','AUTOSAVE_SECONDS','Writes the persistent save and native rotating backups while hosting.','300','required|integer|between:30,3600'],
 ['Pause when empty','AUTO_PAUSE','1 pauses the world when no players are connected.','1','required|in:0,1'],
])egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
const source=fs.readFileSync('internal/panel/game_library/scripts/VoltraMindustry.java','utf8');
const license=fs.readFileSync('internal/panel/game_library/scripts/Mindustry-LICENSE','utf8');
egg.scripts.installation={container:'eclipse-temurin:21-jdk-jammy',entrypoint:'bash',script:`#!/bin/bash
set -euo pipefail
case "$VERSION" in v160.7) ;; *) echo 'This reviewed profile supports Mindustry v160.7.'; exit 2 ;; esac
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl
cd /mnt/server
mkdir -p .voltra/classes
stage=$(mktemp -d /mnt/server/.mindustry-install.XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
curl --fail --location --retry 3 --output "$stage/server-release.jar" https://github.com/Anuken/Mindustry/releases/download/v160.7/server-release.jar
printf '%s  %s\\n' f7b899a4038b95b14a824d5f8993984f79d73baa3254c385b6538327f9c0befd "$stage/server-release.jar" | sha256sum -c -
cat > .voltra/VoltraMindustry.java <<'JAVA_SOURCE'
${source}
JAVA_SOURCE
cat > .voltra/Mindustry-LICENSE <<'LICENSE_SOURCE'
${license}
LICENSE_SOURCE
javac --release 17 -cp "$stage/server-release.jar" -d "$stage/classes" .voltra/VoltraMindustry.java
cp -a "$stage/classes/." .voltra/classes/
mv "$stage/server-release.jar" server-release.jar
cat > .voltra/mindustry-start.sh <<'LAUNCH'
#!/bin/bash
set -euo pipefail
cd /home/container
case "$SERVER_MEMORY" in ''|*[!0-9]*) echo 'Invalid server memory limit.'; exit 2 ;; esac
heap=$((SERVER_MEMORY*75/100))
if [ "$heap" -lt 64 ]; then echo 'Allocate at least 128 MiB for this server.'; exit 2; fi
exec java -Xms64M -Xmx"$heap"M -cp 'server-release.jar:.voltra/classes' mindustry.server.VoltraMindustry
LAUNCH
echo 'Mindustry v160.7 installed with verified download. Existing operator data retained.'
`};
const previous=profiles[path]||{};
profiles[path]={upstream_sha256:entry.sha256,revision:'mindustry-v160.7-v1',defaults:{memory:1024,disk:2048},setup_steps:['Start from Console. A missing save is generated from Map Name and Game mode; an existing save resumes automatically.','Connect with a matching Mindustry v160.7 client using the allocated address and port. Both TCP and UDP use that port.','Normal Stop and the Console exit/stop commands save the current world first. Autosaves update the persistent file and native rotating backups.','Map and game mode changes affect new saves. Choose a different Save name to create another world without deleting the old one.','Back up config, including settings.bin, saves, maps and mods. Add administrators and manage bans through native Console commands. Reinstall preserves operator data.'],egg,...(previous.verification?{verification:previous.verification,detail:previous.detail}:{})};
fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');console.log('Reviewed Mindustry profile generated.');
