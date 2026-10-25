// Approved phase1 only: no game, Steam login, network or Microsoft installer.
import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
import {transact,claim,claimUtility,release} from './batch-queue.mjs';

const image='ghcr.io/ptero-eggs/steamcmd:proton@sha256:38380883a880937c6bdfa25a29a50601e8fd010a126157f857539bfd9057ed7b';
const python='python:3.13-slim@sha256:27b7c9d4f13ca20bb1170148f02095d50a5dfce1f7f2dabf5ca273727e43b7ea';
const diagnostic=process.argv.includes('--diagnostic'),sdkDiagnostic=process.argv.includes('--sdk-diagnostic');
if(sdkDiagnostic&&!diagnostic)throw Error('SDK diagnostic requires diagnostic mode');
const batch=JSON.parse(fs.readFileSync('.local/batch-node/private.json'));
if(batch.node!==249||batch.root!=='/var/lib/voltra-batch-20261023')throw Error('Current reviewed node/root receipt required');
const queue=resolve('.local/game-batch/queue.json'),game='palworld/egg-palworld-proton.json',owner='managed_steam_bridge';
const limits={memory_mib:20480,disk_mib:131072,reserved_disk_mib:20480,max_active:7,port_min:28010,port_max:28999};
const plan=JSON.parse(fs.readFileSync('artifacts/game-batch-plan.json'));
const id=randomUUID(),root=batch.root+'/managed-proton/'+id,name='voltra-palworld-probe-'+id,dir=resolve('.local/palworld-proton-probe',id);
fs.mkdirSync(dir,{recursive:true});
const sha=data=>createHash('sha256').update(data).digest('hex');
const run=args=>{const result=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});if(result.status!==0)throw Error('Owned probe Docker operation failed: '+result.stderr);return result.stdout;};
const inspect=JSON.parse(run(['image','inspect',image]))[0];
if(inspect.Os!=='linux'||inspect.Architecture!=='amd64'||!inspect.RepoDigests.includes('ghcr.io/ptero-eggs/steamcmd@sha256:38380883a880937c6bdfa25a29a50601e8fd010a126157f857539bfd9057ed7b'))throw Error('Exact cached image identity mismatch');
const probe=fs.readFileSync('internal/palworldloader/assets/runtime-probe.exe');
if(probe.length!==2258944||sha(probe)!=='6c8f67de8ce7232e1128a49c16098c8b544f56647b52ceedfd6e9485213e1235')throw Error('Reviewed probe mismatch');
const lease=transact(queue,state=>diagnostic?claimUtility(state,{owner,task:'palworld-proton-probe-diagnostic',memory_mib:1024,disk_mib:4096,ports:0},limits):claim(state,plan,{owner,game,memory_mib:9216,disk_mib:32768,ports:1},limits));
const receipt={schema:1,phase:sdkDiagnostic?'public-probe-sdk-diagnostic':diagnostic?'public-probe-diagnostic':'dependencies-only',id,lease,node:batch.node,root,name,directory:dir,image,image_id:inspect.Id,image_bytes:inspect.Size,probe_sha256:sha(probe),probe_bytes:probe.length,libraries:29,exports:655,network:'none',deadline_ms:900000,started_at:new Date().toISOString(),game_acquired:false,steam_login:false,microsoft_installer:false};
const save=()=>fs.writeFileSync(join(dir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');save();
fs.writeFileSync('.local/palworld-proton-probe/current.json',JSON.stringify({id,directory:dir,name,root,lease_id:lease.lease_id},null,2)+'\n');
console.log(JSON.stringify({phase:'claimed',id,lease_id:lease.lease_id,name,receipt:join(dir,'receipt.json')}));
let created=false,active=false;
const safeRoot=()=>{if(root!==batch.root+'/managed-proton/'+id||!/^[a-f0-9-]{36}$/.test(id))throw Error('Owned cleanup scope invalid');};
const utility=(program,args=[])=>run(['run','--rm','--pull','never','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${batch.root},target=/host`,...(sdkDiagnostic?['--mount',`type=bind,source=${batch.cache_root},target=/public-cache,readonly`,'--mount',`type=bind,source=${resolve('.local/cache-steamcmd-updated/public-manifest.json')},target=/public-manifest.json,readonly`]:[]),...(diagnostic?['--mount',`type=bind,source=${resolve('internal/palworldloader/assets')},target=/public-source,readonly`]:[]),'--entrypoint','python3',python,'-B','-c',program,...args]);
try {
 const identity=JSON.parse(run(['run','--rm','--pull','never','--network','none','--memory','128m','--cpus','1','--cap-drop','ALL','--entrypoint','/bin/bash',image,'-c',`printf '{"uid":%s,"gid":%s}' "$(id -u)" "$(id -g)"` ]));
 if(!Number.isSafeInteger(identity.uid)||identity.uid===0||!Number.isSafeInteger(identity.gid))throw Error('Nonroot image owner required');receipt.identity=identity;save();
 safeRoot();
 utility(`from pathlib import Path\nimport os,sys,shutil,json\np=Path('/host/managed-proton')/sys.argv[1]\nif p.exists():raise ValueError('Unique owned root exists')\nfree=shutil.disk_usage('/host').free\nif free<int(sys.argv[4])*1024*1024:raise ValueError('Insufficient actual free disk')\np.mkdir(parents=True,mode=0o700);(p/'home').mkdir(mode=0o700)\nos.chown(p/'home',int(sys.argv[2]),int(sys.argv[3]))\nif len(sys.argv)>5 and sys.argv[5]=='diagnostic':\n import hashlib\n d=p/'home/public-probe';d.mkdir(mode=0o700);os.chown(d,int(sys.argv[2]),int(sys.argv[3]))\n source=Path('/public-source/runtime-probe.exe').read_bytes()\n if hashlib.sha256(source).hexdigest()!='6c8f67de8ce7232e1128a49c16098c8b544f56647b52ceedfd6e9485213e1235':raise ValueError('Probe source mismatch')\n target=d/'runtime-probe.exe';target.write_bytes(source);target.chmod(0o500);os.chown(target,int(sys.argv[2]),int(sys.argv[3]))\nprint(json.dumps({'free_bytes':free}))`,[id,String(identity.uid),String(identity.gid),String(diagnostic?4096:32768),diagnostic?'diagnostic':'standard']);created=true;
 if(sdkDiagnostic){receipt.sdk=JSON.parse(utility(fs.readFileSync('tools/runtime/palworld-probe-sdk-stage.py','utf8'),[id,String(identity.uid),String(identity.gid)]));save();}
 const script=`set -euo pipefail
umask 077
${diagnostic?'mkdir -p /home/container/private-logs\nchmod 0700 /home/container/private-logs\nexport PROTON_LOG=1 PROTON_LOG_DIR=/home/container/private-logs SteamGameId=2394010 SteamAppId=2394010\n':''}
export HOME=/home/container
export STEAM_COMPAT_DATA_PATH=/home/container/.steam/steam/steamapps/compatdata/2394010
export STEAM_COMPAT_CLIENT_INSTALL_PATH=/home/container/.steam/steam
unset WINEDLLOVERRIDES
mkdir -p "$STEAM_COMPAT_DATA_PATH" "$STEAM_COMPAT_CLIENT_INSTALL_PATH"
${diagnostic?`test -f /home/container/public-probe/runtime-probe.exe
test ! -L /home/container/public-probe/runtime-probe.exe
printf '%s  %s\\n' '6c8f67de8ce7232e1128a49c16098c8b544f56647b52ceedfd6e9485213e1235' '/home/container/public-probe/runtime-probe.exe' | sha256sum -c -
stat -c 'PUBLIC_PROBE_MODE_OWNER %a %u %g' /home/container/public-probe/runtime-probe.exe
test \"$(stat -c %a /home/container/public-probe/runtime-probe.exe)\" = 500
test \"$(stat -c %u /home/container/public-probe/runtime-probe.exe)\" = \"$(id -u)\"
options=$(findmnt -T /home/container/public-probe/runtime-probe.exe -n -o OPTIONS)
printf 'PUBLIC_PROBE_MOUNT %s\\n' \"$options\"
case \",$options,\" in *,noexec,*) exit 77;; esac
cd /home/container/public-probe
${sdkDiagnostic?`for library in /home/container/.steam/sdk64/steamclient.so /home/container/.steam/sdk64/libtier0_s.so /home/container/.steam/sdk64/libvstdlib_s.so; do
 output=$(ldd \"$library\")
 printf \"%s\\n\" \"$output\"
 case \"$output\" in *\"not found\"*) exit 78;; esac
done
exec python3 /probe/log-bounded.py`:`exec /usr/bin/xvfb-run -a /usr/local/bin/proton run /home/container/public-probe/runtime-probe.exe`}`:`cd /probe
exec /usr/bin/xvfb-run -a /usr/local/bin/proton run /probe/runtime-probe.exe`}
`;
 if(sdkDiagnostic)fs.copyFileSync('tools/runtime/palworld-probe-log-bounded.py',join(dir,'log-bounded.py'));
 fs.writeFileSync(join(dir,'actual-probe.sh'),script);fs.copyFileSync('internal/palworldloader/assets/runtime-probe.exe',join(dir,'runtime-probe.exe'));
 const args=['run','--init','--name',name,'--label','voltra.palworld-probe='+id,'--pull','never','--network','none','--memory','1024m','--cpus','2','--pids-limit','512','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,size=128m','--mount',`type=bind,source=${root}/home,target=/home/container`,'--mount',`type=bind,source=${dir},target=/probe,readonly`,'--entrypoint','/bin/bash',image,'-c',script];
 receipt.argv=args;receipt.diagnostic_log_limit_bytes=diagnostic?33554432:0;save();
 const log=fs.openSync(join(dir,'native.log'),'wx',0o600);const child=spawn('docker',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let captured=0;const capture=data=>{const count=Math.min(data.length,16777216-captured);if(count>0){fs.writeSync(log,data,0,count);captured+=count;}};child.stdout.on('data',capture);child.stderr.on('data',capture);active=true;receipt.windows_docker_client_pid=child.pid;save();console.log(JSON.stringify({phase:'running',id,docker_client_pid:child.pid,name}));
 let deadline=false,admissionLost=false;
 const stop=()=>{try{run(['stop','--time','10',name]);}catch{}};
 const timer=setTimeout(()=>{deadline=true;stop();},900000);
 const guard=setInterval(()=>{const state=JSON.parse(fs.readFileSync(queue));const owned=state.claims.find(row=>row.lease_id===lease.lease_id&&row.owner===owner&&row.status==='active');const live=state.claims.filter(row=>row.status==='active');if(!owned||live.length>7||live.reduce((sum,row)=>sum+row.memory_mib,0)>20480){admissionLost=true;stop();}},10000);
 const code=await new Promise((ok,fail)=>{child.once('error',fail);child.once('close',ok)});clearTimeout(timer);clearInterval(guard);fs.closeSync(log);
 const info=JSON.parse(run(['inspect',name]))[0];active=info.State.Running;if(active)throw Error('Probe Docker client exited while container remained running');
 if(diagnostic){fs.mkdirSync(join(dir,'private-logs'),{mode:0o700});run(['cp',name+':/home/container/private-logs/.',join(dir,'private-logs')]);for(const log of fs.readdirSync(join(dir,'private-logs'))){const p=join(dir,'private-logs',log);if(fs.statSync(p).size>33554432)throw Error('Private diagnostic log cap exceeded');fs.chmodSync(p,0o600);}}
 const output=fs.readFileSync(join(dir,'native.log'),'utf8');const privateOutput=diagnostic?fs.readdirSync(join(dir,'private-logs')).map(file=>fs.readFileSync(join(dir,'private-logs',file),'utf8')).join('\n'):'';const combined=output+'\n'+privateOutput;const probeLines=[...new Set([...combined.matchAll(/(VOLTRA_PALWORLD_(?:PROBE_MAIN_ENTERED|RUNTIME_IMPORTS_READY)|MISSING_RUNTIME_(?:LIBRARY|EXPORT) [^\\"\r\n]+)/g)].map(match=>match[1]))];receipt.result={client_exit:code,native_exit:info.State.ExitCode,oom_killed:info.State.OOMKilled,deadline,admission_lost:admissionLost,main_entered:probeLines.includes('VOLTRA_PALWORLD_PROBE_MAIN_ENTERED'),marker:probeLines.includes('VOLTRA_PALWORLD_RUNTIME_IMPORTS_READY'),missing_libraries:probeLines.filter(line=>line.startsWith('MISSING_RUNTIME_')),finished_at:new Date().toISOString()};save();
} catch(error){receipt.error=String(error.message);save();throw error;}
finally {
 // No force-kill or recursive broad removal: only the exact approved owned
 // container, after a normal stop, and this receipt's validated host root.
 if(active){run(['stop','--time','10',name]);active=false;}
 let exists=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8',timeout:10000});
 if(exists.status===0){const info=JSON.parse(exists.stdout)[0];if(info.State.Running||info.Config.Labels?.['voltra.palworld-probe']!==id)throw Error('Owned probe cleanup identity mismatch');run(['rm',name]);}
 if(created){safeRoot();receipt.cleanup=JSON.parse(utility(`from pathlib import Path\nimport shutil,sys,json\np=Path('/host/managed-proton')/sys.argv[1]\nif p.is_symlink() or p.parent!=Path('/host/managed-proton'):raise ValueError('Unsafe exact owned root')\nused=sum(f.stat().st_size for f in p.rglob('*') if f.is_file() and not f.is_symlink())\nshutil.rmtree(p)\nprint(json.dumps({'removed':not p.exists(),'private_prefix_bytes':used}))`,[id]));}
 receipt.lease_release=transact(queue,state=>release(state,lease.lease_id,owner,'released',true));save();
 console.log(JSON.stringify({phase:'cleaned',id,result:receipt.result,cleanup:receipt.cleanup,lease_released:true}));
}
