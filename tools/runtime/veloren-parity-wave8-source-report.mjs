import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const out='artifacts/game-parity-20261029/';
const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const titles=[['veloren/egg-veloren.json','veloren-wave8'],['openra/openra_red_alert/egg-open-r-a.json','openra-wave8']];
for(const [recipe,prefix] of titles){
  const profile=canonical[recipe];assert(profile?.egg?.variables);
  const fragment={[recipe]:structuredClone(profile)};
  fs.writeFileSync(out+prefix+'-profile.json',JSON.stringify(fragment,null,2)+'\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(out+prefix+'-profile.json'))[recipe],profile);
  const tests=JSON.parse(fs.readFileSync(out+prefix+'-source-tests.json'));
  assert.equal(tests.exit_code,0);
  const veloren=recipe.startsWith('veloren/');
  const report={at:new Date().toISOString(),recipe,stage:prefix+'-profile.json',profile_sha256:crypto.createHash('sha256').update(JSON.stringify(profile)).digest('hex'),profile_boundary:'Exact canonical snapshot. No settings discovery or verification promotion; historical verification metadata retained byte-for-value.',ordered_controls:profile.egg.variables.map(v=>v.env_variable),all_defaults_permissions_metadata_preserved:true,tests,
    shared_components_preserved:veloren?['Existing Rust RON bridge','veloren-runtime.py','veloren-install.py','canonical overrides','Go settings backend']:['openra-family.py','native-release.py','small-native-install.py','canonical overrides','shared UI'],
    native_admission:'Not claimed; coordinator holds admission. No Docker, acquisition or fixture in this wave.',
    five_gates:{install_start:'not_run_this_wave',setup:'source_controls_preserved_native_pending',console_lifecycle:'native_pending',typed_settings:veloren?'source_proposal_only_no_backend_support':'partial_MiniYaml_is_not_generic_YAML',verification:'native_permissions_persistence_protocol_pending'},
    sources:veloren?['.local/veloren/pinned-settings.rs','.local/veloren/pinned-cli-settings.rs','.local/game-parity-20261029/veloren-root-native/publisher-source/weekly-current.json']:['https://github.com/OpenRA/OpenRA/wiki/Dedicated-Server','https://github.com/OpenRA/OpenRA/wiki/AppImages','https://raw.githubusercontent.com/OpenRA/OpenRA/release-20250330/launch-dedicated.sh'],
    limitations:veloren?['Actual pinned-build generated RON sample still pending native admission.','No backend parser or metadata integration proposed as working.','The existing installer does not consume a fresh cached archive; do not forge install receipts to bypass canonical acquisition.']:['Only Red Alert selected; cnc/d2k variants remain separate.','MiniYaml requires format-specific handling. Runtime command-line fields override native file values; do not expose them as independently editable.','No publisher terms were accepted; stop and review any actual installer/runtime gate.','Compatible client/gameplay, external reachability and original commercial client assets remain untested.']};
  fs.writeFileSync(out+prefix+'-source.json',JSON.stringify(report,null,2)+'\n');
  console.log(prefix+': exact '+profile.egg.variables.length+'-control snapshot; source tests '+tests.test_count+' passed; no native claims');
}
