// Stage only the observed missing dependency and scoped early refusal repair.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {refreshHelpers} from './refresh-profile-helpers.mjs';
const recipe = 'astroneer/egg-astroneer-dedicated-server.json';
const original = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
const source = fs.readFileSync('internal/panel/game_library/scripts/astroneer-parity.py', 'utf8');
const proton = fs.readFileSync('internal/panel/game_library/scripts/enshrouded-proton.py', 'utf8');
const next = refreshHelpers({[recipe]: original}, new Map([['astroneer_parity', source], ['enshrouded_proton', proton]])).profiles[recipe];
let found = false;
next.egg.scripts.installation.script = next.egg.scripts.installation.script.replace(/^apt-get install -y --no-install-recommends [^\r\n]+$/m, line => {found = true; return /\blibvulkan1\b/.test(line) ? line : line + ' libvulkan1';});
assert(found, 'Pinned installer prerequisite line missing');
assert.deepEqual(next.egg.variables, original.egg.variables);
next.revision = original.revision.includes('-vulkan-preflight-v1') ? original.revision : original.revision + '-vulkan-preflight-v1';
next.setup_steps.push('Installer includes libvulkan1 for the shared GE-Proton loader copy and refuses before acquisition if that prerequisite is absent. Failed unreceipted framework state requires explicit root review; no automatic adoption or deletion.');
const output = 'artifacts/game-parity-20261029/astroneer-native-dependency-profile.json';
fs.writeFileSync(output, JSON.stringify({[recipe]: next}, null, 2) + '\n');
console.log(JSON.stringify({output, variables_preserved: true, readiness_added: false}));
