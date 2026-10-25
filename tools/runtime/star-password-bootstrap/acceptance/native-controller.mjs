// MIT. Explicit phases only; acquisition does not start a game or deliver secrets.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const directory='.local/star-native-acceptance',file=directory+'/receipt.json',here='tools/runtime/star-password-bootstrap/acceptance';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function run(exe,args,timeout=60000){const r=spawnSync(exe,args,{windowsHide:true,encoding:'utf8',timeout,maxBuffer:4194304});if(r.status!==0||r.error)throw Error(r.stderr||String(r.error)||'Child failed');return r.stdout;}
const docker=args=>run('docker',args);
const mode=process.argv[2];
if(!['admit','acquire','correct-launch','verify-installed','boot-once','status'].includes(mode))throw Error('Use explicit admit|acquire|correct-launch|verify-installed|boot-once|status');
if(mode==='status'){console.log(fs.readFileSync(file,'utf8'));process.exit(0);}
const node=JSON.parse(fs.readFileSync('.local/batch-node/private.json'));
if(node.root!=='/var/lib/voltra-batch-20261023'||node.volume_root!==node.root+'/volumes'||node.cache_root!==node.root+'/cache'||!Number.isInteger(node.node)||!/^[a-f0-9-]{36}$/.test(node.node_uuid))throw Error('Protected node receipt differs');
const response=await fetch('http://127.0.0.1:8088/api/application/nodes/'+node.node);
if(!response.ok||(await response.json()).attributes.uuid!==node.node_uuid)throw Error('Current node API identity differs');
const python='sha256:27b7c9d4f13ca20bb1170148f02095d50a5dfce1f7f2dabf5ca273727e43b7ea',steam='ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b';
const wine=JSON.parse(fs.readFileSync(here+'/fixture-pins.json')).wine_image;
for(const image of[python,steam,wine])docker(['image','inspect',image,'--format','{{.Id}}']);
let state;
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n',{mode:0o600});
if(mode==='admit'){
 if(fs.existsSync(file))throw Error('Existing acceptance receipt: inspect, never duplicate');
 const main=JSON.parse(fs.readFileSync('artifacts/steam-private-metadata-3809400-live.json'));
 if(main.worker_result.state!=='available'||main.worker_result.public_build_id!=='25642172'||!main.worker_result.platforms.includes('windows'))throw Error('Actual public Windows metadata differs');
 const raw=fs.readFileSync(main.authoritative_receipt.path);if(sha(raw)!==main.authoritative_receipt.sha256)throw Error('Actual raw metadata hash differs');
 const depot=main.worker_result.depots.find(d=>d.depot_id==='3809401');
 if(depot?.public_manifest_id!=='3659990775896995763'||depot.disk_bytes!=='21349240119')throw Error('Actual main depot differs');
 const shared=JSON.parse(fs.readFileSync('artifacts/star-password-bootstrap-shared-depot-validation.json'));
 if(shared.selection.public_manifest.manifest_id!=='5753583882400741046'||shared.selection.public_manifest.disk_bytes!=='25674515')throw Error('Actual shared depot differs');
 fs.mkdirSync(directory,{recursive:true});
 const limits={memory_mib:node.budgets.memory_mib,disk_mib:node.budgets.disk_mib,max_active:Math.min(node.budgets.max_active_servers,7),reserved_disk_mib:20480,port_min:28010,port_max:28999};
 const lease=JSON.parse(run(process.execPath,['tools/runtime/batch-queue.mjs','claim',JSON.stringify({owner:'dst_finish',game:'starrupture/egg-star-rupture-wine.json',memory_mib:8192,disk_mib:40960,ports:2,limits})]));
 const uuid=crypto.randomUUID();state={phase:'leased',lease,node:node.node,node_uuid:node.node_uuid,uuid,root:node.root+'/utilities/star-game-'+uuid,container:'voltra-star-game-'+uuid.slice(0,8),image:wine,metadata_raw_sha256:sha(raw),source_files:{}};save();
 const baseline={containers:JSON.parse(docker(['ps','-a','--format','json']).trim().split('\n').filter(Boolean).map(x=>x).join(',').replace(/^/,'[').replace(/$/,']')),observed_at:new Date().toISOString()};
 fs.writeFileSync(directory+'/baseline.json',JSON.stringify(baseline,null,2)+'\n');
 const prepare="import pathlib,os,shutil,json,sys;p=pathlib.Path('/parent');t=p/sys.argv[1];assert t.parent==p and not t.exists();v=shutil.disk_usage(p);assert v.free>=40960*1024**2; t.mkdir(mode=0o700);os.chown(t,988,988);print(json.dumps({'free_bytes_before':v.free,'owned_uid':988}))";
 state.capacity=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','128m','--cap-drop','ALL','--cap-add','CHOWN','--mount','type=bind,source='+node.root+'/utilities,target=/parent',python,'python3','-B','-c',prepare,path.posix.basename(state.root)]));state.phase='owned_empty';save();
 console.log(JSON.stringify({phase:state.phase,lease:lease.lease_id,root:state.root,capacity:state.capacity}));
}else if(mode==='boot-once'){
 state=JSON.parse(fs.readFileSync(file));
 if(state.phase!=='installed_verified_no_boot'||state.node_uuid!==node.node_uuid||state.boot_command)throw Error('No eligible one-shot first boot');
 const freeze=JSON.parse(fs.readFileSync('artifacts/star-password-bootstrap-acceptance-source.json'));
 for(const source of freeze.files)if(sha(fs.readFileSync(source.path))!==source.sha256)throw Error('Frozen source/dependency drift');
 const queue=JSON.parse(fs.readFileSync('.local/game-batch/queue.json'));if(!queue.claims.some(c=>c.lease_id===state.lease.lease_id&&c.owner==='dst_finish'&&c.status==='active'&&c.memory_mib===8192&&c.disk_mib===40960))throw Error('Lease no longer active');
 const args=['run','--init','--name',state.container+'-boot','--pull','never','--network','bridge','--read-only','--user','988:988','--memory','8192m','--cpus','4','--pids-limit','256','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,size=128m,mode=1777','--log-opt','max-size=32m','--log-opt','max-file=1','--mount','type=bind,source='+state.root+',target=/work','--mount','type=bind,source='+path.resolve('tools/runtime/star-password-bootstrap')+',target=/reviewed/tools/runtime/star-password-bootstrap,readonly','--mount','type=bind,source='+path.resolve('internal/panel/game_library/scripts')+',target=/reviewed/internal/panel/game_library/scripts,readonly','--mount','type=bind,source='+path.resolve('.local/star-password-bootstrap/public-cache/sha256')+',target=/public,readonly','--workdir','/work','-i','--entrypoint','python3',wine,'-B','/reviewed/tools/runtime/star-password-bootstrap/acceptance/native-once.py',String(state.lease.ports[0])];
 const values=[crypto.randomBytes(32).toString('base64url'),crypto.randomBytes(32).toString('base64url')];
 const chunks=[Buffer.from('VSPB1\n')];for(const value of values){const data=Buffer.from(value),length=Buffer.alloc(4);length.writeUInt32LE(data.length);chunks.push(length,data);}
 const packet=Buffer.concat(chunks);
 state.boot_command=args;state.boot_source_freeze_sha256=sha(fs.readFileSync('artifacts/star-password-bootstrap-acceptance-source.json'));state.phase='native_boot_attempted';state.native_started_at=new Date().toISOString();save();
 let raw;
 try{raw=spawnSync('docker',args,{windowsHide:true,input:packet,timeout:210000,maxBuffer:33554432});}
 finally{packet.fill(0);for(const buffer of chunks)buffer.fill(0);values.fill('');}
 const status=spawnSync('docker',['inspect',state.container+'-boot','--format','{{json .State}}'],{windowsHide:true,encoding:'utf8'});
 if(status.status===0){const observed=JSON.parse(status.stdout);if(observed.Running){state.host_watchdog_cleanup=docker(['stop','--time','5',state.container+'-boot']).trim();}state.native_container_state=JSON.parse(docker(['inspect',state.container+'-boot','--format','{{json .State}}']));}
 fs.writeFileSync(directory+'/native.stdout.log',raw.stdout||Buffer.alloc(0),{flag:'wx',mode:0o600});fs.writeFileSync(directory+'/native.stderr.log',raw.stderr||Buffer.alloc(0),{flag:'wx',mode:0o600});
 state.native_transport={docker_exit_code:raw.status,error:raw.error?.code||null,stdout_bytes:raw.stdout?.length||0,stderr_bytes:raw.stderr?.length||0};state.phase='native_boot_terminal';save();
 // Only read the actual private result; never manufacture readiness from exit0.
 const copy=spawnSync('docker',['cp',state.container+'-boot:/work/.voltra/star-acceptance/native-result.json',directory+'/native-result.json'],{windowsHide:true,encoding:'utf8'});
 state.native_result_available=copy.status===0;save();console.log(JSON.stringify({phase:state.phase,transport:state.native_transport,result_available:state.native_result_available}));
}else if(mode==='verify-installed'){
 state=JSON.parse(fs.readFileSync(file));
 if(state.phase!=='installed_validator_stopped'||state.node_uuid!==node.node_uuid)throw Error('No eligible installed validation completion');
 const before=JSON.parse(docker(['inspect',state.container+'-install-corrected','--format','{{json .State}}']));
 if(before.Running||before.ExitCode!==1||!state.first_validator_failure?.no_game_boot)throw Error('Acquisition terminal boundary differs');
 const script=path.resolve(here+'/acquire.py'),shared=path.resolve('internal/panel/game_library/scripts/steam-template.py');
 const args=['run','--init','--name',state.container+'-verify','--pull','never','--network','none','--read-only','--user','988:988','--memory','512m','--cpus','1','--cap-drop','ALL','--security-opt','no-new-privileges','--mount','type=bind,source='+state.root+',target=/work','--mount','type=bind,source='+script+',target=/acquire.py,readonly','--mount','type=bind,source='+shared+',target=/shared/steam-template.py,readonly','--entrypoint','python3',wine,'-B','/acquire.py','--verify-installed'];
 state.phase='installed_verification_attempted';state.verify_command=args;state.verify_source_sha256=sha(fs.readFileSync(script));save();
 const raw=run('docker',args);fs.writeFileSync(directory+'/verify-installed.log',raw,{flag:'wx'});
 docker(['cp',state.container+'-verify:/work/.voltra/star-acceptance/acquisition.json',directory+'/acquisition.json']);
 state.installed=JSON.parse(fs.readFileSync(directory+'/acquisition.json'));state.phase='installed_verified_no_boot';save();console.log(JSON.stringify({phase:state.phase,installed:state.installed}));
}else if(mode==='correct-launch'){
 state=JSON.parse(fs.readFileSync(file));
 if(state.phase!=='acquiring'||state.corrected_command)throw Error('No eligible single launcher correction');
 const before=JSON.parse(docker(['inspect',state.container+'-install','--format','{{json .State}}']));
 const raw=spawnSync('docker',['logs',state.container+'-install'],{windowsHide:true,timeout:10000,maxBuffer:1048576});
 if(before.Running||before.ExitCode!==127||!raw.stderr?.includes(Buffer.from('exec python3 failed: No such file or directory')))throw Error('First failure differs: no correction authorized');
 fs.writeFileSync(directory+'/first-launch.stdout',raw.stdout,{flag:'wx',mode:0o600});fs.writeFileSync(directory+'/first-launch.stderr',raw.stderr,{flag:'wx',mode:0o600});
 state.first_launch_failure={state:before,stdout_sha256:sha(raw.stdout),stderr_sha256:sha(raw.stderr),raw_preserved:true,steam_process_executed:false};save();
 const queue=JSON.parse(fs.readFileSync('.local/game-batch/queue.json'));if(!queue.claims.some(c=>c.lease_id===state.lease.lease_id&&c.owner==='dst_finish'&&c.status==='active'&&c.memory_mib===8192&&c.disk_mib===40960))throw Error('Lease no longer active');
 state.corrected_python_check=docker(['run','--rm','--pull','never','--init','--network','none','--read-only','--user','988:988','--memory','128m','--entrypoint','python3',wine,'-B','-c','import sys; print(sys.executable); print(sys.version)']);
 for(const [name,digest]of Object.entries(state.source_files)){
  const location=name==='acquire.py'?here+'/'+name:'internal/panel/game_library/scripts/'+name;
  if(sha(fs.readFileSync(location))!==digest)throw Error('Acquisition source drift');
 }
 const args=state.install_command.map(value=>value===state.container+'-install'?state.container+'-install-corrected':value===steam?wine:value);
 state.corrected_command=args;state.launcher_delta={image_before:steam,image_after:wine,name_suffix:'-install-corrected',acquire_script_unchanged:true,stock_entrypoint_bypassed:true,root_unchanged:true};state.phase='corrected_acquisition_attempted';save();
 state.install_container_id=docker(args).trim();state.phase='acquiring_corrected';save();console.log(JSON.stringify({phase:state.phase,container:state.container+'-install-corrected',lease:state.lease.lease_id}));
}else{
 state=JSON.parse(fs.readFileSync(file));
 if(state.phase!=='owned_empty'||state.node!==node.node||state.node_uuid!==node.node_uuid||state.image!==wine)throw Error('Unsafe acquisition state');
 const queue=JSON.parse(fs.readFileSync('.local/game-batch/queue.json'));if(!queue.claims.some(c=>c.lease_id===state.lease.lease_id&&c.owner==='dst_finish'&&c.status==='active'&&c.memory_mib===8192&&c.disk_mib===40960))throw Error('Owned normal lease no longer active');
 const cache=JSON.parse(fs.readFileSync('.local/cache-steamcmd-updated/acquisition.json'));
 if(cache.sha256!=='e3414c3ba26341647905c1324da13bee1ba80fd07eb0bb2a6d2e3e3fc7fe546b')throw Error('Reviewed public SteamCMD differs');
 const mounts=['--mount','type=bind,source='+state.root+',target=/work'];
 const stage=docker(['run','--rm','--pull','never','--network','none','--user','988:988','--memory','256m',...mounts,'--mount','type=bind,source='+path.resolve('tools/runtime')+',target=/helper,readonly','--mount','type=bind,source='+node.cache_root+'/sha256/'+cache.sha256+',target=/bootstrap.tar.gz,readonly','--mount','type=bind,source='+path.resolve(cache.public_manifest)+',target=/manifest.json,readonly',python,'python3','-B','/helper/cache-steamcmd.py','--root','/work','--blob','/bootstrap.tar.gz','--sha256',cache.sha256,'--source',cache.source,'--acquired-at',cache.acquired_at,'--public-manifest','/manifest.json']);
 fs.writeFileSync(directory+'/steamcmd-stage.json',stage,{flag:'wx'});
 const script=path.resolve(here+'/acquire.py'),shared=path.resolve('internal/panel/game_library/scripts/steam-template.py');
 state.source_files={'acquire.py':sha(fs.readFileSync(script)),'steam-template.py':sha(fs.readFileSync(shared))};
 const args=['run','--init','--detach','--name',state.container+'-install','--pull','never','--network','bridge','--user','988:988','--memory','8192m','--cpus','4','--pids-limit','256','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,size=128m,mode=1777','--log-opt','max-size=32m','--log-opt','max-file=1',...mounts,'--mount','type=bind,source='+script+',target=/acquire.py,readonly','--mount','type=bind,source='+shared+',target=/shared/steam-template.py,readonly','--workdir','/work','-e','HOME=/work','--entrypoint','python3',steam,'-B','/acquire.py'];
 state.phase='acquisition_attempted';state.install_command=args;save();state.install_container_id=docker(args).trim();state.phase='acquiring';save();console.log(JSON.stringify({phase:state.phase,container:state.container+'-install',lease:state.lease.lease_id}));
}
