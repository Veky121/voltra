// Finish an already-created infrastructure smoke; never creates/retries a server.
import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {setTimeout} from 'node:timers/promises';
const file='.local/batch-node/smoke.json',r=JSON.parse(fs.readFileSync(file));
if(r.node!==202||r.uuid!=='824aaa4c-e5a9-46ea-b710-c19565bbe9de')throw Error('Owned smoke identity mismatch');
const api=async(method,url,body)=>{let x=await fetch('http://127.0.0.1:8088'+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),raw=await x.text();if(!x.ok)throw Error(method+' '+url+' '+x.status);return raw?JSON.parse(raw):null};
const docker=a=>execFileSync('docker',a,{encoding:'utf8'}).trim();
if((await api('GET',`/api/application/servers/${r.server}`)).attributes.uuid!==r.uuid)throw Error('API identity mismatch');
r.development_failure='First smoke start rejected by DockerDesktop publishing guestbridge IP. Dedicated node interface corrected to127.0.0.1 after precreating isolated bridge. Smoke sleep process did not handle native console Stop; owned smoke was explicitly killed for cleanup. This is infrastructure proof, not graceful game shutdown acceptance.';
if(!process.argv.includes('--cleanup')){
r.native={running:docker(['inspect','--format','{{.State.Running}}',r.uuid]),ports:JSON.parse(docker(['inspect','--format','{{json .NetworkSettings.Ports}}',r.uuid])),ready:docker(['logs',r.uuid]).includes('VOLTRA_BATCH_READY')};
fs.writeFileSync(file,JSON.stringify(r,null,2));
await api('POST',`/api/client/servers/${r.identifier}/power`,{signal:'stop'});
let stopped=false;for(let i=0;i<30;i++){if((await api('GET',`/api/client/servers/${r.identifier}/resources`)).attributes.current_state==='offline'){stopped=true;break}await setTimeout(1000)}if(!stopped)throw Error('Stop not confirmed');
}
if((await api('GET',`/api/client/servers/${r.identifier}/resources`)).attributes.current_state!=='offline')throw Error('Refuse deletion until offline');
await api('DELETE',`/api/application/servers/${r.server}`);await api('DELETE',`/api/application/nodes/${r.node}/allocations/${r.allocation}`);await api('DELETE',`/api/admin/eggs/${r.egg}`);await api('DELETE',`/api/admin/nests/${r.nest}`);
r.phase='cleaned';fs.writeFileSync(file,JSON.stringify(r,null,2));console.log({native:r.native,cleaned:true});
