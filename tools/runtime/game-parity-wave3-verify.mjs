import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const profiles = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const entries = [
  ['Archean/egg-archean.json', 'archean-file-authority.py', 'archean_parity_wave3.py'],
  ['barotrauma/egg-barotrauma.json', 'barotrauma-file-authority.py', 'barotrauma_file_authority.py'],
  ['brickadia/egg-brickadia.json', 'brickadia-file-authority.py', 'brickadia_parity_wave3.py'],
  ...['assetto_corsa/egg-assetto-corsa.json', 'assetto_corsa/egg-assetto-corsa--freeroam--a-i.json'].flatMap(recipe => [
    [recipe, 'assetto-native-authority.py', 'assetto-native-authority.py'],
    [recipe, 'assetto-ams-native.py', 'assetto-ams-native.py'],
  ]),
  ['automobilista2/egg-automobilista2.json', 'assetto-ams-native.py', 'assetto-ams-native.py'],
];
const normalize = text => text.replaceAll('\r\n', '\n').trimEnd();
const helpers = entries.map(([recipe, file, installed]) => {
  const source = fs.readFileSync('internal/panel/game_library/scripts/' + file, 'utf8');
  const script = profiles[recipe].egg.scripts.installation.script.replaceAll('\r\n', '\n');
  const header = script.split('\n').find(line => line.startsWith(`cat > .voltra/${installed} <<'`));
  assert.ok(header, `Missing ${recipe} ${installed}`);
  const delimiter = header.match(/<<'([^']+)'$/)?.[1];
  assert.ok(delimiter);
  const content = script.slice(script.indexOf(header) + header.length + 1).split('\n' + delimiter + '\n')[0];
  assert.equal(normalize(content), normalize(source), `Stale helper ${recipe} ${file}`);
  return {recipe, source: 'internal/panel/game_library/scripts/' + file, installed, sha256: createHash('sha256').update(source).digest('hex')};
});
const report = {
  scope: 'wave 3 source integration; all native gates remain incomplete', complete: false,
  integrated_profiles: [...new Set([...helpers.map(helper => helper.recipe), 'colony_survival/egg-colony-survival.json', 'conan_exiles/egg-conan-exiles.json', 'conan_exiles/egg-conan-exiles-enhanced.json'])],
  managed_bridge_fix: '7 Days Telnet connection fields are locked to launcher/client Runtime authority.',
  helpers,
  validation: {linux_fixtures: 57, memory_mib: 256, cpus: 1, network: 'none', mount: 'source read-only, temporary exec mount for stand-in display fixture', go_vet: 'passed', focused_postgres_tests: 'passed, including Barotrauma API typed values/masking/byte roundtrip', conan_and_ledger_node_tests: 7},
  fixture_limitations: ['Brickadia publisher is mocked; this suite does not prove its secure publisher.', 'Barotrauma shared XML publication is mocked in its repeated configure fixture; API byte-span patching uses an actual isolated database and simulated Wings.', 'Assetto Linux fixtures use the shared secure byte publisher.', 'Display lifecycle uses temporary Python stand-ins, not Wine/gameplay. Initial noexec mount failure was environmental; executable tmpfs rerun passed.'],
  held: {'avorion/egg-avorion.json':'Historical manifest proves galaxy path only. Exact startup-shadowed INI keys still need primary/native evidence before exposing a misleading writable editor.'},
  remaining: ['AMS2 colon-format typed editor remains unimplemented.', 'Conan runtime exact-case writer needs separate reconciliation against native casing; managed fields are protected in editor.', 'Native install, console colors/lifecycle, full UI, settings readback, saves/reinstall, permissions, protocol and player acceptance still require real campaign runs.'],
  ledger_correction: 'Managed bridge source discovery and scoped DDRace parser coverage are partial source evidence, not unknown or native verification.',
  runtime: 'No panel activation/restart or game acquisition/start. Automatic approval rejected updated campaign panel activation with blocked by policy; no retry or workaround.',
};
fs.writeFileSync('artifacts/game-parity-20261029/wave3-root-integration.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({integrated_profiles: report.integrated_profiles.length, exact_helper_checks: helpers.length, managed_bridge_fixes: 1, complete: false}));
