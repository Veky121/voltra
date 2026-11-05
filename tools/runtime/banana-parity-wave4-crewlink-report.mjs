import fs from 'node:fs';
import path from 'node:path';
import {runtime,digest} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'banana-wave4-crewlink'),state=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
const history=JSON.parse(fs.readFileSync(path.join(dir,'panel-console.json')));
const gaps=history.data.filter(row=>row.event==='panel message'&&row.line.includes('capture reconnected')).map(row=>({at:row.created_at,line:row.line.replace(/\u001b\[[0-9;]*m/g,'')}));
const ui='artifacts/game-parity-20261029/native-ui-crewlink.json';
const report={
 recipe:state.lease.game,scope:'Isolated Windows Docker native server and real Socket.IO protocol; player-client/audio and public reachability remain separate',
 complete:false,native_server_core_complete:true,
 source:{helper:'internal/panel/game_library/scripts/crewlink-controls.py',helper_sha256:state.helper_proof.find(row=>row.file==='.voltra/crewlink-controls.py').sha256,publisher:'https://github.com/OhMyGuus/BetterCrewLink-server',publisher_commit:'0e1d4b12e7a7201cda4db723d08d57baa5549432'},
 runtimes:{native_lifecycle:{pid:state.runtime.pid,sha256:state.runtime.binary_sha256},final_planning:state.fixed_planning.runtime},
 resources:{lease_memory_mib:512,lease_disk_mib:4096,cpu_percent:100,extra_swap_mib:0,actual_game_cgroups:state.native_metadata,installers:state.installers.map(row=>({at:row.at,proof:row.proof,cgroup:row.cgroup,actual_exit_code:row.actual_wait_code,oom_observed:row.oom_observed,attached_before_release:row.attached_before_release,log:row.log,wait:row.wait}))},
 gates:{
  install:{status:'pass',evidence:'Pinned public source/runtime install and cached reinstall both returned actual exit0/installed1. Six deployed helpers match served source. Native HTTP health and two real signaling clients succeeded.'},
  setup:{status:'pass',scope:'Default pinned service and declared listener planning',evidence:'All eight original ordered controls/defaults/permissions preserved. Native default name and blank PORT worked. Root application harness reports API200 and12/12 native fields in DOM. Live011fa planning accepts exact29191 as one primary and rejects occupied/noncanonical choices.',ui_receipt:fs.existsSync(ui)?ui:null,planning:'artifacts/game-parity-20261029/banana-wave4-crewlink-planning-fixed.json'},
  console:{status:'pass',evidence:'Authenticated panel console captured actual starting/running/stopping/offline and controlled-crash status events; native and retained panel ANSI colors observed. Graceful stops exited0; controlled native SIGKILL exited137 with OOMKilledfalse.',actions:state.actions.map(({signal,at,accepted,statuses,console_authenticated,log})=>({signal,at,accepted,statuses,console_authenticated,log})),capture_gaps:gaps,continuity:'One disclosed5s close1006 reconnect gap; uninterrupted archive coverage is not claimed.'},
  settings:{status:'pass',evidence:'Seeded native YAML has12 typed fields, managed TURN controls readonly, password masked, mode0600. Running/stale edits409, managed write422, readerGET200/write403. Native forceRelayOnly edit reached subsequent clientPeerConfig; generic YAML formatting normalization recorded while other values/credential stayed intact.',guards:state.guards,running_guard:state.running_guard,permissions:state.permissions,checkpoint:state.checkpoint,post_reinstall:state.reinstall_preservation},
  lifecycle:{status:'pass',scope:'Native server operations and actual Socket.IO client protocol; not Among Us voice/audio/gameplay',evidence:'Start/stop/restart, controlled crash/recovery, source/runtime/native config/operator file preservation across cached reinstall, and two-client join/signal/disconnect succeeded. HTTP and scoped-CA HTTPS/TLS1.3 passed, including original nonempty HTTPS=false semantics; original empty HTTPS/SSLPATH restored.',protocol:state.protocol,crash:{signal:state.crash.signal,state:state.crash.container_state,power:state.crash.power.current_state},tls:state.tls.proof,restored_tls_environment:state.tls.original_environment,nine_file_preservation:state.reinstall_preservation}
 },
 boundaries:{player_client_voice_audio:false,gameplay:false,external_reachability:false,node_bind_capability:'Current planning response explicitly says unavailable; actual owned29100 bind and local protocol succeeded',custom_branches:'Unproven source is never seeded with guessed pinned defaults; native acceptance covered the default pinned source only',tls:'Disposable local fixture certificate trusted explicitly per request; certificate validation remained enabled and system trust was unchanged. Private key stayed only in the removed owned volume.',ui:'Root-owned domain-locked application harness; child stopped native desktop/browser work after a policy URL-confidence stop. No form submitted by child.'},
 cleanup:JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/banana-wave4-crewlink-cleanup.json')),
 offline:'artifacts/game-parity-20261029/banana-wave4-crewlink-offline.json',port_fix:'artifacts/game-parity-20261029/banana-wave4-crewlink-port-fix.json',
 private_evidence:dir,
 harness_correction:'First TLS probe accessed response.socket after end, when Node had released it. Harness now captures TLS details on response; corrected probe passed with certificate validation enabled. This was not a native server failure.'
};
if(!state.lease_released||state.lease.status!=='tested'||!state.fixed_planning||!state.reinstall_preservation.exact)throw Error('Final ownership/planning/preservation proof incomplete');
if(fs.existsSync(ui))report.gates.setup.ui_sha256=digest(fs.readFileSync(ui));
const target='artifacts/game-parity-20261029/banana-wave4-crewlink-native.json';fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:target,server_core_complete:true,full_player_or_internet_acceptance:false,gates:Object.fromEntries(Object.entries(report.gates).map(([key,value])=>[key,value.status])),cleanup:report.cleanup.lease_outcome}));
