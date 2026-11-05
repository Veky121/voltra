import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const file='internal/panel/game_library/overrides.json',before=fs.readFileSync(file),recipe='mindustry/egg-mindustry.json',current=JSON.parse(before)[recipe],profile=structuredClone(current);
const body=fs.readFileSync('tools/runtime/mindustry-wave9-VoltraMindustry.java.pending','utf8').replaceAll('\r\n','\n'),original=fs.readFileSync('internal/panel/game_library/scripts/VoltraMindustry.java','utf8').replaceAll('\r\n','\n');
const script=profile.egg.scripts.installation.script;assert.equal(script.split(original).length,2,'Original embedded launcher must match canonical source');profile.egg.scripts.installation.script=script.replace(original,()=>body);
assert.equal(profile.egg.startup,'exec bash .voltra/mindustry-start.sh');profile.egg.startup='exec bash .voltra/mindustry-native-start.sh';
assert.equal(profile.egg.scripts.installation.script.split('.voltra/mindustry-start.sh').length,2);profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace('.voltra/mindustry-start.sh','.voltra/mindustry-native-start.sh');
const preflight=fs.readFileSync('tools/runtime/mindustry-wave9-installer-preflight.sh.pending','utf8').replaceAll('\r\n','\n');
let installation=profile.egg.scripts.installation.script;
assert(installation.includes('apt-get update\n'));installation=installation.replace('apt-get update\n','cd /mnt/server\n'+preflight+'\nmindustry_validate_managed_paths\napt-get update\n');
assert(installation.includes('cd /mnt/server\nmkdir -p .voltra/classes\n'));installation=installation.replace('cd /mnt/server\nmkdir -p .voltra/classes\n','');
installation=installation.replace("cat > .voltra/VoltraMindustry.java <<'JAVA_SOURCE'","cat > \"$stage/VoltraMindustry.java\" <<'JAVA_SOURCE'").replace("cat > .voltra/Mindustry-LICENSE <<'LICENSE_SOURCE'","cat > \"$stage/Mindustry-LICENSE\" <<'LICENSE_SOURCE'");
assert(installation.includes('javac --release 17 -cp "$stage/server-release.jar" -d "$stage/classes" .voltra/VoltraMindustry.java'));
installation=installation.replace('javac --release 17 -cp "$stage/server-release.jar" -d "$stage/classes" .voltra/VoltraMindustry.java','javac --release 17 -cp "$stage/server-release.jar" -d "$stage/classes" "$stage/VoltraMindustry.java"');
assert(installation.includes('cp -a "$stage/classes/." .voltra/classes/\nmv "$stage/server-release.jar" server-release.jar\n'));installation=installation.replace('cp -a "$stage/classes/." .voltra/classes/\nmv "$stage/server-release.jar" server-release.jar\n','');
installation=installation.replace("cat > .voltra/mindustry-native-start.sh <<'LAUNCH'","cat > \"$stage/mindustry-native-start.sh\" <<'LAUNCH'");
const publish=`LAUNCH
mindustry_validate_managed_paths
test -f "$stage/classes/mindustry/server/VoltraMindustry.class"
mkdir -p .voltra/classes/mindustry/server
mindustry_validate_managed_paths
mv -Tf -- "$stage/VoltraMindustry.java" .voltra/VoltraMindustry.java
mv -Tf -- "$stage/Mindustry-LICENSE" .voltra/Mindustry-LICENSE
mv -Tf -- "$stage/classes/mindustry/server/VoltraMindustry.class" .voltra/classes/mindustry/server/VoltraMindustry.class
mv -Tf -- "$stage/server-release.jar" server-release.jar
mv -Tf -- "$stage/mindustry-native-start.sh" .voltra/mindustry-native-start.sh
`;
assert.equal(installation.split('LAUNCH\n').length,2);installation=installation.replace('LAUNCH\n',publish);profile.egg.scripts.installation.script=installation;
profile.settings_documents=['config/settings.bin'];profile.revision+='-native-authority-wave9';profile.setup_steps=[...profile.setup_steps,'Creation controls seed native settings.bin values once; later use Game settings for the source-defined native scalar controls. Native operator settings and opaque administrator/player/mod data are preserved. Allocated port and pinned updates remain managed; control-socket/start-command facilities stay in advanced native file configuration.'];profile.detail+=' Native-authority/settings.bin source candidate staged; campaign native and browser gates pending.';
assert.deepEqual(profile.egg.variables,current.egg.variables);assert.deepEqual(profile.defaults,current.defaults);assert.deepEqual(profile.egg.docker_images,current.egg.docker_images);assert.deepEqual(profile.egg.config,current.egg.config);assert.equal(profile.egg.scripts.installation.container,current.egg.scripts.installation.container);assert.equal(profile.egg.scripts.installation.entrypoint,current.egg.scripts.installation.entrypoint);
assert(profile.egg.scripts.installation.script.includes(fs.readFileSync('internal/panel/game_library/scripts/Mindustry-LICENSE','utf8').replaceAll('\r\n','\n')));assert(profile.egg.scripts.installation.script.includes('f7b899a4038b95b14a824d5f8993984f79d73baa3254c385b6538327f9c0befd'));assert(fs.readFileSync(file).equals(before));
fs.writeFileSync('artifacts/game-parity-20261029/mindustry-wave9-profile.json',JSON.stringify({[recipe]:profile},null,2)+'\n');console.log(JSON.stringify({profile:'artifacts/game-parity-20261029/mindustry-wave9-profile.json',controls:profile.egg.variables.length,java_sha256:crypto.createHash('sha256').update(body).digest('hex'),canonical_changed:false}));
