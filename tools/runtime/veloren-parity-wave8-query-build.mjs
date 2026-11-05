import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {verifyRuntime,activeLease,api,docker,releaseInstaller} from './campaign-native-20261029.mjs';
if(!process.argv.includes('--coordinator-approved-query-build'))throw Error('Approved separate bounded query-probe build required');
const dir='.local/game-parity-20261029/veloren-root-native',file=dir+'/state.json',state=JSON.parse(fs.readFileSync(file)),save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
activeLease(state.lease.lease_id,state.lease.owner);state.latest_runtime=await verifyRuntime();save();
if(!state.server||!state.install_outcome?.success||!state.query_build_authorized||!state.install_complete_slot_held||state.slot_released||state.query_build)throw Error('Successful offline canonical install with retained slot required');
const resources=(await api('/api/client/servers/'+state.server.uuid+'/resources')).attributes;
if(resources.current_state!=='offline')throw Error('Native game must remain offline during separate1GiB query build');
const imageState=JSON.parse(fs.readFileSync(dir+'/rust-image-state.json'));
if(!imageState.provisioned||!imageState.lease_released)throw Error('Verified pinned official Rust prerequisite required');
const image=imageState.provisioned.image,name='campaign-veloren-query-'+state.lease.lease_id.slice(0,8),out=path.resolve(dir,'query-build');fs.mkdirSync(out,{recursive:true});
if(fs.existsSync(out+'/go'))throw Error('Existing build gate requires review');
const script='set -eu\nwhile test ! -f /out/go; do sleep 1; done\nexport CARGO_HOME=/out/cargo CARGO_TARGET_DIR=/out/target\ncargo build --release --locked --manifest-path /source/Cargo.toml\n';
const id=docker(['create','--name',name,'--pull','never','--network','voltra-parity-20261029','--memory','1024m','--memory-swap','1024m','--cpus','1','--mount','type=bind,source='+path.resolve('tools/veloren-query')+',target=/source,readonly','--mount','type=bind,source='+out+',target=/out',image,'sh','-c',script]).trim();
state.query_build={id,name,image,source:'tools/veloren-query',source_readonly:true,output:out,boundary:'Separate bounded probe utility within idle4GiB game reservation; not a Wings installer proof',started:new Date().toISOString(),manifest_sha256:crypto.createHash('sha256').update(fs.readFileSync('tools/veloren-query/Cargo.lock')).digest('hex')};save();docker(['start',id]);
const limits=JSON.parse(docker(['inspect','--format','{{json .HostConfig}}',id]));
if(limits.Memory!==1073741824||limits.MemorySwap!==1073741824||limits.NanoCpus!==1000000000)throw Error('Query utility limits differ');
state.query_build.actual_limits={memory:limits.Memory,memory_swap:limits.MemorySwap,nano_cpus:limits.NanoCpus};save();
const observers=[];
for(const [args,label]of[[['logs','--follow',id],'query-build.log'],[['wait',id],'query-build-wait.txt']]){const fd=fs.openSync(dir+'/'+label,'a'),child=spawn('docker',['--context','desktop-linux',...args],{windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);child.on('error',e=>{state.query_build.observer_error=e.message;save();});observers.push({label,pid:child.pid});}
state.query_build.observers=observers;save();fs.writeFileSync(out+'/go','reviewed\n');
const began=Date.now();let terminal;
while(Date.now()-began<240000){const native=JSON.parse(docker(['inspect','--format','{{json .State}}',id]));if(!native.Running){terminal=native;break;}await new Promise(r=>setTimeout(r,500));}
if(!terminal){state.query_build.deadline_exceeded=true;save();docker(['stop','--time','10',id]);throw Error('Query build deadline reached; preserve owned evidence and review before continuing');}
state.query_build.terminal={exit_code:terminal.ExitCode,oom_killed:terminal.OOMKilled,finished:terminal.FinishedAt};save();if(terminal.ExitCode!==0||terminal.OOMKilled)throw Error('Locked query build failed; preserve bounded utility evidence');
let waitExit;for(let i=0;i<20;i++){const text=fs.existsSync(dir+'/query-build-wait.txt')?fs.readFileSync(dir+'/query-build-wait.txt','utf8').trim():'';if(/^\d+$/.test(text)){waitExit=Number(text);break;}await new Promise(r=>setTimeout(r,150));}
state.query_build.actual_docker_wait=waitExit;save();if(waitExit!==0)throw Error('Actual query utility Docker wait0 required');
const binary=fs.readFileSync(out+'/target/release/voltra-veloren-query');state.query_build.binary={file:out+'/target/release/voltra-veloren-query',bytes:binary.length,sha256:crypto.createHash('sha256').update(binary).digest('hex')};
docker(['rm',id]);state.query_build.container_removed=true;state.query_build.finished=new Date().toISOString();save();
releaseInstaller(state.slot);state.slot_released=true;state.install_complete_slot_held=false;save();
console.log(JSON.stringify({query_binary:state.query_build.binary,terminal:state.query_build.terminal,container_removed:true,slot_released:true}));
