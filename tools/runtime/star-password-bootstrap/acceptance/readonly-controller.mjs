// MIT. Review is read-only. Native boot requires explicit reviewed boot-once phase.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import{spawnSync}from'node:child_process';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),here='tools/runtime/star-password-bootstrap/acceptance';
const mode=process.argv[2];if(!['review','boot-once'].includes(mode))throw Error('Use review|boot-once');
function docker(args){const r=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1048576});if(r.status!==0||r.error)throw Error('Docker boundary check failed');return r.stdout;}
const state=JSON.parse(fs.readFileSync('.local/star-native-acceptance/receipt.json'));
const expected='/var/lib/voltra-batch-20261023/utilities/star-game-0e0f1d86-f810-4b93-8bdb-6a9e498dfc54';
if(state.root!==expected||state.container!=='voltra-star-game-0e0f1d86'||state.phase!=='native_boot_terminal'||state.lease.lease_id!=='07ddc606-cda6-4a99-9868-39a4022e658d')throw Error('Exact owned namespace differs');
const queue=JSON.parse(fs.readFileSync('.local/game-batch/queue.json'));
if(!queue.claims.some(c=>c.lease_id===state.lease.lease_id&&c.owner==='dst_finish'&&c.status==='active'&&c.memory_mib===8192&&c.disk_mib===40960))throw Error('Normal lease inactive');
const old=JSON.parse(docker(['inspect',state.container+'-boot','--format','{{json .State}}']));if(old.Running||old.Pid!==0)throw Error('Original native container still active');
const pins=JSON.parse(fs.readFileSync(here+'/fixture-pins.json'));if(state.image!==pins.wine_image)throw Error('Image drift');
docker(['image','inspect',pins.wine_image,'--format','{{.Id}}']);
const freeze=JSON.parse(fs.readFileSync('artifacts/star-password-bootstrap-diagnostic-source.json'));
for(const row of freeze.files)if(sha(fs.readFileSync(row.path))!==row.sha256)throw Error('Diagnostic source drift');
const first=fs.readFileSync('artifacts/star-password-bootstrap-acceptance-source.json');if(sha(first)!==state.boot_source_freeze_sha256)throw Error('Original freeze drift');
for(const row of JSON.parse(first).files)if(sha(fs.readFileSync(row.path))!==row.sha256)throw Error('Original dependency drift');
const name=state.container+'-readonly',directory='.local/star-readonly-acceptance';
const args=['run','--init','--name',name,'--pull','never','--network','bridge','--read-only','--user','988:988','--memory','8192m','--cpus','4','--pids-limit','256','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,size=128m,mode=1777','--log-opt','max-size=1m','--log-opt','max-file=1','--mount','type=bind,source='+state.root+',target=/work','--mount','type=bind,source='+path.resolve('tools/runtime/star-password-bootstrap')+',target=/reviewed/tools/runtime/star-password-bootstrap,readonly','--mount','type=bind,source='+path.resolve('internal/panel/game_library/scripts')+',target=/reviewed/internal/panel/game_library/scripts,readonly','--mount','type=bind,source='+path.resolve('.local/star-password-bootstrap/public-cache/sha256')+',target=/public,readonly','--workdir','/work','--entrypoint','python3',pins.wine_image,'-B','/reviewed/'+here+'/readonly-once.py',String(state.lease.ports[0])];
if(mode==='review'){console.log(JSON.stringify({phase:'readonly_driver_review_no_boot',args,original_stopped:true,lease_active:true,freeze_sha256:sha(fs.readFileSync('artifacts/star-password-bootstrap-diagnostic-source.json'))}));process.exit(0);}
fs.mkdirSync(directory,{recursive:true});const receipt=directory+'/receipt.json';
fs.writeFileSync(receipt,JSON.stringify({phase:'attempted',args,freeze_sha256:sha(fs.readFileSync('artifacts/star-password-bootstrap-diagnostic-source.json'))}),{flag:'wx',mode:0o600});
let result,observed;
try{result=spawnSync('docker',args,{windowsHide:true,timeout:105000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']});}
finally{observed=JSON.parse(docker(['inspect',name,'--format','{{json .State}}']));if(observed.Running){docker(['stop','--time','5',name]);observed=JSON.parse(docker(['inspect',name,'--format','{{json .State}}']));}}
// Arbitrary transport output is never exported; private in-volume result has fixed stages only.
const report={phase:'terminal',wrapper:observed,transport_exit:result.status,transport_error:result.error?.code||null,stdout_bytes:result.stdout?.length||0,stderr_bytes:result.stderr?.length||0,child_exit_is_separate:true};
fs.writeFileSync(directory+'/transport-result.json',JSON.stringify(report,null,2)+'\n');
for(const file of ['result.json','restoration.json','snapshot.json'])docker(['cp',name+':/work/.voltra/star-readonly/'+file,directory+'/'+file]);
console.log(JSON.stringify(report));
