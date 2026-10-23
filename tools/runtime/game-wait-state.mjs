// Read-only readiness wait; never retries power actions or restarts a server.
// Usage: node tools/runtime/game-wait-state.mjs receipt.json running|offline
import fs from 'node:fs';import {setTimeout} from 'node:timers/promises';
const [path,state]=process.argv.slice(2),receipt=JSON.parse(fs.readFileSync(path));
if(!/^[a-f0-9]{8}$/.test(receipt.identifier)||!['running','offline'].includes(state))throw Error('Specify an acceptance receipt and desired state');
const base='http://127.0.0.1:8088/api/client/servers/'+receipt.identifier;
const identity=await fetch(base);if(!identity.ok||(await identity.json()).attributes.uuid!==receipt.uuid)throw Error('Server identity could not be verified');
const deadline=Date.now()+45000;let observed='unknown';
while(Date.now()<deadline){
 try {
  const response=await fetch(base+'/resources',{signal:AbortSignal.timeout(5000)});
  if([401,403].includes(response.status))throw Error('Resource access denied');
  if(response.ok){observed=(await response.json()).attributes.current_state;if(observed===state){console.log({identifier:receipt.identifier,state:observed});process.exit(0);}}
 }catch(error){if(error.message==='Resource access denied')throw error;}
 await setTimeout(1000);
}
throw Error(`State ${state} not yet observed; last state ${observed}. Inspect the same process. No restart was attempted.`);
