import fs from 'node:fs';
const dir='.local/game-parity-20261029/cryofall-native';
const s=JSON.parse(fs.readFileSync(dir+'/state.json'));
const events=fs.readFileSync(dir+'/events.jsonl','utf8').trim().split('\n').map(x=>JSON.parse(x));
const consoleProof=JSON.parse(fs.readFileSync(dir+'/console-proof.json'));
const before=s.snapshots?.[3],after=s.reinstall_snapshot_index?s.snapshots[s.reinstall_snapshot_index-1]:null;
const report={
 generated_at:new Date().toISOString(),recipe:'cryofall/egg-cryo-fall.json',completion:'partial native acceptance; player/gameplay and new shared diagnostics remain unverified',
 machine:'Windows Docker desktop-linux only; campaign panel18099/node1; no home-server access',
 runtime_receipts:[...(s.runtime_history||[]),s.runtime].map(r=>({pid:r.pid,binary_sha256:r.binary_sha256,snapshot:r.snapshot,source_fingerprint:r.source_fingerprint})),
 fixture:{server_id:s.fixture.server.id,uuid:s.fixture.server.uuid,egg_id:s.fixture.egg.id,node_id:1,lease_id:s.lease.lease_id,port:s.lease.ports[0],memory_mib:3072,cpu_percent:100,additional_swap_mib:0,cleaned:!!s.cleanup},
 source_recipe_sha256:s.profile_sha256,helper_hashes:s.helpers,install:{initial:s.install_history?.[0]??s.install_outcome,actual_installer_limits:s.installer_proof,cgroups:s.installer_cgroup,dotnet_cache:s.dotnet_cache,default_auto_update_boot:s.default_boot},
 lifecycle:{power_events:events.filter(x=>x.kind==='power'),observed_native_states:events.filter(x=>x.kind==='native-observation'),crash_injection:s.crash,clean_shutdowns:events.filter(x=>x.kind==='native-observation'&&x.state?.Status==='exited'&&x.state.ExitCode===0).length,raw_crash_status:events.find(x=>x.kind==='native-observation'&&x.state?.ExitCode===247)?.state??null,crash_recovery:'Actual publisher Save0 reload, typed name/player limit retained, then clean exit0; crash left Save0/backups hash-identical to precrash snapshot.'},
 console:{...consoleProof,scope:'Actual authenticated panel WebSocket and native ANSI/readiness/power status events; browser color rendering not measured by this lane.',crash_gap:'Frozen helper returns raw child negative status without explicit diagnostic; SIGKILL yielded container247 and paneloffline, noOOM or autorestart. Source diagnostic fix is separate stand-in evidence; no live promotion.'},
 settings:{file:'/Data/SettingsServer.xml',typed_controls:4,private_GUID_operators_security_listeners:'omitted',running_write:s.running_write,typed_write:s.roundtrip,persistence:s.persistence,permissions:s.permissions,format_boundary:'Typed editor preserves every unrelated byte and inserted comment. Actual shared configure retains comment but normalizes XML formatting. Publisher process subsequently rewrites XML and removes comment; native values persist. Whole-boot byte/comment preservation is not claimed.'},
 protocol:s.protocol,
 reinstall:{completed:!!after,before_snapshot:before?{files:before.files.length,sha256:before.sha256}:null,after_snapshot:after?{files:after.files.length,sha256:after.sha256}:null,proof:s.reinstall_preservation??null,post_reinstall_boot:s.post_reinstall_boot??null,installer_limits:s.reinstall_proof??null,terminal_events:s.reinstall_events?.filter(e=>['die','destroy'].includes(e.status)),log_boundary:'Installer auto-removed before late direct log fetch. Actual Docker die exit0 and panel installed1 retained; no full reinstall text-log capture claimed.'},
 five_gates:{working:'native installer/default boot/world generation and saved-world recovery verified; actual player unverified',setup:'original7 controls/defaults preserved, native template/ports APIs checked; full browser create/install flow not independently verified',console:'real ANSI/readiness/start/stop/offline verified; new explicit crash diagnostic not live',settings:'four native typed fields, stopped-only edits, revision rejection, managed-key rejection, real reader permissions and lifecycle values verified; publisher formatting/comment rewrite disclosed',lifecycle:'start/stop/restart/crash/recovery verified; reinstall proof recorded separately; client connectivity/gameplay unavailable'},
 cleanup:s.cleanup??null,
 root_next:'Review shared console diagnostic proposal and synchronize embeds during controlled root integration. Separate actual game-client/discovery forwarding and rendered console color acceptance. Do not mark all five gates complete from source tests.',
 private_evidence:dir,
 related_artifacts:['cryofall-wave4-console-exit.json','cryofall-wave4-console-profile.json','deadmatter-wave5-native-prerequisites.json']
};
const file='artifacts/game-parity-20261029/cryofall-wave4-native-final.json';
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file,cleaned:!!s.cleanup,reinstall:!!after,completion:report.completion}));
