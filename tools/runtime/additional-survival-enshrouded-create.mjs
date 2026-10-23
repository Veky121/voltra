// Claim the shared local pool first. A full pool leaves no runtime resources.
import fs from'node:fs';import crypto from'node:crypto';import{execFileSync}from'node:child_process';import{api,rows}from'./openttd-compat-node.mjs';
const dir='.local/additional-survival/enshrouded';fs.mkdirSync(dir,{recursive:true});const file=dir+'/private.json';
if(fs.existsSync(file))throw Error('Existing receipt; observe instead of creating twice');
const node=JSON.parse(fs.readFileSync('.local/batch-node/private.json'));if(node.node!==202||node.root!=='/var/lib/voltra-batch-20261023')throw Error('Owned local node identity mismatch');
const request={owner:'game_batch_inventory',game:'enshrouded/egg-enshrouded.json',memory_mib:12288,disk_mib:32768,ports:1,limits:{memory_mib:20480,disk_mib:131072,reserved_disk_mib:20480,max_active:5,port_min:28010,port_max:28999}};
let lease;
if(process.argv[2]==='--reuse-cleaned-development'){
 const old=JSON.parse(fs.readFileSync('.local/additional-survival/enshrouded-development/private.json'));
 const cleanup=JSON.parse(fs.readFileSync('.local/additional-survival/enshrouded-development/cleanup.json'));
 lease=JSON.parse(fs.readFileSync('.local/game-batch/queue.json')).claims.find(c=>c.lease_id===old.lease_id&&c.status==='active'&&c.owner===request.owner&&c.game===request.game);
 if(!lease||lease.memory_mib<12288||lease.disk_mib<32768||lease.ports.length!==1||cleanup.uuid!==old.uuid||!cleanup.volume_deleted||!cleanup.containers_deleted)throw Error('Cleaned development resource reservation mismatch');
}else lease=JSON.parse(execFileSync(process.execPath,['tools/runtime/batch-queue.mjs','claim',JSON.stringify(request)],{encoding:'utf8'}));
const s={request_id:crypto.randomUUID(),node:202,node_receipt:'.local/batch-node/private.json',ports:lease.ports,lease_id:lease.lease_id};const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2),{mode:0o600});save();
const name='Enshrouded isolated acceptance '+s.request_id;
const nest=(await api('/api/admin/nests','POST',{name,author:'acceptance@example.invalid',description:'Owned disposable Enshrouded acceptance'})).attributes;s.nest_id=nest.id;save();
const egg=JSON.parse(fs.readFileSync('.local/additional-survival/profiles.json'))[request.game].egg;
const imported=(await api('/api/admin/nests/'+nest.id+'/eggs/import','POST',egg)).attributes;s.egg_id=imported.id;save();s.allocation_ids=[];
for(const port of s.ports){if(rows(await api('/api/admin/nodes/202/allocations')).some(a=>a.ip==='127.0.0.1'&&a.port===port))throw Error('Preexisting allocation cannot be adopted');await api('/api/admin/nodes/202/allocations','POST',{ip:'127.0.0.1',ports:[String(port)]});const a=rows(await api('/api/admin/nodes/202/allocations')).find(a=>a.ip==='127.0.0.1'&&a.port===port);s.allocation_ids.push(a.id);save();}
const environment=Object.fromEntries(egg.variables.map(v=>[v.env_variable,v.default_value]));Object.assign(environment,{AUTO_UPDATE:'0',SRV_NAME:'Voltra Enshrouded',MAX_PLAYERS:'4'});
for(const key of ['SRV_PW','SRV_PW2','SRV_PW3','SRV_PW4'])environment[key]=crypto.randomBytes(16).toString('base64url');
s.passwords=Object.fromEntries(['SRV_PW','SRV_PW2','SRV_PW3','SRV_PW4'].map(k=>[k,environment[k]]));save();
const owner=(await api('/api/client/account')).attributes.id;
const server=(await api('/api/application/servers','POST',{name:'Enshrouded isolated acceptance',user:owner,node_id:202,egg:s.egg_id,external_id:'enshrouded-acceptance-'+s.request_id,docker_image:Object.values(egg.docker_images)[0],startup:egg.startup,allocation:{default:s.allocation_ids[0]},limits:{memory:12288,swap:0,disk:32768,io:500,cpu:400},feature_limits:{databases:0,allocations:0,backups:1},start_on_completion:false,environment})).attributes;
Object.assign(s,{uuid:server.uuid,identifier:server.identifier,internal_id:server.id});save();console.log({uuid:s.uuid,status:server.status,ports:s.ports});
