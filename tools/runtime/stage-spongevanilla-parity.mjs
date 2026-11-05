import fs from 'node:fs';
import assert from 'node:assert/strict';
const recipe = 'minecraft/java/spongevanilla/egg-sponge-vanilla.json';
const profile = structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
assert.equal(profile.revision, 'spongevanilla-managed-java-v1', 'Re-review changed base');
const original = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e => e.path === recipe);
assert.equal(profile.upstream_sha256, original.sha256);
profile.revision = 'spongevanilla-parity-20261029-v1';
profile.verification = 'not_verified';
profile.detail = 'SpongeVanilla-only publisher resolution and filename preservation hardening; offline fixtures passed, all five current native gates pending.';
const boundary = 'python3 .voltra/hybrid_java_install.py spongevanilla';
assert.ok(profile.egg.scripts.installation.script.includes(boundary));
profile.egg.scripts.installation.script = profile.egg.scripts.installation.script.replace(boundary,
  "cat > .voltra/spongevanilla_install.py <<'VOLTRA_SPONGEVANILLA'\n" + fs.readFileSync('internal/panel/game_library/scripts/spongevanilla-install.py', 'utf8') +
  '\nVOLTRA_SPONGEVANILLA\npython3 .voltra/spongevanilla_install.py');
profile.egg.variables.find(v => v.env_variable === 'SV_VERSION').description = 'Exact publisher SpongeVanilla release, recommended, or latest. No fallback on missing versions. The default is pinned; choose a compatible Java runtime explicitly when changing release.';
profile.egg.variables.find(v => v.env_variable === 'SERVER_JARFILE').description = 'Executable JAR filename, including extensionless names. Configuration filenames and existing directories are rejected.';
// Only allocation bindings are managed at start. General settings remain file-owned.
const files = JSON.parse(profile.egg.config.files);
assert.deepEqual(Object.keys(files['server.properties'].find).sort(), ['query.port', 'server-ip', 'server-port']);
files['config/sponge/launch.properties'] = {parser: 'file', find: {}};
profile.egg.config.files = JSON.stringify(files);
profile.setup_steps = [
  'Default pinned SpongeVanilla 1.21.10-17.0.0 uses Java 21. Exact published releases, latest and publisher recommended remain selectable. Select a compatible Java runtime for other releases.',
  'Accept the Minecraft EULA explicitly through the existing consent flow before starting. Installation never writes eula.txt or changes consent.',
  'Edit native general settings in server.properties through existing Game settings. Allocation IP, game port and query port remain runtime-managed. Unknown properties, credentials, worlds, saves and operator files are preserved.',
  'Sponge API plugins belong in mods/ or the additional directory in config/sponge/launch.properties, normally mods/plugins. Root plugins/, Bukkit/Paper plugins and Forge mods are not interchangeable. Plugin configuration remains in the existing file workspace.',
  'Console readiness uses the actual Done marker; stop sends stop. Native state, settings round trip and plugin/world persistence still require the isolated campaign run.'
];
fs.writeFileSync('artifacts/game-parity-20261029/spongevanilla-profile.json', JSON.stringify({[recipe]: profile}, null, 2) + '\n');
console.log('Staged SpongeVanilla only; global overrides unchanged.');
