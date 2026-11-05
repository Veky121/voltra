import fs from 'node:fs';
import crypto from 'node:crypto';
const dir='.local/game-parity-20261029/clonehero-root-probe';
const state=JSON.parse(fs.readFileSync(dir+'/state.json'));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const file='artifacts/game-parity-20261029/clonehero-wave4-native.json';
const records=state.captures.baseline.records;
const report={
 at:new Date().toISOString(),recipe:state.lease.game,server_uuid:state.server.uuid,
 boundary:'Real isolated Windows Docker Desktop Linux engine native server probe; no player, client, song or Redis service acceptance',
 runtime:{initial_install:{pid:state.runtime.pid,binary_sha256:state.runtime.binary_sha256,source_fingerprint:state.runtime.source_fingerprint},current:{pid:state.latest_runtime.pid,binary_sha256:state.latest_runtime.binary_sha256,source_fingerprint:state.latest_runtime.source_fingerprint,snapshot_inputs_verified:state.latest_runtime.source.inputs_verified},transition:'Root coordinated backend activation preserved owned offline fixture, lease and containers; native API edit evidence belongs to the current receipt'},
 lease:{lease_id:state.lease.lease_id,owner:state.lease.owner,memory_mib:512,disk_mib:2048,ports:state.lease.ports},
 installation:{...state.install_outcome,installer_native_exit:Number(fs.readFileSync(dir+'/installer-wait.txt','utf8').trim()),resource_proof:state.installer_proof,observers:state.installer_observers,slot_released:state.installer_slot_released,publisher:state.publisher},
 installed_helpers:state.helper_proof,
 native_settings:{path:'clone/settings.ini',bytes:state.captures.baseline.bytes,sha256:state.captures.baseline.sha256,fields:records,field_count:records.length,cli_second_capture_sha256:state.captures['cli-second'].sha256,interpretation:'These are literal generated values, not verified complete domains. 0/1 values remain observed numbers; no boolean/enumeration semantics invented. Server name, password and bind port remain original Startup/allocated controls.'},
 precedence:state.precedence,
 typed_native_api:state.typed_roundtrip||null,
 native_numeric_security:state.settings_security||null,
 nonadmin_permissions:state.permissions?{...state.permissions,reader_and_subuser_removed:state.reader?.user_removed===true&&state.reader?.subuser_removed===true}:null,
 unexpected_native_exit:state.unexpected?{...state.unexpected,manual_recovery_ready:!!state.captures['crash-recovery'],recovery_settings_sha256:state.captures['crash-recovery']?.sha256,scope_limit:'Current frozen helpers preserve SIGKILL as247 and resources offline; pending shared nonzero-exit diagnostics are not claimed served.'}:null,
 browser_acceptance:{evidence:'artifacts/game-parity-20261029/native-ui-current.json',scope:'Root-owned real served headless Edge settings14/14 and console DOM onPID44664; no duplicate browser work'},
 operator_seed:state.operator_seed||null,
 preservation_snapshots:state.snapshots||{},
 reinstall:state.reinstall_outcome?{request:state.reinstall_request,resource_proof:state.reinstall_proof,outcome:state.reinstall_outcome,preservation:state.reinstall_preservation}:null,
 explicit_restart:state.restart||null,
 lifecycle:{ready_runs:Object.keys(state.captures).length,initial_requested_stops:2,later_requested_stop_history:state.stop_history||[],current_state:state.stop_observation.current_state,last_native_stop:state.stop_native,diagnostic_wrapper:state.diagnostics||null,stop_limitation:'Observed raw child -SIGINT(-2), ready true and requested-stop true, becomes Docker254 through unchanged sys.exit. No exit remapping, shared supervisor change or unrequested-crash normalization. Canonical startup restored. Full lifecycle still partial.'},
 profile:{file:'artifacts/game-parity-20261029/clonehero-wave4-profile.json',sha256:digest(fs.readFileSync('artifacts/game-parity-20261029/clonehero-wave4-profile.json')),change:'Only relative native discovery path clone/settings.ini; original4 ordered controls/defaults/permissions and all other profile bytes retained',metadata_tests:'3/3 passed after refresh against current canonical'},
 gates:{install:{status:'partial',verified:'Canonical cached public archive installs0 and reinstalls0 with actual readiness, original native binary retained',remaining:'Alternate version/update acceptance'},setup:{status:'partial',verified:'Original Startup name controls real native name; lease allocation29108 logged; nonadmin mutation403',remaining:'Browser creation and external forwarding acceptance'},console:{status:'partial',verified:'Real readiness/colored native logs, root browser console DOM, accurate offline resource state; requested-SIGINT254 and unexpected-SIGKILL247 observed separately',remaining:'Pending shared nonzero diagnostics are not served; external/player connectivity'},settings:{status:'partial',verified:'Generated14 fields; served typed14-field API and root browser DOM, secret hidden,13 nonsecret values submitted, sole maxplayers4to5 byte delta, stale409, injection422, reboot/reinstall preservation and nonadmin403',remaining:'Gameplay effect and numeric flag domains'},lifecycle:{status:'partial',verified:'Real ready starts, requested stops, fresh-process restart, reinstall preservation, controlled unexpected native247/offline and recovery; nonadmin403; owned resources cleaned',remaining:'Player/connectivity and alternate-version acceptance'}},
 cleanup:state.cleanup||{status:'retained-offline',reason:'Root explicitly retained owned fixture for typed/native API and cached reinstall acceptance'},
 evidence:{state:dir+'/state.json',baseline_ini:dir+'/baseline-settings.ini',second_ini:dir+'/cli-second-settings.ini',baseline_log:dir+'/baseline-native.log',second_log:dir+'/cli-second-native.log',installer_log:dir+'/installer.log',installer_exit:dir+'/installer-wait.txt'},
 root_next_action:'Requested remaining native checks and cleanup complete. Root controls reviewed-gate reconciliation and shared diagnostic integration. Keep remaining gameplay/domain/alternate-version boundaries explicit; no game-local diagnostic wrapper should merge.'
};
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:file,fields:records.length,full_parity:false,cleaned:!!state.cleanup}));
