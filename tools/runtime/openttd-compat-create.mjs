import fs from 'node:fs';import crypto from 'node:crypto';
import{api,rows,remote,file,directory}from './openttd-compat-node.mjs';
if(!fs.existsSync(directory+'/node-baseline.json'))throw Error('Capture remote baseline first');
const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{request_id:crypto.randomUUID(),node:147,port:23660};
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2),{mode:0o600});save();
if(state.uuid)throw Error('Server already created; observe same installation');
const info=await api('/api/admin/nodes/147/system-information');if((info.attributes??info).architecture!=='amd64')throw Error('Owned node unavailable');
const sockets=remote(`import subprocess,json
s=subprocess.check_output(['ss','-H','-lntu'],text=True)
print(json.dumps({'free':not any(line.split()[4].endswith(':23660') for line in s.splitlines())}))`);
if(!sockets.free)throw Error('Acceptance port occupied');
const name='OpenTTD compatibility acceptance '+state.request_id;
let nest=rows(await api('/api/application/nests')).find(x=>x.name===name);
if(!nest)nest=(await api('/api/admin/nests','POST',{name,author:'acceptance@example.invalid',description:'Owned disposable OpenTTD compatibility acceptance'})).attributes;
state.nest_id=nest.id;save();
const egg=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))['openttd/egg-open-t-t-d-server.json'].egg;
let imported=rows(await api('/api/admin/nests/'+nest.id+'/eggs')).find(x=>x.name===egg.name);
if(!imported)imported=(await api('/api/admin/nests/'+nest.id+'/eggs/import','POST',egg)).attributes;
state.egg_id=imported.id;save();
let allocation=rows(await api('/api/admin/nodes/147/allocations')).find(x=>x.ip==='192.168.178.89'&&x.port===state.port);
if(allocation)throw Error('Port allocation preexists; do not adopt');
await api('/api/admin/nodes/147/allocations','POST',{ip:'192.168.178.89',ports:[String(state.port)]});
allocation=rows(await api('/api/admin/nodes/147/allocations')).find(x=>x.ip==='192.168.178.89'&&x.port===state.port);
state.allocation_ids=[allocation.id];save();
const environment=Object.fromEntries(egg.variables.map(v=>[v.env_variable,v.default_value]));Object.assign(environment,{srv_name:'Voltra compatibility',srv_advertise:'false',SERVER_VISIBILITY:'auto'});
const owner=(await api('/api/client/account')).attributes.id;
const server=(await api('/api/application/servers','POST',{name:'OpenTTD compatibility acceptance',user:owner,egg:imported.id,external_id:'openttd-compat-'+state.request_id,node_id:147,docker_image:Object.values(egg.docker_images)[0],startup:egg.startup,allocation:{default:allocation.id},limits:{memory:1024,swap:0,disk:4096,io:500,cpu:200},feature_limits:{databases:0,allocations:0,backups:1},start_on_completion:false,environment})).attributes;
if(server.node!==147||server.egg!==state.egg_id)throw Error('Identity mismatch');Object.assign(state,{uuid:server.uuid,identifier:server.identifier,internal_id:server.id});save();console.log({uuid:state.uuid,status:server.status});
