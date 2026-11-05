import fs from 'node:fs';
const path = 'ddracenetwork/egg-d-d-race-network.json';
const entry = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e => e.path === path);
const prior = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[path];
const profile = structuredClone(prior);
profile.revision = 'ddrace-network-file-authoritative-20261029-v2';
profile.verification = 'not_verified';
profile.detail = 'Source preparation only. Native five-gate acceptance pending root integration.';
const egg = profile.egg;
// Preserve original controls and duplicates in their exact order and metadata.
egg.variables = [...structuredClone(entry.egg.variables), ...egg.variables.filter(v => !entry.egg.variables.some(o => o.env_variable === v.env_variable))];
egg.startup = 'exec python3 .voltra/ddrace_parity.py';
egg.config = { files: '{}', startup: JSON.stringify({done: 'Voltra DDRace native initialized'}), logs: '{}', stop: 'shutdown' };
let script = '#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends ca-certificates python3\nmkdir -p .voltra\n';
for (const [source, target] of [['native-release.py','native_release.py'], ['ddnet-install.py','ddnet_install.py'], ['ddnet-runtime.py','ddnet_runtime.py'], ['ddrace-network.py','ddrace_legacy.py'], ['ddrace-parity.py','ddrace_parity.py'], ['ddrace-parity-console.py','ddrace_console.py']]) {
  script += `cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/' + source, 'utf8')}\nVOLTRA_SOURCE\n`;
}
script += 'python3 .voltra/ddrace_parity.py install\n';
egg.scripts.installation = {script, container: 'debian:bookworm-slim', entrypoint: 'bash'};
profile.setup_steps = [
  'Original controls seed fresh native configuration once. Existing ddnet/autoexec_server.cfg or ddnet/data/autoexec_server.cfg is authoritative. Edit it through the existing Game settings native CFG document and Files; environment edits do not overwrite it.',
  'VERSION retains latest, nightly and pinned publisher versions. Linux x64, HTTPS publisher access, published SHA256, Python3 and CA certificates are required. No Steam account is needed. No download was performed in this source wave.',
  'Allocated UDP port and private FIFO are runtime constraints. Native initialization requires the server-name log and an open FIFO; independent UDP query, map loading, authenticated join and player movement still require native acceptance.',
  'Back up the entire volume, including configuration, maps/maps7, data, demos, SQLite and private credentials. Legacy originals remain untouched; destinations win. Native shutdown is used; a 15-second signal-stop deadline kills a stuck process and returns failure.',
  'Registration remains 0/ipv4. Supply matching converted maps for 0.7 clients. Preserve operator storage.cfg, SQL credentials, votes, unknown commands and permissions. latest/nightly need independent acceptance.'
];
fs.mkdirSync('artifacts/game-parity-20261029', {recursive:true});
fs.writeFileSync('artifacts/game-parity-20261029/ddnet-profile.json', JSON.stringify({[path]:profile}, null, 2) + '\n');
console.log('Staged DDRace-only fragment; no global override or runtime changed.');
