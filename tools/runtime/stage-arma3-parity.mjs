// Arma 3 fragment only. Never writes catalog overrides or starts runtime resources.
import fs from 'node:fs';
const key = 'arma/arma3/egg-arma3.json';
const profile = structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[key]);
const originalVariables = profile.egg.variables.map(v => v.env_variable);
const controls = [
  ['SERVER_NAME', 'Server name', 'Arma 3 Server', 'required|string|max:255', 'text', 'Native hostname.'],
  ['ADMIN_PASSWORD', 'Administrator password', '', 'nullable|string|max:128', 'password', 'Native passwordAdmin. Choose a separate administrator secret.'],
  ['BATTLEYE', 'BattlEye', '1', 'required|boolean', 'text', 'Native BattlEye switch. This control does not accept publisher agreements.'],
  ['PERSISTENT', 'Persistent mission', '0', 'required|boolean', 'text', 'Continue the mission after the last player disconnects. Required for -autoInit.'],
  ['VERIFY_SIGNATURES', 'Verify signatures', '2', 'required|integer|between:0,2', 'text', 'Native verifySignatures. 2 requires version 2 signatures; 0 disables signature checks.'],
  ['DISABLE_VON', 'Disable voice chat', '0', 'required|boolean', 'text', 'Native disableVoN.'],
  ['VON_CODEC_QUALITY', 'Voice quality', '10', 'required|integer|between:1,30', 'text', 'Native vonCodecQuality, 1 through 30.'],
];
for (const [env_variable, name, default_value, rules, field_type, description] of controls) {
  if (originalVariables.includes(env_variable)) continue;
  profile.egg.variables.push({env_variable, name, default_value, rules, field_type, description,
    user_viewable: true, user_editable: true});
}
profile.revision = 'arma3-settings-20261029-v3';
profile.verification = 'not_verified';
profile.detail = 'Arma 3-specific controls staged; offline fixtures only. Native acquisition, lifecycle, query, preservation and client checks pending isolated runtime receipt.';
profile.egg.startup = profile.egg.startup.replace('arma-native.py run arma3', 'arma3-controls.py run arma3');
const source = fs.readFileSync('internal/panel/game_library/scripts/arma3-controls.py', 'utf8');
const installation = profile.egg.scripts.installation;
const marker = 'python3 .voltra/arma-native.py install arma3';
if (!installation.script.includes(marker)) throw Error('Unknown Arma 3 installer');
installation.script = installation.script.replace(/cat > \.voltra\/arma3-controls\.py <<'VOLTRA_ARMA3_CONTROLS'[\s\S]*?VOLTRA_ARMA3_CONTROLS\r?\n/, '');
installation.script = installation.script.replace(marker,
  `cat > .voltra/arma3-controls.py <<'VOLTRA_ARMA3_CONTROLS'\n${source}\nVOLTRA_ARMA3_CONTROLS\n${marker}`);
for (const variable of profile.egg.variables) {
  if (['SERVER_NAME','ADMIN_PASSWORD','BATTLEYE','PERSISTENT','VERIFY_SIGNATURES','DISABLE_VON','VON_CODEC_QUALITY','SERVER_PASSWORD','MAX_PLAYERS'].includes(variable.env_variable)) {
    variable.description = 'Initial seed only when the native assignment is missing. Edit existing values in Game settings (server.cfg).';
    variable.user_editable = false;
  }
}
profile.setup_steps.push('Native server.cfg is authoritative. Startup controls only seed missing assignments; edit existing values in Game settings while stopped. Existing native settings not owned by these controls, mission classes, basic.cfg, keys and save files remain operator-owned. Native settings UI round trip and reinstall preservation still need runtime evidence.');
fs.mkdirSync('artifacts/game-parity-20261029', {recursive:true});
fs.writeFileSync('artifacts/game-parity-20261029/arma3-settings-profile.json', JSON.stringify({[key]:profile}, null, 2)+'\n');
console.log(`Staged ${key}; preserved ${originalVariables.length} controls; total ${profile.egg.variables.length}.`);
