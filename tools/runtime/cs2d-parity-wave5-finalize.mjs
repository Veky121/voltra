import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),dir=path.join(root,'.local/game-parity-20261029/runtime/cs2d-native');
const s=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
const clientFiles=fs.readdirSync(dir).filter(x=>/^client-proof-\d+\.json$/.test(x)).sort();
const clients=clientFiles.map(x=>({file:path.join(dir,x),...JSON.parse(fs.readFileSync(path.join(dir,x)))}));
const joined=clients.findLast(x=>x.server_evidence.some(line=>/^CS2D_CLIENT_CONNECTED\t1$/.test(line)));
if(!joined||!s.cleanup.lease_released||!s.reinstall.after.config_exact||!s.native_evidence.typed_engine)throw Error('Native final evidence incomplete');
const permissions=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/cs2d-wave5-native-permissions.json'));
const ui=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/native-ui-current.json'));
const rendered=ui.games.find(g=>g.owner==='cs2d_native');
const report={at:new Date().toISOString(),recipe:s.lease.game,status:'native-accepted-with-explicit-boundaries',all_gameplay_complete:false,
 runtime:{context:'desktop-linux',endpoint:'npipe:////./pipe/dockerDesktopLinuxEngine',installation_backend:s.fixture.runtime.binary_sha256,installation_snapshot:s.fixture.runtime.snapshot,typed_settings_backend:s.observed_runtime.binary_sha256},
 fixture:{uuid:s.fixture.server.uuid,server_id:s.fixture.server.id,lease_id:s.lease.lease_id,memory_mib:512,swap_mib:0,cpu_percent:100,port:s.lease.ports[0]},
 acquisition:{initial:'Exact pinned publisher archives seeded from verified local cache',fresh_reinstall:'Actual fresh public publisher download after only two exact owned cached hash paths moved to retained holding area',archives:s.assets,installer_exit:s.reinstall.exit,outcome:s.reinstall.outcome,actual_cgroups:s.reinstall.installer.cgroup,installer_wait_and_logs_attached_before_gate:s.reinstall.capture.attached_before_release},
 gates:[
 {gate:1,status:'native-pass',evidence:'Actual canonical installer and fresh publisher download exit0, installed1; all nine installed helpers exact served hashes'},
 {gate:2,status:'populated-and-native-used',evidence:'All nine ordered original setup variables/defaults/permissions preserved; real selected name,private mode,map,players,allocation used. Shared browser setup evidence belongs to root reports.'},
 {gate:3,status:'native-and-browser-pass',evidence:'Actual readiness marker, native Lua mailbox, redaction, cleanstop0/restart0, controlledSIGKILL247/APIoffline; root real console crash warning DOM',browser_report:'artifacts/game-parity-20261029/native-ui-current.json',rendered:!!rendered},
 {gate:4,status:'native-and-browser-pass',evidence:'Six typed CFG controls; real bool+number writes→native engine4/1; exact spans, stale409, managedcredential422, typedsecretmasked; root6/6DOM',typed:s.typed_roundtrip,native:s.native_evidence,permissions_report:'artifacts/game-parity-20261029/cs2d-wave5-native-permissions.json'},
 {gate:5,status:'native-pass-with-player-boundary',evidence:'Clean start/stop/restart, controlled crash, exact native-format config+customfile across fresh reinstall, nonadmin200/403/403/200; publisher UDP exactecho; matching graphical client connected as spectator/briefing',player_gameplay:false}
 ],
 helpers:s.helpers,secret_check:s.secret_check,native_newline_normalization:s.native_newline_normalization,
 preservation:{checks:s.preservation_checks,config_sha256:s.reinstall.after.config_sha256,custom_sha256:s.reinstall.after.custom_sha256,reinstall_exact:s.reinstall.after},
 protocol:s.ping,
 actual_client:{report:joined.file,screenshot:joined.screenshot,native_player_count:1,observation:'Actual matching graphical CS2D client shows server MapBriefing/default MOTD; server native count1 repeatedly. BOT_COUNT0. No team selection/movement/combat observed.',executable_content_unchanged:true,independent_stock_sys:true,client_and_display_cleaned:true,resource_limits_unchanged:true,initial_failed_attempts_retained:clients.filter(x=>x!==joined).map(x=>x.file)},
 permissions,controlled_crash:{...s.controlled_crash,observed_container_exit:fs.readFileSync(s.controlled_crash.wait,'utf8').trim()},restarts:s.restarts.map(x=>({...x,observed_previous_container_exit:fs.readFileSync(x.wait,'utf8').trim()})),cleanup:s.cleanup,
 lifecycle:s.lifecycle.map(x=>({at:x.at,power:x.power,container:x.native?.id,running:x.native?.state.Running,exit:x.native?.state.ExitCode,oom:x.native?.state.OOMKilled})),
 remaining:['External/public forwarding and remote Internet client reachability were not tested','No team selection, movement or combat gameplay acceptance','Automatic crash restart was disabled by campaign policy; controlled crash and manual recovery were exercised','Creation form field rendering and real starting/stopping transition colors depend on root shared UI acceptance; actual current settings and console DOM captured separately','CS2D itself normalized one manually added mixed-newline test fixture; original red evidence preserved, subsequent native-CRLF bytes stable'],
 changed_source:'No shared/runtime helper fixes were required by this native run; canonical cs2d-preflight.py remains served as integrated by root',
 evidence_boundary:'No synthetic console events, bot as player substitution, executable binary patches, private accounts or production/home-server actions'};
fs.writeFileSync('artifacts/game-parity-20261029/cs2d-wave5-native-final.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,client_count:1,lease_released:s.cleanup.lease_released,report:'artifacts/game-parity-20261029/cs2d-wave5-native-final.json'}));
