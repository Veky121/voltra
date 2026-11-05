import fs from 'node:fs';
const recipe='eft/egg-stay-in-tarkov.json';
let profile=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json','utf8'))[recipe];
if(profile?.revision?.startsWith('wave15-')) profile=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/root-wave15-source-integration/baseline-overrides.json','utf8'))[recipe];
const helper=fs.readFileSync('internal/panel/game_library/scripts/stay-in-tarkov.py','utf8');
profile.egg.startup=profile.egg.startup.replace('legacy_coop_servers.py run sit','stay_in_tarkov.py run');
profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace('python3 .voltra/bundle_debian_python.py',`cat > .voltra/stay_in_tarkov.py <<'VOLTRA_SIT_SOURCE'\n${helper}\nVOLTRA_SIT_SOURCE\npython3 .voltra/bundle_debian_python.py`).replace('legacy_coop_servers.py install sit','stay_in_tarkov.py install');
// Refuse invalid consent/allocation/platform before apt, mkdir, or acquisition.
const guard=`[ "\${ACKNOWLEDGE_LEGACY_PREREQUISITES:-false}" = true ] || { echo 'SIT prerequisite acknowledgment required' >&2; exit 1; }\n[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || { echo 'SIT requires Linux amd64 image/runtime' >&2; exit 1; }\ncase "\${SERVER_PORT:-}" in ''|*[!0-9]*) exit 1;; esac\n[ "$SERVER_PORT" -ge 1 ] && [ "$SERVER_PORT" -le 65535 ] || exit 1\n`;
profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace('export DEBIAN_FRONTEND',guard+'export DEBIAN_FRONTEND');
profile.revision='stay-in-tarkov-owner-source-v2';
fs.writeFileSync('artifacts/game-parity-20261029/stay-in-tarkov-owner/profile.pending.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
