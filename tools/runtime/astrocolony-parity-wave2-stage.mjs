import fs from 'node:fs';
import assert from 'node:assert/strict';
const key = 'astro_colony/egg-astro-colony.json';
const current = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[key];
const profile = structuredClone(current);
const oldCommand = 'python3 .voltra/unreal_survival_next.py install astro';
assert.equal(profile.egg.scripts.installation.script.split(oldCommand).length, 2);
let insert = '';
for (const [source, installed] of [['astrocolony-seed.py', 'astrocolony_seed.py'], ['astrocolony-runtime.py', 'astrocolony_runtime.py']]) {
  const body = fs.readFileSync('internal/panel/game_library/scripts/' + source, 'utf8').replaceAll('\r\n', '\n');
  assert(!body.includes('VOLTRA_ASTRO_WAVE2'));
  insert += `cat > .voltra/${installed} <<'VOLTRA_ASTRO_WAVE2'\n${body}\nVOLTRA_ASTRO_WAVE2\n`;
}
profile.egg.scripts.installation.script = profile.egg.scripts.installation.script.replace(oldCommand, insert + 'python3 .voltra/astrocolony_runtime.py install');
assert(profile.egg.startup.endsWith('.voltra/unreal_survival_next.py run astro'));
profile.egg.startup = profile.egg.startup.replace('.voltra/unreal_survival_next.py run astro', '.voltra/astrocolony_runtime.py run');
profile.settings_documents = {...profile.settings_documents, '/AstroColony/Saved/Config/LinuxServer/ServerSettings.ini': 'ini'};
profile.revision += '-native-file-v2';
profile.detail += ' Astro-only seed-once native configuration and operator-password log redaction are source fixtures only; no new native acceptance.';
profile.setup_steps.push('Gameplay controls seed missing native ServerSettings.ini values only. Later changes use Game settings and survive subsequent starts; runtime-owned allocated ports and server name remain startup controls.');
assert.deepEqual(profile.egg.variables, current.egg.variables);
for (const name of ['config', 'docker_images', 'features']) assert.deepEqual(profile.egg[name], current.egg[name]);
for (const name of ['upstream_sha256', 'verification', 'platforms', 'defaults', 'required_ports', 'port_rules']) assert.deepEqual(profile[name], current[name]);
fs.writeFileSync('artifacts/game-parity-20261029/astrocolony-wave2-profile.json', JSON.stringify({[key]: profile}, null, 2) + '\n');
console.log('Staged Astro Colony only; exact variable rows and existing metadata preserved.');
