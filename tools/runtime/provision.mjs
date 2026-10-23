import {readFile,writeFile} from 'node:fs/promises';
const f=JSON.parse(await readFile('.local/runtime-fixtures.json','utf8'));
const response=await fetch('http://127.0.0.1:8088/api/application/servers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Go Wings parity server',user:1,owner:1,owner_id:1,node_id:f.node,egg:f.egg,egg_id:f.egg,nest_id:f.nest,allocation:{default:f.allocation},allocation_id:f.allocation,docker_image:'pteroclone-smoke:local',image:'pteroclone-smoke:local',startup:f.startup,environment:{},limits:{memory:128,swap:0,disk:512,io:500,cpu:100},memory:128,swap:0,disk:512,io:500,cpu:100,feature_limits:{databases:3,allocations:3,backups:5},database_limit:3,allocation_limit:3,backup_limit:5,start_on_completion:false})});
if(!response.ok)throw Error(`${response.status} ${await response.text()}`);
const server=(await response.json()).attributes;
await writeFile('.local/runtime-server.json',JSON.stringify(server,null,2));
console.log(JSON.stringify({id:server.id,uuid:server.uuid,identifier:server.identifier}));
