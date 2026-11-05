import fs from 'node:fs';
import crypto from 'node:crypto';
import {verifyRuntime,profileFromRuntime,claimNative} from './campaign-native-20261029.mjs';
const dir='.local/game-parity-20261029/veloren-root-native',file=dir+'/state.json',recipe='veloren/egg-veloren.json';
fs.mkdirSync(dir,{recursive:true});
const phase=process.argv[2];
if(phase!=='claim'||!process.argv.includes('--coordinator-claim-go'))throw Error('Explicit coordinator claim GO required; native installer not yet admitted');
let previous;
if(fs.existsSync(file)){
 previous=JSON.parse(fs.readFileSync(file));
 if(!process.argv.includes('--after-reviewed-image-provisioning')||!previous.lease_released||previous.release?.outcome!=='released'||previous.server)throw Error('Existing Veloren state requires review; do not create a duplicate lease');
 const image=JSON.parse(fs.readFileSync(dir+'/rust-image-state.json'));
 if(!image.lease_released||!image.slot_released||!image.provisioned)throw Error('Canonical image utility must complete and release before fresh game reservation');
}
const receipt=await verifyRuntime(),profile=profileFromRuntime(recipe,receipt);
if(profile.egg.variables.length!==10||profile.egg.variables.find(v=>v.env_variable==='AUTH_MODE')?.default_value!=='official')throw Error('Reviewed default authentication/controls drift');
if((profile.egg.features||[]).includes('eula')||profile.egg.variables.some(v=>/EULA|ACCEPT|AGREEMENT/i.test(v.env_variable)))throw Error('New agreement prerequisite requires root review');
const archive='.local/veloren/weekly-linux-x86_64-2026-10-21T11_29.zip',expected='ad6ad879d6f680a06b0c270c74ecbeea74f20dbd49fc84ac2195a0d15916b16e';
if(fs.statSync(archive).size!==470739814)throw Error('Reviewed cache size differs');
const h=crypto.createHash('sha256');for await(const block of fs.createReadStream(archive))h.update(block);if(h.digest('hex')!==expected)throw Error('Reviewed publisher cache differs');
const publisher=JSON.parse(fs.readFileSync(dir+'/publisher-source/weekly-current.json'));
const asset=publisher.assets.find(a=>a.name==='weekly-linux-x86_64-2026-10-21T11_29.zip');
if(!asset||asset.size!==470739814||asset.digest!=='sha256:'+expected)throw Error('Retained publisher metadata no longer proves exact reviewed cache');
const lease=claimNative({game:recipe,owner:'veloren_wave8_native',memory_mib:4096,disk_mib:8192,ports:1});
const state={lease,latest_runtime:receipt,previous_released_reservations:previous?[...(previous.previous_released_reservations||[]),previous.release]:[],cache:{archive,bytes:470739814,sha256:expected,publisher_metadata:dir+'/publisher-source/weekly-current.json'},auth_mode:'official',agreement_review:'No canonical acceptance control or publisher gate identified in retained source; do not accept any newly observed terms',admission:'Claim only; no fixture or installer until separate coordinator GO'};
fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
fs.writeFileSync(dir+'/lease.json',JSON.stringify({lease},null,2)+'\n');
console.log(JSON.stringify({lease_id:lease.lease_id,game:lease.game,memory_mib:lease.memory_mib,disk_mib:lease.disk_mib,ports:lease.ports,pid:receipt.pid,claimed_only:true}));
