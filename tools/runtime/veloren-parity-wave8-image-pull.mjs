import fs from 'node:fs';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {verifyRuntime,activeLease,acquireInstaller,releaseInstaller,releaseNative,docker} from './campaign-native-20261029.mjs';
if(!process.argv.includes('--coordinator-image-acquisition-go'))throw Error('Explicit image acquisition turn required');
const dir='.local/game-parity-20261029/veloren-root-native',file=dir+'/rust-image-state.json',state=JSON.parse(fs.readFileSync(file)),save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
activeLease(state.lease.lease_id,state.lease.owner);state.latest_runtime=await verifyRuntime();save();
const resume=process.argv.includes('--resume-post-pull-proof');
if(state.provisioned||state.lease.memory_mib!==1024||state.lease.disk_mib!==8192||state.lease.ports.length!==0||state.proof.platform!=='linux/amd64'||(state.slot&&!resume)||(resume&&(!state.slot||state.pull_exit!==0)))throw Error('Fresh exact bounded utility state or successful preserved pull required');
const image='docker.io/library/rust@'+state.proof.platform_manifest_digest;
if(!/^docker.io\/library\/rust@sha256:[a-f0-9]{64}$/.test(image))throw Error('Reviewed immutable official image identity required');
if(!resume){
state.slot=acquireInstaller(state.lease.lease_id,state.lease.owner);state.pull_started=new Date().toISOString();save();
const log=fs.openSync(dir+'/rust-image-pull.log','a');
const exit=await new Promise((resolve,reject)=>{const child=spawn('docker',['--context','desktop-linux','pull','--platform','linux/amd64',image],{windowsHide:true,stdio:['ignore',log,log]});state.pull_pid=child.pid;save();child.on('error',reject);child.on('exit',resolve);});fs.closeSync(log);
state.pull_exit=exit;state.pull_finished=new Date().toISOString();save();if(exit!==0)throw Error('Official image pull failed; preserve utility/slot evidence');
}
const inspected=JSON.parse(docker(['image','inspect',image,'--format','{{json .}}']));
if(inspected.Os!=='linux'||inspected.Architecture!=='amd64'||![state.proof.config_digest,state.proof.platform_manifest_digest].includes(inspected.Id)||inspected.Descriptor?.digest!==state.proof.platform_manifest_digest||!inspected.RepoDigests.some(x=>x.endsWith('@'+state.proof.platform_manifest_digest)))throw Error('Official pulled image platform/manifest/RepoDigest mismatch');
const auth=await fetch('https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/rust:pull');if(!auth.ok)throw Error('Official config authorization unavailable');const token=(await auth.json()).token;
const response=await fetch('https://registry-1.docker.io/v2/library/rust/blobs/'+state.proof.config_digest,{headers:{Authorization:'Bearer '+token}});if(!response.ok)throw Error('Official configblob unavailable');
const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>2*1024**2||'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex')!==state.proof.config_digest)throw Error('Official configblob digest mismatch');
const config=JSON.parse(bytes);
if(config.os!==inspected.Os||config.architecture!==inspected.Architecture||!isDeepStrictEqual(config.rootfs.diff_ids,inspected.RootFS.Layers)||!isDeepStrictEqual(config.config,inspected.Config))throw Error('Actual image differs from official config/rootfs');
state.config_proof={registry_config_sha256:state.proof.config_digest,image_id:inspected.Id,image_id_kind:inspected.Id===state.proof.platform_manifest_digest?'oci_manifest_containerd_store':'oci_config',descriptor_digest:inspected.Descriptor.digest,rootfs_diff_ids:inspected.RootFS.Layers,actual_config_matches:true,actual_platform_matches:true,initial_guard_failure:resume?'Original guard incorrectly assumed ImageId always equals configdigest; exact manifest/config/rootfs proof replaces that invalid assumption.':null};save();
// Preserve the existing canonical tag solely as an alias to the verified platform digest.
docker(['tag',image,'rust:1.90-slim-bookworm']);
const probe=docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','1024m','--memory-swap','1024m','--cpus','1',image,'sh','-c','set -eu; cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max; uname -m; rustc --version']);
if(!probe.includes('1073741824\n0\n100000 100000\nx86_64\nrustc 1.90.0 '))throw Error('Actual bounded network-none rustc/cgroup proof differs');
state.provisioned={at:new Date().toISOString(),image,image_id:inspected.Id,config_digest:state.proof.config_digest,config_proof:state.config_proof,repo_digests:inspected.RepoDigests,os:inspected.Os,architecture:inspected.Architecture,probe,pull_boundary:'Docker daemon image pull has no container cgroup limit. Probe is separately network-none/read-only1GiB memory/zero-swap1CPU. Utility reserved8GiB disk and1GiB memory; no host changes/pruning.'};save();
releaseInstaller(state.slot);state.slot_released=true;save();
// --rm probe terminated synchronously; this utility created no panel records, volumes or allocations.
releaseNative(state.lease.lease_id,state.lease.owner,'released',true);state.lease_released=true;save();
fs.writeFileSync('artifacts/game-parity-20261029/veloren-wave8-image-provisioned.json',JSON.stringify({lease_id:state.lease.lease_id,proof:state.proof,provisioned:state.provisioned,slot_released:true,lease_released:true,no_panel_records:true,no_volumes:true,no_allocations:true},null,2)+'\n');
console.log(JSON.stringify({image,image_id:inspected.Id,config_digest:state.proof.config_digest,probe,slot_released:true,lease_released:true}));
