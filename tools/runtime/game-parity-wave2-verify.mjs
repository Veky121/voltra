import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const profiles = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const embedded = [
  ['Aska/egg-aska.json', 'aska-file-authority.py', 'aska_file_authority.py'],
  ['aloft/egg-aloft.json', 'aloft-preflight.py', 'aloft_parity_wave2.py'],
  ['beamng/kissmp/egg-kissmp.json', 'kissmp-controls.py', 'kissmp-controls.py'],
  ['avorion/egg-avorion.json', 'avorion-runtime.py', 'avorion_runtime.py'],
  ['astro_colony/egg-astro-colony.json', 'astrocolony-seed.py', 'astrocolony_seed.py'],
  ['astro_colony/egg-astro-colony.json', 'astrocolony-runtime.py', 'astrocolony_runtime.py'],
];
const normalize = text => text.replaceAll('\r\n', '\n').trimEnd();
const checks = embedded.map(([recipe, file, installed]) => {
  const source = fs.readFileSync('internal/panel/game_library/scripts/' + file, 'utf8');
  const script = profiles[recipe].egg.scripts.installation.script.replaceAll('\r\n', '\n');
  const header = script.split('\n').find(line => line.startsWith(`cat > .voltra/${installed} <<'`));
  assert.ok(header, `Missing ${installed}`);
  const delimiter = header.match(/<<'([^']+)'$/)?.[1];
  assert.ok(delimiter);
  const content = script.slice(script.indexOf(header) + header.length + 1).split('\n' + delimiter + '\n')[0];
  assert.equal(normalize(content), normalize(source), `Stale embedded helper: ${recipe} ${file}`);
  return {recipe, source: 'internal/panel/game_library/scripts/' + file, installed, sha256: createHash('sha256').update(source).digest('hex')};
});
const report = {
  scope: 'wave 2 source integration only', complete: false,
  integrated_games: [...new Set([...checks.map(check => check.recipe), 'abiotic_factor/egg-abiotic-factor.json', 'among_us/impostor_server/egg-among-us--impostor-server.json'])],
  helpers: checks,
  checks: {linux_offline_fixtures: {passed: 35, network: 'none', source_mount: 'read-only', memory_mib: 256, cpus: 1}, focused_go_with_isolated_postgres: 'passed, including ASKA API roundtrip and secret masking', go_vet: 'passed', ledger_and_list_tests: 4},
  held: {'core_keeper/egg-core-keeper.json': 'Unverified worldMode, seed encoding and empty-password semantics. Candidate remains staged; no canonical integration.'},
  native_acceptance: 'No game acquired or started. Existing isolated panel PID 52408 remains on old source. Automatic approval review rejected updated activation with blocked by policy. No retry.',
  limitations: ['ASKA secure publisher remains mocked in its shared-configure fixture; Astro uses actual secure publisher on Linux.', 'Avorion dynamic galaxy settings discovery remains unimplemented.', 'Aloft launch-token settings still lack shared stopped-only Game settings controls.', 'All five native gates remain incomplete.'],
};
fs.writeFileSync('artifacts/game-parity-20261029/wave2-root-integration.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({integrated_games: report.integrated_games.length, exact_helpers: checks.length, complete: false}));
