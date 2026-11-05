import fs from 'node:fs';
import assert from 'node:assert/strict';
const recipe = 'counter_strike/counter_strike_2/egg-counter--strike2.json';
const catalog = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const imported = catalog.entries.find(e => e.path === recipe);
const profile = structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
assert.equal(profile.upstream_sha256, imported.sha256);
assert.ok(['source-third-v1', 'cs2-parity-20261029-v1'].includes(profile.revision), 'Re-review changed base before staging');
// An integrated v1 already embeds the helper. Replace its exact heredoc rather
// than appending a second stale copy or overwriting the immutable first receipt.
profile.revision = 'cs2-parity-20261030-authority-v2';
profile.verification = 'not_verified';
profile.detail = 'CS2-specific persistent gameplay file and secret field metadata; offline fixtures only. Native gates pending isolated runtime receipt.';
profile.egg.startup = profile.egg.startup.replace('source_third_runtime.py', 'cs2_runtime.py');
const script = profile.egg.scripts.installation.script;
const boundary = 'python3 .voltra/bundle_debian_python.py';
assert.ok(script.includes(boundary));
const helper = fs.readFileSync('internal/panel/game_library/scripts/cs2-runtime.py', 'utf8').replace(/\r\n/g, '\n');
const cleanScript = script.replace(/cat > \.voltra\/cs2_runtime\.py <<'VOLTRA_CS2'\r?\n[\s\S]*?\r?\nVOLTRA_CS2\r?\n/, '');
profile.egg.scripts.installation.script = cleanScript.replace(boundary,
  "cat > .voltra/cs2_runtime.py <<'VOLTRA_CS2'\n" + helper + '\nVOLTRA_CS2\n' + boundary);
for (const variable of profile.egg.variables) {
  if (['SERVER_PASSWORD', 'RCON_PASSWORD', 'STEAM_GSLT', 'SRCDS_BETAPASS'].includes(variable.env_variable)) variable.field_type = 'password';
  if (variable.env_variable === 'STEAM_GSLT') {
    variable.rules = 'nullable|string|alpha_num|size:32';
    variable.description = 'Optional for isolated local testing. Public Steam authentication requires your own 32-character GSLT. Never share it or put it in console commands.';
  }
  if (variable.env_variable === 'MAX_PLAYERS') variable.rules = 'required|integer|between:1,64';
}
profile.setup_steps.push('Native gameplay edits belong in game/csgo/cfg/voltra-native.cfg. It is seeded once, loaded at startup and map reload, and preserved by the existing Steam CFG backup. Keep identity and credentials in existing setup controls. Mode-specific overrides remain operator-owned gamemode_*_server.cfg files.');
// Declare discovery through existing settings machinery without Wings rewriting bytes.
profile.egg.config.files = JSON.stringify({'game/csgo/cfg/voltra-native.cfg': {parser: 'file', find: {}}});
fs.mkdirSync('artifacts/game-parity-20261029/cs2-authority-20261030', {recursive: true});
fs.writeFileSync('artifacts/game-parity-20261029/cs2-authority-20261030/profile.pending.json', JSON.stringify({[recipe]: profile}, null, 2) + '\n');
console.log('Staged CS2 only; global overrides unchanged.');
