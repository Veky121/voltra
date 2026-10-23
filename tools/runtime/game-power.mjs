// Operates only the server identified by the caller's acceptance receipt.
// Usage: node tools/runtime/game-power.mjs receipt.json start|stop
import fs from 'node:fs';
import {setTimeout} from 'node:timers/promises';
const [receiptPath,signal]=process.argv.slice(2);
const receipt=JSON.parse(fs.readFileSync(receiptPath));
if(!/^[a-f0-9]{8}$/.test(receipt.identifier)||!['start','stop'].includes(signal))throw Error('Specify an acceptance receipt and start or stop');
const base='http://127.0.0.1:8088/api/client/servers/'+receipt.identifier;
const identity=await fetch(base);if(!identity.ok)throw Error('Server identity HTTP '+identity.status);
if((await identity.json()).attributes.uuid!==receipt.uuid)throw Error('Server UUID mismatch');
const response=await fetch(base+'/power',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signal})});
if(!response.ok)throw Error('Power HTTP '+response.status);
console.log({identifier:receipt.identifier,requested:signal});
if(signal==='stop'){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){
  const r=await fetch(base+'/resources');if(!r.ok)throw Error('Resource observation HTTP '+r.status);
  if((await r.json()).attributes.current_state==='offline'){console.log('Graceful stop reached offline.');process.exit(0);}
  await setTimeout(1000);
 }
 throw Error('Stop is not yet confirmed. Inspect the same server; no forced stop was attempted.');
}
