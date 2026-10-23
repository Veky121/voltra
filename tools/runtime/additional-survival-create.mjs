// Native Barotrauma acceptance only, on the existing owned remote node.
import fs from'node:fs';import crypto from'node:crypto';import{execFileSync}from'node:child_process';
import{api,rows,remote,baseline}from'./openttd-compat-node.mjs';
const dir='.local/additional-survival/barotrauma';fs.mkdirSync(dir,{recursive:true});
const file=dir+'/private.json';if(fs.existsSync(file))throw Error('Existing acceptance receipt; inspect instead of creating twice');
const prior=JSON.parse(fs.readFileSync('.local/openttd-compat/node-baseline.json')),current=baseline();
if(current.wings_pid!==prior.wings_pid||current.config_sha256!==prior.config_sha256||JSON.stringify(current.containers)!==JSON.stringify(prior.containers))throw Error('Remote baseline drift');
fs.writeFileSync(dir+'/node-baseline.json',JSON.stringify(current,null,2));
const request={owner:'game_batch_inventory',game:'barotrauma/egg-barotrauma.json',memory_mib:3072,disk_mib:8192,ports:2,limits:{memory_mib:8192,disk_mib:49152,reserved_disk_mib:8192,max_active:1,port_min:23670,port_max:23679}};
const lease=JSON.parse(execFileSync(process.execPath,['tools/runtime/batch-queue.mjs','claim',JSON.stringify(request)],{encoding:'utf8',env:{...process.env,GAME_BATCH_STATE:dir+'/queue.json'}}));
const s={request_id:crypto.randomUUID(),node:147,ports:lease.ports,lease_id:lease.lease_id};const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2),{mode:0o600});save();
const sockets=remote(`import json,subprocess
ports=set(${JSON.stringify(s.ports)});s=subprocess.check_output(['ss','-H','-lntu'],text=True)
print(json.dumps({'free':not any(int(line.split()[4].rsplit(':',1)[1]) in ports for line in s.splitlines())}))`);if(!sockets.free)throw Error('Requested remote ports occupied');
const name='Barotrauma isolated acceptance '+s.request_id;
const nest=(await api('/api/admin/nests','POST',{name,author:'acceptance@example.invalid',description:'Owned disposable Barotrauma acceptance'})).attributes;s.nest_id=nest.id;save();
const egg=JSON.parse(fs.readFileSync('.local/additional-survival/profiles.json'))[request.game].egg;
const imported=(await api('/api/admin/nests/'+nest.id+'/eggs/import','POST',egg)).attributes;s.egg_id=imported.id;save();s.allocation_ids=[];
for(const port of s.ports){if(rows(await api('/api/admin/nodes/147/allocations')).some(a=>a.ip==='192.168.178.89'&&a.port===port))throw Error('Existing allocation cannot be adopted');await api('/api/admin/nodes/147/allocations','POST',{ip:'192.168.178.89',ports:[String(port)]});const allocation=rows(await api('/api/admin/nodes/147/allocations')).find(a=>a.ip==='192.168.178.89'&&a.port===port);s.allocation_ids.push(allocation.id);save();}
const environment=Object.fromEntries(egg.variables.map(v=>[v.env_variable,v.default_value]));Object.assign(environment,{AUTO_UPDATE:'0',SERVER_NAME:'Voltra Barotrauma',MAX_PLAYERS:'6',PUBLIC_SERVER:'0',SERVER_PASSWORD:''});
const owner=(await api('/api/client/account')).attributes.id;
const server=(await api('/api/application/servers','POST',{name:'Barotrauma isolated acceptance',user:owner,node_id:147,egg:s.egg_id,external_id:'barotrauma-acceptance-'+s.request_id,docker_image:Object.values(egg.docker_images)[0],startup:egg.startup,allocation:{default:s.allocation_ids[0],additional:s.allocation_ids.slice(1)},limits:{memory:3072,swap:0,disk:8192,io:500,cpu:200},feature_limits:{databases:0,allocations:1,backups:1},start_on_completion:false,environment})).attributes;
Object.assign(s,{uuid:server.uuid,identifier:server.identifier,internal_id:server.id});save();console.log({uuid:s.uuid,status:server.status,ports:s.ports});
