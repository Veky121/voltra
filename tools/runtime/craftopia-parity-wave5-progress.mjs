import fs from 'node:fs';
import path from 'node:path';
import {runtime,api,digest,verifyRuntime,activeLease,observePower} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'craftopia-wave5-native'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file));
const current=await verifyRuntime(),lease=activeLease(s.lease.lease_id,'craftopia_native_wave5'),server=(await api('/api/application/servers/'+s.fixture.server.id)).attributes;
if(lease.memory_mib!==8192||lease.disk_mib!==32768||server.limits.memory!==8192||server.limits.disk!==32768||server.limits.swap!==0||server.limits.cpu!==100)throw Error('Approved queue/API resource phase mismatch');
if(s.lease.disk_mib!==lease.disk_mib){s.original_pilot_lease??=s.lease;s.resource_events??=[];s.resource_events.push({at:new Date().toISOString(),kind:'explicit_root_reviewed_stopped_disk_increase',from_disk_mib:s.lease.disk_mib,to_disk_mib:lease.disk_mib,receipt:'artifacts/game-parity-20261029/craftopia-wave5-disk32-change.json'});s.lease=lease;}
const power=await observePower(s.fixture),baseline=JSON.parse(fs.readFileSync(s.snapshots.baseline.file));
const report={
 at:new Date().toISOString(),recipe:'craftopia/egg-craftopia.json',boundary:'Native progress only; no game completion or graphical/WAN claim.',
 environment:'windows-docker-desktop-linux-local-npipe',runtime:{pid:current.pid,binary_sha256:current.binary_sha256},
 fixture:{server_id:server.id,uuid:server.uuid,node:1,egg:s.fixture.egg.id,nest:s.fixture.nest.id,lease_id:lease.lease_id,owner:lease.owner,ports:lease.ports},
 installer:{receipt:'artifacts/game-parity-20261029/craftopia-wave5-installer.json',actual_wait:s.actual_installer_wait,installed:1,status:null,app_id:1670340,build:24921505,initial_pilot:{memory_mib:8192,disk_mib:16384},installed_bytes:s.installed_disk.bytes},
 genuine_first_ready:{marker:'World is loaded!',observed:s.first_boot.outcome==='ready',scope:'Initial8GiB/16GiB pilot with actual defaultAUTO_UPDATE1; not catalog4GiB acceptance.',resource_proof:s.first_boot.resource_proof,panel_ready_memory_bytes:4507398144,cgroup_anon_bytes:4626894848,old_catalog4gib_bytes:4294967296,raw_memory_evidence:'.local/game-parity-20261029/runtime/craftopia-wave5-native/first-ready-resources.txt'},
 current_resource_phase:{memory_mib:8192,disk_mib:32768,extra_swap:0,cpu:100,explicit_disk_change_receipt:'artifacts/game-parity-20261029/craftopia-wave5-disk32-change.json',current_state:power.current_state},
 default_RAM_repair:{root_accepted:true,tested_safe_gib:8,measured_minimum:false,original_disk_mib:32768,original_six_variables_preserved:true,receipt:'artifacts/game-parity-20261029/craftopia-wave5-default-memory.json'},
 updater:{first_default1_attempt_completed:true,canonical_startup_restored_sha256:s.first_boot.restored_startup_sha256,subsequent_cycles_AUTO_UPDATE:'0',exclusive_slot_released:s.slot_released},
 normal_stop:s.actions?.filter(a=>a.signal==='stop').at(-1),
 settings:{file:'/ServerSetting.ini',fields:s.settings.fields.length,typed_switches:s.settings.bits.length,boolean_edit:s.bit_edit,guards:s.guards,permissions:s.permissions},
 stopped_preservation_baseline:{files:baseline.files.length,databases:baseline.databases.length,all_integrity_ok:baseline.databases.every(d=>d.integrity==='ok'),no_wal:baseline.databases.every(d=>d.wal_present===false),active_world:'DedicatedServerSave/Worlds/9kxpnk2fb887.db',receipt:'.local/game-parity-20261029/runtime/craftopia-wave5-native/snapshot-baseline.json',sha256:s.snapshots.baseline.sha256,identity_receipt:s.world_identity?.baseline},
 preservation_disk_bound:{receipt:'artifacts/game-parity-20261029/craftopia-wave5-reinstall-disk-bound.json',bytes:24564004207,fits_original_catalog32GiB:true,fresh_metadata_required_before_reinstall:true},
 canonical_preservation_reinstall:s.preservation_installer?{actual_wait:s.preservation_installer.actual_wait,installed:s.preservation_installer.installed,resources:s.preservation_installer.resource_phase,cgroup:s.preservation_installer.proof.cgroup,logs_and_wait_attached_before_release:s.preservation_installer.capture.attached_before_release,slot_released:s.preservation_installer.slot_released,strict_snapshot:s.preservation_installer.snapshot,exact_files:24,sqlite_integrity_ok:10,fresh_public_metadata:'artifacts/game-parity-20261029/craftopia-wave5-fresh-metadata.json'}:null,
 remaining:['Native subsequent start/stop/restart and actual saved-world identity reload under explicit8GiB/32GiB phase.','Controlled actual crash/error/offline/recovery evidence.','Safe root-owned UI acceptance; paid-client game handshake/gameplay and WAN remain separately unverified.'],
 no_duplicate_claim_or_fixture:true,complete:false,
};
fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');const output='artifacts/game-parity-20261029/craftopia-wave5-native-progress.json';fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:output,sha256:digest(fs.readFileSync(output)),state:power.current_state,resource_phase:report.current_resource_phase}));
