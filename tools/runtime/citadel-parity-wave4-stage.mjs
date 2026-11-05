import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const recipe = 'citadel/egg-citadel-forged-with-fire.json';
const file = 'internal/panel/game_library/overrides.json';
const originalBytes = fs.readFileSync(file);
const current = JSON.parse(originalBytes)[recipe];
const profile = structuredClone(current);
const canonical = 'internal/panel/game_library/scripts/citadel-preflight.py';
const source = fs.existsSync(canonical) ? canonical : 'tools/runtime/citadel-parity-wave4.py';
const body = fs.readFileSync(source, 'utf8').replaceAll('\r\n', '\n');
const delimiter = 'VOLTRA_CITADEL_WAVE4_PREFLIGHT';
assert(!body.split('\n').includes(delimiter));
assert(profile.egg.startup.endsWith('.voltra/fantasy_worlds_runtime.py citadel'));
profile.egg.startup = profile.egg.startup.replace('.voltra/fantasy_worlds_runtime.py citadel', '.voltra/citadel-preflight.py');
// Write beside existing shared Python helpers before the installer exits. The
// existing acquisition/configuration functions remain authoritative.
profile.egg.scripts.installation.script += `\ncat > .voltra/citadel-preflight.py <<'${delimiter}'\n${body}\n${delimiter}\n`;
const existingDocuments = Array.isArray(profile.settings_documents) ? profile.settings_documents : Object.keys(profile.settings_documents || {}).map(file => file.replace(/^\//, ''));
profile.settings_documents = [...new Set([...existingDocuments, 'Config/Game.ini'])];
profile.revision += '-preflight-wave4';
profile.detail += ' Citadel-only source preflight validates native configuration before automatic acquisition. No new native acceptance.';
profile.setup_steps.push('Config/Game.ini is the canonical native WorldCreationSettings document. Native saved-config mirrors receive that tuple at startup. Ports and the administrator password remain startup-owned; root must protect those fields before Game settings discovery is exposed.');
assert.deepEqual(profile.egg.variables, current.egg.variables);
for (const key of ['config', 'docker_images', 'features']) assert.deepEqual(profile.egg[key], current.egg[key]);
for (const key of ['upstream_sha256', 'verification', 'platforms', 'defaults', 'required_ports', 'port_rules']) assert.deepEqual(profile[key], current[key]);
assert(fs.readFileSync(file).equals(originalBytes), 'Canonical overrides drifted while staging');
const embedded = profile.egg.scripts.installation.script.split(`cat > .voltra/citadel-preflight.py <<'${delimiter}'\n`)[1]?.split(`\n${delimiter}\n`)[0];
assert.equal(embedded, body, 'Installer must embed exact canonical Citadel helper');
const output = 'artifacts/game-parity-20261029/citadel-wave4-profile.json';
fs.writeFileSync(output, JSON.stringify({[recipe]:profile}, null, 2) + '\n');
console.log(JSON.stringify({output, controls:profile.egg.variables.length, helper_sha256:crypto.createHash('sha256').update(body).digest('hex'), native:false}));
