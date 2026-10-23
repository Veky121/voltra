// Provision only the named local parallel acceptance node; never restart the panel.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const directory='.local/batch-node',name='voltra-batch-20261023',root='/var/lib/'+name;
fs.mkdirSync(directory,{recursive:true});
const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:4*1024*1024}).trim();
const api=async(method,url,body)=>{const r=await fetch('http://127.0.0.1:8088'+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.text();if(!r.ok)throw Error(method+' '+url+' HTTP '+r.status);return raw?JSON.parse(raw):null};
const attrs=x=>x.attributes,rows=x=>x.data.map(attrs);
if(!fs.existsSync(directory+'/baseline.json'))fs.writeFileSync(directory+'/baseline.json',JSON.stringify({captured_at:new Date().toISOString(),containers:JSON.parse(docker(['ps','-a','--format','json']).split('\n').map(x=>x).length?'['+docker(['ps','-a','--format','json']).split('\n').join(',')+']':'[]'),networks:docker(['network','ls','--format','{{.ID}} {{.Name}}'])},null,2));
let location=rows(await api('GET','/api/application/locations')).find(x=>x.short==='BATCH-LOCAL');
if(!location)location=attrs(await api('POST','/api/application/locations',{short:'BATCH-LOCAL',long:'Owned isolated local parallel game acceptance'}));
// The app can give the disposable environment a clearer display name. Its
// ownership marker keeps a later setup run from creating a duplicate node.
let node=rows(await api('GET','/api/application/nodes')).find(x=>x.name===name||x.description?.startsWith('Owned by tools/runtime/batch-node-setup.mjs;'));
if(!node)node=attrs(await api('POST','/api/application/nodes',{name,description:'Owned by tools/runtime/batch-node-setup.mjs; isolated parallel acceptance',location_id:location.id,fqdn:'127.0.0.1',scheme:'http',memory:20480,memory_overallocate:0,disk:131072,disk_overallocate:0,upload_size:4096,daemon_listen:18090,daemon_sftp:12030,daemon_base:root+'/volumes',allowed_origins:['http://127.0.0.1:8088']}));
const rawConfig=await api('GET',`/api/application/nodes/${node.id}/configuration`);
const config=rawConfig.attributes??rawConfig;
config.remote='http://host.docker.internal:8088';
config.allowed_origins=['http://127.0.0.1:8088'];
config.api={...config.api,host:'0.0.0.0',port:18090,upload_limit:4096};
config.system={...config.system,root_directory:root,data:root+'/volumes',log_directory:root+'/logs',backup_directory:root+'/backups',archive_directory:root+'/archives',tmp_directory:root+'/tmp',sftp:{...config.system?.sftp,bind_port:12030}};
// Docker Desktop publishes loopback host ports only on 127.0.0.1, not guest bridge addresses.
// Network creation below explicitly supplies the actual bridge gateway.
config.docker={...config.docker,network:{name,network_mode:name,interface:'127.0.0.1',interfaces:{v4:{subnet:'172.30.90.0/24',gateway:'172.30.90.1'},v6:{subnet:'fdba:17c8:6c90::/64',gateway:'fdba:17c8:6c90::1'}}}};
const existing=docker(['ps','-a','--filter','name=^'+name+'$','--format','{{.Names}}']);
if(!docker(['network','ls','--filter','name=^'+name+'$','--format','{{.Name}}']))docker(['network','create','--label','voltra.owner=batch-20261023','--subnet','172.30.90.0/24','--gateway','172.30.90.1','--opt','com.docker.network.bridge.name=voltra_batch90',name]);
if(!existing){
 fs.writeFileSync(directory+'/wings.json',JSON.stringify(config,null,2),{mode:0o600});
 docker(['run','-d','--name',name,'--label','voltra.owner=batch-20261023','-p','127.0.0.1:18090:18090','-p','127.0.0.1:12030:12030','-v',path.resolve(directory+'/wings.json')+':/etc/pterodactyl/config.yml:ro','-v',path.resolve('.local/wings-install-status')+':/usr/bin/wings:ro','-v','/var/run/docker.sock:/var/run/docker.sock','-v','/run/wings:/run/wings','-v',root+':'+root,'pteroclone-wings:local','--config','/etc/pterodactyl/config.yml']);
}
else if(docker(['inspect','--format','{{.State.Status}}',name])==='exited'){
 fs.writeFileSync(directory+'/wings.json',JSON.stringify(config,null,2),{mode:0o600});
 docker(['start',name]);
}
const receipt={created_at:new Date().toISOString(),name,node:node.id,node_uuid:node.uuid,location:location.id,container:name,root,volume_root:root+'/volumes',cache_root:root+'/cache',daemon_port:18090,sftp_port:12030,allocation_ip:'127.0.0.1',port_range:[28000,28999],budgets:{memory_mib:20480,disk_mib:131072,cpu_threads:16,max_active_servers:5},configuration_path:directory+'/wings.json'};
fs.writeFileSync(directory+'/private.json',JSON.stringify(receipt,null,2),{mode:0o600});
console.log({node:node.id,receipt:directory+'/private.json',container_running:docker(['inspect','--format','{{.State.Running}}',name])});
const health=await api('GET',`/api/admin/nodes/${node.id}/system-information`);
fs.writeFileSync(directory+'/health.json',JSON.stringify(health,null,2));console.log({native_health:true});
