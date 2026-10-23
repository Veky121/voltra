import fs from 'node:fs';
import {setTimeout} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';
const file='.local/batch-node/smoke.json',node=JSON.parse(fs.readFileSync('.local/batch-node/private.json'));
if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file)).phase!=='begin')throw Error('Smoke already has a receipt; inspect rather than repeat');
const api=async(method,url,body)=>{let r=await fetch('http://127.0.0.1:8088'+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let raw=await r.text();if(!r.ok)throw Error(method+' '+url+' '+r.status);return raw?JSON.parse(raw):null};
const attrs=x=>x.attributes,rows=x=>x.data.map(attrs),receipt={node:node.node,phase:'begin'};
const save=()=>fs.writeFileSync(file,JSON.stringify(receipt,null,2));save();
const account=attrs(await api('GET','/api/client/account'));
const nest=attrs(await api('POST','/api/admin/nests',{name:'voltra-batch-node-smoke-20261023',description:'Owned infrastructure smoke only'}));receipt.nest=nest.id;save();
const egg=attrs(await api('POST',`/api/admin/nests/${nest.id}/eggs`,{name:'Local batch infrastructure smoke',author:'batch@localhost.invalid',description:'Real Linux process infrastructure probe',docker_images:{Smoke:'pteroclone-smoke:local'},startup:'echo VOLTRA_BATCH_READY; sleep infinity',config_startup:{done:'VOLTRA_BATCH_READY'},config_stop:'^C',config_files:{},config_logs:{},script_install:'echo no-install',script_entry:'bash',script_container:'debian:bookworm-slim'}));receipt.egg=egg.id;save();
await api('POST',`/api/application/nodes/${node.node}/allocations`,{ip:'127.0.0.1',ports:['28000']});
const allocation=rows(await api('GET',`/api/application/nodes/${node.node}/allocations?per_page=1000`)).find(x=>x.port===28000&&!x.assigned);receipt.allocation=allocation.id;save();
const server=attrs(await api('POST','/api/application/servers',{name:'voltra-batch-node-smoke-20261023',user:account.id,egg:egg.id,docker_image:'pteroclone-smoke:local',startup:'echo VOLTRA_BATCH_READY; sleep infinity',environment:{},skip_scripts:true,start_on_completion:false,limits:{memory:128,swap:0,disk:128,io:500,cpu:100},feature_limits:{databases:0,allocations:0,backups:0},allocation:{default:allocation.id}}));
Object.assign(receipt,{server:server.id,uuid:server.uuid,identifier:server.identifier});save();
for(let i=0;i<30;i++){if(attrs(await api('GET',`/api/application/servers/${server.id}`)).status===null)break;await setTimeout(1000)}
await api('POST',`/api/client/servers/${server.identifier}/power`,{signal:'start'});
let online=false;for(let i=0;i<30;i++){if(attrs(await api('GET',`/api/client/servers/${server.identifier}/resources`)).current_state==='running'){online=true;break}await setTimeout(1000)}
if(!online)throw Error('Smoke did not reach native running');
const docker=args=>execFileSync('docker',args,{encoding:'utf8'}).trim();
receipt.native={running:docker(['inspect','--format','{{.State.Running}}',server.uuid]),network:docker(['inspect','--format','{{.HostConfig.NetworkMode}}',server.uuid]),ready:docker(['logs',server.uuid]).includes('VOLTRA_BATCH_READY')};save();
await api('POST',`/api/client/servers/${server.identifier}/power`,{signal:'stop'});
for(let i=0;i<30;i++){if(attrs(await api('GET',`/api/client/servers/${server.identifier}/resources`)).current_state==='offline')break;await setTimeout(1000)}
if(attrs(await api('GET',`/api/client/servers/${server.identifier}/resources`)).current_state!=='offline')throw Error('Smoke stop not confirmed');
await api('DELETE',`/api/application/servers/${server.id}`);
await api('DELETE',`/api/application/nodes/${node.node}/allocations/${allocation.id}`);
await api('DELETE',`/api/admin/eggs/${egg.id}`);
await api('DELETE',`/api/admin/nests/${nest.id}`);
receipt.phase='cleaned';save();console.log({native:receipt.native,cleaned:true});
