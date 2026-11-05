import fs from 'node:fs';import path from 'node:path';
const dir=path.resolve('.local/game-parity-20261029/runtime/tachyon-native'),s=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
const readExit=file=>file&&fs.existsSync(file)?fs.readFileSync(file,'utf8').trim():null;
const clientFile=fs.readdirSync(dir).filter(x=>/^client-\d+\.json$/.test(x)).sort().at(-1);
let client;if(clientFile){const capture=JSON.parse(fs.readFileSync(path.join(dir,clientFile)));const completed=capture.output.split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x)).find(x=>x.stage==='complete');client={capture:path.join(dir,clientFile),matching_publisher_jar_sha256:'a2c45c3c334b883ede37371553e7c3a4aa8b2c29c08e14dd06e8819a431e03d3',native_client_exit:completed?.client_exit_before_cleanup,client_cleaned:completed?.client_cleaned,display_cleaned:completed?.display_cleaned,native_config_unchanged:completed?.native_config_unchanged,player_authenticated:false,gameplay:false,blocker:completed?.client_log_tail.includes('libXtst.so.6')?'Graphical client requires libXtst.so.6, absent from the existing headless runtime. No dependency installed.':null};}
const report={at:new Date().toISOString(),recipe:s.lease.game,status:s.cleanup?.lease_released?'native-reviewed-with-explicit-boundaries':'native-in-progress',complete:false,
 runtime:{backend:s.fixture?.runtime.binary_sha256,snapshot:s.fixture?.runtime.snapshot,engine:'Windows Docker Desktop desktop-linux named pipe'},
 fixture:{uuid:s.fixture?.server.uuid,lease_id:s.lease.lease_id,memory_mib:1024,swap_mib:0,cpu_percent:100,port:s.lease.ports[0]},
 source_reports:['artifacts/game-parity-20261029/tachyon-wave6-offline.json','artifacts/game-parity-20261029/tachyon-wave6-settings.json','artifacts/game-parity-20261029/tachyon-wave6-publisher-parser.json'],
 profile_proof:s.profile_proof,installed_helper_hashes:s.helpers,install:{outcome:s.install_outcome,actual_exit:s.installer_exit,actual_limits:s.installer,pre_gate_capture:s.installer_capture,publisher_receipts:s.publisher_receipts},
 lifecycle:s.lifecycle?.map(x=>({at:x.at,power:x.power,container:x.native?.id,running:x.native?.state.Running,raw_exit:x.native?.state.ExitCode,oom:x.native?.state.OOMKilled})),
 requested_power_results:s.power_waits?.map(x=>({...x,actual_exit:readExit(x.wait)})),
 normal_shutdown_contract:'Unchanged pinned e.bE() logs Game server stopped then System.exit(1); requested raw1/WARN/offline is preserved and distinguished from unexpected exit.',
 typed:s.typed_roundtrip,publisher_parser_readback:s.publisher_parser_probe,protocol:s.protocol,
 permissions_report:'artifacts/game-parity-20261029/tachyon-wave6-native-permissions.json',
 preservation:{baseline:s.preservation,checks:s.preservation_checks},reinstall:s.reinstall,
 controlled_crash:s.controlled_crash?{...s.controlled_crash,actual_exit:readExit(s.controlled_crash.wait)}:null,
 cleanup:s.cleanup,client,crash_recovery:s.crash_recovery,
 retained_console_logs:{requested_final_stop:path.join(dir,'final-native.log'),controlled_crash:path.join(dir,'controlled-crash.log')},
 five_gates:[{gate:1,status:s.install_outcome?.success&&s.installer_exit==='0'?'native-pass':'pending'},
 {gate:2,status:'original VERSION control preserved and actual default resources/port used; shared creation-browser boundary belongs to root'},
 {gate:3,status:s.controlled_crash?'native lifecycle and controlled crash observed; root browser evidence separate':'native readiness/console/requested stop/restart observed; crash pending'},
 {gate:4,status:s.typed_roundtrip?'native HTTP typed spans/permissions plus unchanged publisher parser verified; root browser evidence separate':'pending'},
 {gate:5,status:s.cleanup?.lease_released?'native actions completed within explicit protocol/player boundaries':'preservation reinstall/player/crash/cleanup pending'}],
 remaining:['External forwarding and remote Internet reachability not tested','A TCP registration greeting does not authenticate a player or prove gameplay; the attempted graphical client exited1 at missing libXtst.so.6, then its processes/display were cleaned','Automatic crash restart is disabled by the isolated campaign policy; manual recovery after the controlled crash was verified','Standalone publisher-parser readback is a separate process, paired with real server boot/reload; it does not inspect live server memory','Tachyon-specific settings/console browser DOM was not captured by this lane; root shared browser evidence is separate'],
 no_shared_or_canonical_edits_during_native:true};
fs.writeFileSync('artifacts/game-parity-20261029/tachyon-wave6-native-progress.json',JSON.stringify(report,null,2)+'\n');
if(s.cleanup?.lease_released)fs.writeFileSync('artifacts/game-parity-20261029/tachyon-wave6-native-final.json',JSON.stringify(report,null,2)+'\n');
const lane=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/tachyon-wave6.json'));lane.status=report.status;lane.actual_native_game_download=!!s.install_outcome?.success;lane.actual_native_game_start=!!s.lifecycle?.some(x=>x.power==='running');lane.native_report='artifacts/game-parity-20261029/tachyon-wave6-native-progress.json';fs.writeFileSync('artifacts/game-parity-20261029/tachyon-wave6.json',JSON.stringify(lane,null,2)+'\n');
console.log(JSON.stringify({status:report.status,install_exit:s.installer_exit,typed:!!s.typed_roundtrip,world_files:s.preservation?.files.length,reinstall:!!s.reinstall?.outcome?.success,lease_released:!!s.cleanup?.lease_released}));
