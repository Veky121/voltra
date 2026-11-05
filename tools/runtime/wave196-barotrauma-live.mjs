import fs from 'node:fs';
import * as c from './campaign-native-20261029.mjs';
const dir='artifacts/game-parity-20261029/wave196-barotrauma-live';fs.mkdirSync(dir,{recursive:true});
const file=dir+'/state.json',s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2));
s.runtime=await c.verifyRuntime();const profile=c.profileFromRuntime('barotrauma/egg-barotrauma.json',s.runtime);
try{
if(!s.lease){s.lease=c.claimNative({owner:'barotrauma_wave196',game:'barotrauma/egg-barotrauma.json',memory_mib:3072,disk_mib:8192,ports:2});save();}
if(!s.slot){s.slot=c.acquireInstaller(s.lease.lease_id,s.lease.owner);save();}
if(!s.fixture)s.fixture=await c.createNativeFixture({lease:s.lease,slot:s.slot,profile,name:'Campaign Barotrauma wave196',environment:{AUTO_UPDATE:'0',VOLTRA_STEAM_AUTO_UPDATE:'0',PUBLIC_SERVER:'0'},onStep:async x=>{s.fixture=x;save();}});
if(!s.gate_released){const i=await c.waitNativeInstaller(s.fixture);s.installer={id:i.container.Id,proof:i.proof};save();c.releaseGate(i.container,s.lease,s.slot.token);s.gate_released=true;save();}
console.log(JSON.stringify({lease:s.lease,server:s.fixture.server.uuid,installer:s.installer}));
}catch(e){s.last_error={at:new Date().toISOString(),message:e.message};s.admission_attempts??=[];s.admission_attempts.push(s.last_error);save();console.log(s.last_error);process.exitCode=1;}


