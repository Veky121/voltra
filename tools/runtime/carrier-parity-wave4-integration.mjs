import fs from 'node:fs';
import crypto from 'node:crypto';

const fingerprint = path => ({path, sha256: crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')});
const report = {
  scope: 'canonical Carrier implementation and parser; root shared integration remains pending',
  complete: false,
  files: ['internal/panel/game_library/scripts/carrier-file-authority.py', 'internal/panel/game_settings_carrier.go', 'internal/panel/game_settings_carrier_test.go', 'tools/runtime/carrier-parity-wave4-test.py', 'tools/runtime/carrier-parity-wave4-stage.mjs'].map(fingerprint),
  checks: {
    linux: {engine: 'desktop-linux npipe:////./pipe/dockerDesktopLinuxEngine', network: 'none', memory_mib: 256, swap_extra_mib: 0, cpus: 1, source_mount: 'readonly', carrier_tests: 10, cube_tests: 8, existing_vehicle_tests: 14, existing_cube_tests: 19, total: 51},
    go: 'Carrier and Barotrauma focused parser tests passed 1.513s',
    fragments: 'Three-profile merge dry run passed; Carrier18 AssaultCube10 Sauerbraten7 original ordered controls preserved',
  },
  discovery: {
    settings_documents: ['server_config.xml'],
    format_location: 'gameSettingsDiscoveryFormat',
    format_branch: 'if nativeSettingsIsRecipe(egg, "carrier_command_2/egg-carrier-command2.json") && file == carrierSettingsPath { return "xml" }',
    parser_location: 'parseGameSettingsForEgg',
    parser_branch: 'if file == carrierSettingsPath && nativeSettingsIsRecipe(egg, "carrier_command_2/egg-carrier-command2.json") { return parseCarrierGameSettings(data) }',
  },
  runtime_port: 'port omitted from writable fields; parser rejects direct port patches and opaque game_data_path, permissions and mods. Exact dispatch is required.',
  limitations: [
    'No shared dispatch, global overrides, frontend, runtime restart or game acquisition/start changed.',
    'Source-backed typed schema and byte preservation do not prove native values or publisher gameplay/save capability.',
    'Publisher no-save-writing limitation retained.',
    'Backup/config publication is not a cross-file crash-atomic transaction.',
  ],
};
fs.writeFileSync('artifacts/game-parity-20261029/carrier-wave4-integration.json', JSON.stringify(report, null, 2) + '\n');
const cube = {
  scope: 'canonical shared Cube preflight implemented; root profile merge remains pending', complete: false,
  files: ['internal/panel/game_library/scripts/cube-preflight.py', 'tools/runtime/cube-parity-wave5-test.py', 'tools/runtime/cube-parity-wave5-stage.mjs'].map(fingerprint),
  checks: report.checks,
  settings_documents_added: false,
  remaining: 'Executable CFG stays Files-only; typed command grammar/native authority and native acceptance remain incomplete. Existing supervisor behavior is delegated unchanged.',
};
fs.writeFileSync('artifacts/game-parity-20261029/cube-wave5-integration.json', JSON.stringify(cube, null, 2) + '\n');
console.log('Saved exact-source integration receipts for Carrier and both Cube variants.');
