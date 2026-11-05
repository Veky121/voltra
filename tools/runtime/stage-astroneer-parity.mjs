import fs from 'node:fs';
const path = 'astroneer/egg-astroneer-dedicated-server.json';
const entry = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e => e.path === path);
const profile = structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[path]);
if (!entry || !profile) throw Error('Missing original Astroneer profile');
const egg = profile.egg;
egg.variables = [...structuredClone(entry.egg.variables), ...egg.variables.filter(v => !entry.egg.variables.some(o => o.env_variable === v.env_variable))];
let script = '#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6 libvulkan1\nmkdir -p .voltra\n';
for (const name of ['space-survival.py', 'space-survival-pins.json', 'engineering-servers.py', 'engineering-servers-pins.json', 'steam-native-next.py', 'steam-template.py', 'native-config.py', 'native-release.py', 'native-console.py', 'source-install.py', 'enshrouded-proton.py', 'astroneer-parity.py']) {
  const source = fs.readFileSync('internal/panel/game_library/scripts/'+name, 'utf8').replaceAll('\r\n', '\n');
  if (source.split('\n').includes('VOLTRA_ASTRONEER_SOURCE')) throw Error('Heredoc delimiter collision');
  script += `cat > .voltra/${name === 'steam-template.py' ? 'steam_template.py' : name} <<'VOLTRA_ASTRONEER_SOURCE'\n${source}\nVOLTRA_ASTRONEER_SOURCE\n`;
}
script += 'python3 .voltra/astroneer-parity.py install\n';
egg.scripts.installation.script = script;
egg.startup = 'exec python3 .voltra/astroneer-parity.py';
egg.config = {...egg.config, files: '{}', startup: '{}', stop: '^SIGTERM'};
profile.revision = 'astroneer-file-authority-20261029-v1';
profile.verification = 'not_verified';
profile.detail = 'Offline source preparation only. All five native gates remain unverified.';
profile.setup_steps = [
  'All nine original rows, defaults, rules and permissions retained in order. Shared setup seeds missing native fields only; existing native values and repeated PlayerProperties remain authoritative. No automatic owner/admin list rewriting.',
  'Stop the server before Game settings or Files edits. Astro/Saved/Config/WindowsServer/Engine.ini and AstroServerSettings.ini are native authority. URL.Port follows the allocation; encryption false seeds only when missing. SaveGames and active save names remain untouched.',
  'Original Windows app 728470 uses existing pinned private GE-Proton and typed Steam/operator-files acquisition. Private credentials and runtime licenses require explicit handling. No game download or entitlement check in this wave.',
  'Shared native console supervises real process output, exit codes and bounded SIGINT shutdown. Astro native log forwarding is staged but actual log path and flush require native evidence. No readiness marker is synthesized from Proton diagnostics.',
  'Root must integrate typed INI discovery, stopped-only editing, native readiness evidence and offline/crash transitions. Self-hosted cross-platform restrictions and encryption compatibility require matching player clients. All five gates remain unverified.'
];
fs.writeFileSync('artifacts/game-parity-20261029/astroneer-profile.json', JSON.stringify({[path]: profile}, null, 2)+'\n');
console.log('Staged Astroneer only; no global overrides changed.');
