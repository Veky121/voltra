import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {verifyRuntime,profileFromRuntime,activeLease,acquireInstaller,releaseInstaller,createNativeFixture,waitNativeInstaller,waitInstallOutcome,releaseGate,docker} from './campaign-native-20261029.mjs';
if(!process.argv.includes('--coordinator-installer-go'))throw Error('Explicit coordinator installer GO required');
const dir='.local/game-parity-20261029/veloren-root-native',file=dir+'/state.json',recipe='veloren/egg-veloren.json';
let state=JSON.parse(fs.readFileSync(file));
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
activeLease(state.lease.lease_id,state.lease.owner);
if(state.lease.game!==recipe||state.lease.memory_mib!==4096||state.lease.disk_mib!==8192||state.lease.ports.length!==1||state.server)throw Error('Exact uninstalled reviewed Veloren fixture/lease required');
const receipt=await verifyRuntime(),profile=profileFromRuntime(recipe,receipt);state.latest_runtime=receipt;save();
if(profile.egg.variables.find(v=>v.env_variable==='AUTH_MODE')?.default_value!=='official'||(profile.egg.features||[]).includes('eula'))throw Error('Default auth/agreement prerequisite drift');
// Image acquisition is performed only within the separately admitted installer turn.
// A missing installer image is a hard preflight here, never an implicit background pull.
docker(['image','inspect',profile.egg.scripts.installation.container,'--format','{{.Id}}']);
docker(['image','inspect',Object.values(profile.egg.docker_images)[0],'--format','{{.Id}}']);
state.slot=acquireInstaller(state.lease.lease_id,state.lease.owner);save();
await createNativeFixture({lease:state.lease,slot:state.slot,profile,name:'Campaign Veloren native wave8',environment:{VERSION:'weekly',SERVER_NAME:'Voltra Veloren native wave8',AUTH_MODE:'official'},onStep:s=>{state={...state,...s};save();}});
const gated=await waitNativeInstaller(state);state.installer_proof=gated.proof;state.installer_observers=[];
for(const [args,name] of [[['logs','--follow',gated.container.Id],'installer.log'],[['wait',gated.container.Id],'installer-wait.txt']]){
 const fd=fs.openSync(dir+'/'+name,'a'),child=spawn('docker',['--context','desktop-linux',...args],{windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 child.on('error',error=>{state.observer_error=error.message;save();});state.installer_observers.push({name,pid:child.pid});
}
save();releaseGate(gated.container,state.lease,state.slot.token);
state.install_outcome=await waitInstallOutcome(state);save();
if(!state.install_outcome.success)throw Error('Veloren canonical installer failed; retain exact fixture/slot evidence for reviewed recovery');
let waitExit;for(let i=0;i<20;i++){const text=fs.existsSync(dir+'/installer-wait.txt')?fs.readFileSync(dir+'/installer-wait.txt','utf8').trim():'';if(/^\d+$/.test(text)){waitExit=Number(text);break;}await new Promise(r=>setTimeout(r,150));}
state.installer_docker_wait=waitExit;save();if(waitExit!==0)throw Error('Actual installer Docker wait0 is required independently of API completion');
if(process.argv.includes('--with-approved-query-build')){state.query_build_authorized=true;state.install_complete_slot_held=true;save();}
else{releaseInstaller(state.slot);state.slot_released=true;save();}
console.log(JSON.stringify({uuid:state.server.uuid,install:state.install_outcome,slot_released:state.slot_released===true,query_build_next:state.query_build_authorized===true}));
