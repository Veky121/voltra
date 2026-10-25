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
const readonlyState=JSON.parse(docker(['inspect',state.container+'-readonly','--format','{{json .State}}']));if(readonlyState.Running||readonlyState.Pid!==0)throw Error('Readonly diagnostic container still active');
const pins=JSON.parse(fs.readFileSync(here+'/fixture-pins.json'));if(state.image!==pins.wine_image)throw Error('Image drift');
docker(['image','inspect',pins.wine_image,'--format','{{.Id}}']);
const freeze=JSON.parse(fs.readFileSync('artifacts/star-password-bootstrap-trace-source.json'));
const helper='internal/panel/game_library/scripts/steam-native-next.py',helperArchive='.local/star-trace-source/shared/steam-native-next.py';
const location=p=>p===helper?helperArchive:p;
for(const row of freeze.files)if(sha(fs.readFileSync(row.archive||row.path))!==row.sha256)throw Error('Diagnostic source drift');
const first=fs.readFileSync('artifacts/star-password-bootstrap-acceptance-source.json');if(sha(first)!==state.boot_source_freeze_sha256)throw Error('Original freeze drift');
for(const row of JSON.parse(first).files)if(sha(fs.readFileSync(location(row.path)))!==row.sha256)throw Error('Original dependency drift');
const name=state.container+'-trace',directory='.local/star-trace-acceptance';
const args=['run','--init','--name',name,'--pull','never','--network','bridge','--read-only','--user','988:988','--memory','8192m','--cpus','4','--pids-limit','256','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,size=128m,mode=1777','--log-opt','max-size=1m','--log-opt','max-file=1','--mount','type=bind,source='+state.root+',target=/work','--mount','type=bind,source='+path.resolve('tools/runtime/star-password-bootstrap')+',target=/reviewed/tools/runtime/star-password-bootstrap,readonly','--mount','type=bind,source='+path.resolve('internal/panel/game_library/scripts')+',target=/reviewed/internal/panel/game_library/scripts,readonly','--mount','type=bind,source='+path.resolve('.local/star-password-bootstrap/public-cache/sha256')+',target=/public,readonly','--workdir','/work','-i','--entrypoint','python3',pins.wine_image,'-B','/reviewed/'+here+'/trace-once.py',String(state.lease.ports[0])];
args.splice(args.indexOf('--workdir'),0,'--mount','type=bind,source='+path.resolve(helperArchive)+',target=/reviewed/'+helper+',readonly');
if(mode==='review'){console.log(JSON.stringify({phase:'trace_driver_review_no_boot',args,original_stopped:true,readonly_stopped:true,lease_active:true,freeze_sha256:sha(fs.readFileSync('artifacts/star-password-bootstrap-trace-source.json'))}));process.exit(0);}
fs.mkdirSync(directory,{recursive:true});const receipt=directory+'/receipt.json';
fs.writeFileSync(receipt,JSON.stringify({phase:'attempted',args,freeze_sha256:sha(fs.readFileSync('artifacts/star-password-bootstrap-trace-source.json'))}),{flag:'wx',mode:0o600});
const values=[crypto.randomBytes(32).toString('base64url'),crypto.randomBytes(32).toString('base64url')];
const chunks=[Buffer.from('VSPB1\n')];for(const value of values){const body=Buffer.from(value),length=Buffer.alloc(4);length.writeUInt32LE(body.length);chunks.push(length,body);}
const packet=Buffer.concat(chunks);
let result,observed;
try{result=spawnSync('docker',args,{windowsHide:true,timeout:105000,maxBuffer:1048576,input:packet,stdio:['pipe','pipe','pipe']});}
finally{packet.fill(0);for(const chunk of chunks)chunk.fill(0);values.fill('');observed=JSON.parse(docker(['inspect',name,'--format','{{json .State}}']));if(observed.Running){docker(['stop','--time','5',name]);observed=JSON.parse(docker(['inspect',name,'--format','{{json .State}}']));}}
// Arbitrary transport output is never exported; private in-volume result has fixed stages only.
const report={phase:'terminal',wrapper:observed,transport_exit:result.status,transport_error:result.error?.code||null,stdout_bytes:result.stdout?.length||0,stderr_bytes:result.stderr?.length||0,child_exit_is_separate:true};
fs.writeFileSync(directory+'/transport-result.json',JSON.stringify(report,null,2)+'\n');
for(const file of ['result.json','restoration.json','snapshot.json'])docker(['cp',name+':/work/.voltra/star-trace/'+file,directory+'/'+file]);
console.log(JSON.stringify(report));
