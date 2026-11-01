import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

export const recipe = 'mindustry/egg-mindustry.json';
const normalize = value => value.replaceAll('\r\n', '\n');

function replaceEmbedded(script, target, marker, source) {
  const open = `cat > "$stage/${target}" <<'${marker}'\n`;
  const start = script.indexOf(open);
  assert(start >= 0 && script.indexOf(open, start + open.length) === -1, `One staged ${target} required`);
  const content = start + open.length;
  const end = script.indexOf(`\n${marker}\n`, content);
  assert(end >= content, `Closing ${marker} required`);
  assert(!source.split('\n').includes(marker), `Source contains reserved ${marker} delimiter`);
  return script.slice(0, content) + source + script.slice(end);
}

// Keep the reviewed native-authority scaffold and every metadata/control row.
// Refresh only its three canonical embedded sources. Refuse legacy launchers.
export function refreshMindustryProfile(current, sources) {
  assert(current?.revision?.includes('native-authority'), 'Reviewed native-authority profile required');
  assert.equal(current.egg.startup, 'exec bash .voltra/mindustry-native-start.sh');
  assert(current.settings_documents?.includes('config/settings.bin'), 'Native binary discovery required');
  const output = structuredClone(current);
  let script = normalize(output.egg.scripts.installation.script);
  for (const required of [
    'case "$VERSION" in v160.7)',
    'f7b899a4038b95b14a824d5f8993984f79d73baa3254c385b6538327f9c0befd',
    'mv -Tf -- "$stage/VoltraMindustry.java" .voltra/VoltraMindustry.java',
    'mv -Tf -- "$stage/mindustry-native-start.sh" .voltra/mindustry-native-start.sh',
    'javac --release 17 -cp "$stage/server-release.jar" -d "$stage/classes" "$stage/VoltraMindustry.java"',
  ]) assert(script.includes(required), `Reviewed installer guard missing: ${required}`);
  assert(!script.includes('cp -a "$stage/classes/."'), 'Legacy class publication refused');
  const java = normalize(sources.java), license = normalize(sources.license), preflight = normalize(sources.preflight);
  assert(java.includes('Vars.netServer.admins.forceSave();'), 'Native administrator flush required');
  const save = java.slice(java.indexOf('private static boolean savePersistent() {'));
  assert(save.includes('Vars.netServer.admins.forceSave();') && save.indexOf('Vars.netServer.admins.forceSave();') < save.indexOf('Core.settings.forceSave();'), 'Administrator flush must precede persistent settings flush');
  script = replaceEmbedded(script, 'VoltraMindustry.java', 'JAVA_SOURCE', java);
  script = replaceEmbedded(script, 'Mindustry-LICENSE', 'LICENSE_SOURCE', license);
  const start = script.indexOf('mindustry_validate_managed_paths() {\n');
  const end = script.indexOf('\n}\n', start);
  assert(start >= 0 && end > start, 'Managed-path preflight required');
  assert(preflight.startsWith('mindustry_validate_managed_paths() {\n') && preflight.trimEnd().endsWith('\n}'), 'Canonical preflight function required');
  script = script.slice(0, start) + preflight.trimEnd() + script.slice(end + 2);
  assert(script.indexOf('\nmindustry_validate_managed_paths\n') < script.indexOf('\napt-get update\n'), 'Preflight must precede acquisition');
  output.egg.scripts.installation.script = script;
  return output;
}

export function run(args = process.argv.slice(2)) {
  assert(args.every(arg => ['--check', '--apply'].includes(arg)) && args.length <= 1, 'Use --check or explicitly --apply; default stages one profile');
  const file = 'internal/panel/game_library/overrides.json';
  const original = fs.readFileSync(file), profiles = JSON.parse(original);
  const current = profiles[recipe];
  const profile = refreshMindustryProfile(current, {
    java: fs.readFileSync('internal/panel/game_library/scripts/VoltraMindustry.java', 'utf8'),
    license: fs.readFileSync('internal/panel/game_library/scripts/Mindustry-LICENSE', 'utf8'),
    preflight: fs.readFileSync('internal/panel/game_library/scripts/mindustry-installer-preflight.sh', 'utf8'),
  });
  if (args[0] === '--check') assert.deepEqual(profile, current, 'Embedded Mindustry sources need refresh');
  else if (args[0] === '--apply') {
    assert(fs.readFileSync(file).equals(original), 'Override file changed during generation');
    profiles[recipe] = profile;
    fs.writeFileSync(file, JSON.stringify(profiles, null, 2) + '\n');
  } else {
    fs.writeFileSync('artifacts/game-parity-20261029/mindustry-sync-profile.json', JSON.stringify({[recipe]: profile}, null, 2) + '\n');
  }
  console.log(JSON.stringify({recipe, controls: profile.egg.variables.length, mode: args[0] || 'stage', canonical_written: args[0] === '--apply'}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
