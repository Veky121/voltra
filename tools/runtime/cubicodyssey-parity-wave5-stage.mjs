import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const recipe = 'cubic_odyssey/egg-cubic-odyssey.json';
const file = 'internal/panel/game_library/overrides.json';
const originalBytes = fs.readFileSync(file);
const current = JSON.parse(originalBytes)[recipe];
const profile = structuredClone(current);
const canonical = 'internal/panel/game_library/scripts/cubic-odyssey-native.py';
const source = fs.existsSync(canonical) ? canonical : 'tools/runtime/cubicodyssey-parity-wave5.py';
const body = fs.readFileSync(source, 'utf8').replaceAll('\r\n', '\n');
const delimiter = 'VOLTRA_CUBIC_ODYSSEY_WAVE5';
assert(!body.split('\n').includes(delimiter));
if (profile.egg.startup.endsWith('.voltra/crafting_runtime.py')) {
  profile.egg.startup = profile.egg.startup.replace('.voltra/crafting_runtime.py', '.voltra/cubic_odyssey_native.py run');
} else assert(profile.egg.startup.endsWith('.voltra/cubic_odyssey_native.py run'));
const anchor = 'python3 .voltra/bundle_debian_python.py\n';
assert.equal(profile.egg.scripts.installation.script.split(anchor).length, 2);
const sourceBlock=/^cat > \.voltra\/cubic_odyssey_native\.py <<'([^']+)'\n[\s\S]*?\n\1\n/gm;
const existing=[...profile.egg.scripts.installation.script.matchAll(sourceBlock)];
assert(existing.length<=1);
if(existing.length){
  profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace(sourceBlock,()=>`cat > .voltra/cubic_odyssey_native.py <<'${delimiter}'\n${body}\n${delimiter}\n`);
  assert.equal(profile.egg.scripts.installation.script.replace(sourceBlock,'<CUBIC_SOURCE>'),current.egg.scripts.installation.script.replace(sourceBlock,'<CUBIC_SOURCE>'),'All other helper bytes, including latest native_console, must stay exact');
} else profile.egg.scripts.installation.script = profile.egg.scripts.installation.script.replace(anchor,
  () => `cat > .voltra/cubic_odyssey_native.py <<'${delimiter}'\n${body}\n${delimiter}\n${anchor}`);
const installBlock = "PYTHONPATH=.voltra python3 - <<'VOLTRA_INSTALL'\nfrom pathlib import Path\nimport os\nfrom crafting_install import install\ninstall(Path.cwd(),dict(os.environ))\nVOLTRA_INSTALL";
const currentInstallBlock=installBlock.replace('from crafting_install import install','from cubic_odyssey_native import install');
if(profile.egg.scripts.installation.script.includes(installBlock)) profile.egg.scripts.installation.script = profile.egg.scripts.installation.script.replace(installBlock,currentInstallBlock);
else assert.equal(profile.egg.scripts.installation.script.split(currentInstallBlock).length,2);
if(!profile.revision.endsWith('-publisher-sample-v2'))profile.revision += '-publisher-sample-v2';
const existingDocuments = Array.isArray(profile.settings_documents) ? profile.settings_documents : Object.keys(profile.settings_documents || {}).map(file => file.replace(/^\//, ''));
profile.settings_documents = [...new Set([...existingDocuments, 'config/server_config.txt'])];
profile.detail += ' Actual publisher sample-only first install is supported; native controls are scoped to GameParams/m_server ServerParams and preserve DifficultySettings. Candidate awaits native retry.';
profile.setup_steps=[...new Set([...profile.setup_steps,'A genuinely absent config/server_config.txt is securely seeded from the publisher server_config.txt.sample, retaining unknown native settings. Existing operator config is validated before acquisition and never reseeded. Unsupported legacy flat-root files require operator review.'])];
assert.deepEqual(profile.egg.variables, current.egg.variables);
for (const key of ['config', 'docker_images', 'features']) assert.deepEqual(profile.egg[key], current.egg[key]);
for (const key of ['upstream_sha256', 'verification', 'platforms', 'defaults', 'required_ports', 'port_rules']) assert.deepEqual(profile[key], current[key]);
assert(fs.readFileSync(file).equals(originalBytes), 'Canonical source drifted while staging');
const embedded = profile.egg.scripts.installation.script.split(`cat > .voltra/cubic_odyssey_native.py <<'${delimiter}'\n`)[1]?.split(`\n${delimiter}\n`)[0];
assert.equal(embedded, body, 'Installer must embed the exact helper, without JS replacement interpolation');
const output = 'artifacts/game-parity-20261029/cubicodyssey-wave5-profile.json';
fs.writeFileSync(output, JSON.stringify({[recipe]:profile}, null, 2) + '\n');
console.log(JSON.stringify({output, controls:profile.egg.variables.length, helper_sha256:crypto.createHash('sha256').update(body).digest('hex'), native:false}));
