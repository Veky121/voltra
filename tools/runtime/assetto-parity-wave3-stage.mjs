import fs from 'node:fs';
import assert from 'node:assert/strict';
const canonical = 'internal/panel/game_library/scripts/assetto-native-authority.py';
const source = fs.existsSync(canonical) ? canonical : 'tools/runtime/assetto-parity-wave3.py';
const body = fs.readFileSync(source, 'utf8').replaceAll('\r\n', '\n');
assert(!body.includes('VOLTRA_ASSETTO_AUTHORITY_WAVE3'));
const overrides = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const result = {};
for (const [key, game] of [['assetto_corsa/egg-assetto-corsa.json', 'assetto'], ['assetto_corsa/egg-assetto-corsa--freeroam--a-i.json', 'assettoserver']]) {
  const current = overrides[key], profile = structuredClone(current);
  const install = `python3 .voltra/assetto-ams-native.py install ${game}`;
  assert.equal(profile.egg.scripts.installation.script.split(install).length, 2);
  profile.egg.scripts.installation.script = profile.egg.scripts.installation.script.replace(install,
    `cat > .voltra/assetto-native-authority.py <<'VOLTRA_ASSETTO_AUTHORITY_WAVE3'\n${body}\nVOLTRA_ASSETTO_AUTHORITY_WAVE3\npython3 .voltra/assetto-native-authority.py install ${game}`);
  assert(profile.egg.startup.endsWith(`.voltra/assetto-ams-native.py run ${game}`));
  profile.egg.startup = profile.egg.startup.replace(`.voltra/assetto-ams-native.py run ${game}`, `.voltra/assetto-native-authority.py run ${game}`);
  profile.settings_documents = {...profile.settings_documents, '/cfg/server_cfg.ini': 'ini', '/cfg/entry_list.ini': 'ini', ...(game === 'assettoserver' ? {'/cfg/extra_cfg.yml': 'yaml'} : {})};
  profile.revision += '-native-authority-v3';
  profile.detail += ' Native-file authority source fixtures retain identity, credentials, lobby listing and slot count; only allocated ports reconcile each start. No additional native acceptance.';
  profile.setup_steps.push('Existing native server_cfg.ini values take precedence over creation controls after initial seeding. Use Game settings for native gameplay, identity, passwords and slots. Allocated game/HTTP ports remain startup-owned. Operator presets, entry lists, AI YAML, plugins and licensed assets are retained.');
  assert.deepEqual(profile.egg.variables, current.egg.variables);
  for (const name of ['config', 'docker_images', 'features']) assert.deepEqual(profile.egg[name], current.egg[name]);
  for (const name of ['upstream_sha256', 'verification', 'platforms', 'defaults', 'required_ports', 'port_rules']) assert.deepEqual(profile[name], current[name]);
  result[key] = profile;
}
assert.equal(Object.keys(result).length, 2);
fs.writeFileSync('artifacts/game-parity-20261029/assetto-wave3-profile.json', JSON.stringify(result, null, 2) + '\n');
console.log('Staged both Assetto variants; original ordered variables and protected metadata preserved. Canonical overrides untouched.');
