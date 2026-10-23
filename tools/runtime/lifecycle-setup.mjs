import {readFile,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:8088';
const f=JSON.parse(await readFile('.local/runtime-fixtures.json','utf8'));
async function api(method,path,body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${await r.text()}`);return r.status===204?null:await r.json()}
const attrs=r=>r?.attributes??r;const rows=r=>r.data.map(attrs);
let target=rows(await api('GET','/api/application/nodes')).find(n=>n.name==='Lifecycle transfer target');
if(!target)target=attrs(await api('POST','/api/application/nodes',{name:'Lifecycle transfer target',location_id:f.location,fqdn:'host.docker.internal',scheme:'http',memory:4096,memory_overallocate:0,disk:20480,disk_overallocate:0,daemon_listen:18085,daemon_sftp:12024,daemon_base:'/var/lib/pteroclone-go-transfer/volumes',allowed_origins:[base]}));
const config=attrs(await api('GET',`/api/application/nodes/${target.id}/configuration`));
config.remote='http://host.docker.internal:8088';config.allowed_origins=[base];config.system={...config.system,root_directory:'/var/lib/pteroclone-go-transfer',data:'/var/lib/pteroclone-go-transfer/volumes',log_directory:'/var/lib/pteroclone-go-transfer/logs',backup_directory:'/var/lib/pteroclone-go-transfer/backups',archive_directory:'/var/lib/pteroclone-go-transfer/archives',tmp_directory:'/var/lib/pteroclone-go-transfer/tmp'};
config.docker={network:{name:'pteroclone_transfer',network_mode:'pteroclone_transfer',interface:'172.30.85.1',interfaces:{v4:{subnet:'172.30.85.0/24',gateway:'172.30.85.1'},v6:{subnet:'fdba:17c8:6c97::/64',gateway:'fdba:17c8:6c97::1'}}}};
await writeFile('.local/lifecycle-wings.json',JSON.stringify(config,null,2),{mode:0o600});
for(const [node,ports] of [[f.node,[25589,25590,25591]],[target.id,[25592,25593,25594]]]){const allocations=rows(await api('GET',`/api/application/nodes/${node}/allocations?per_page=100`));const missing=ports.filter(port=>!allocations.some(a=>a.port===port));if(missing.length)await api('POST',`/api/application/nodes/${node}/allocations`,{ip:'0.0.0.0',ports:missing.map(String)})}
const sourceAllocations=rows(await api('GET',`/api/application/nodes/${f.node}/allocations?per_page=100`));const targetAllocations=rows(await api('GET',`/api/application/nodes/${target.id}/allocations?per_page=100`));
await writeFile('.local/lifecycle-fixtures.json',JSON.stringify({...f,target:target.id,sourceAllocations:sourceAllocations.filter(a=>[25589,25590,25591].includes(a.port)),targetAllocations:targetAllocations.filter(a=>[25592,25593,25594].includes(a.port))},null,2));
console.log(JSON.stringify({targetNode:target.id,sourceAllocations:3,targetAllocations:3,privateConfigurationWritten:true}));
