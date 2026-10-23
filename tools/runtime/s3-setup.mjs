import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const base='http://127.0.0.1:8088';
const original=JSON.parse(await readFile('.local/runtime-fixtures.json','utf8'));
async function api(method,path,body){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok)throw Error(`${method} ${path}: ${response.status} ${await response.text()}`);return response.status===204?null:response.json()}
const rows=r=>r.data.map(x=>x.attributes);
let node=rows(await api('GET','/api/application/nodes')).find(n=>n.name==='S3 isolated Wings');
if(!node)node=(await api('POST','/api/application/nodes',{name:'S3 isolated Wings',location_id:original.location,fqdn:'127.0.0.1',scheme:'http',memory:4096,memory_overallocate:0,disk:20480,disk_overallocate:0,daemon_listen:18086,daemon_sftp:12025,daemon_base:'/var/lib/pteroclone-s3/volumes',allowed_origins:[base]})).attributes;
const configResponse=await api('GET',`/api/application/nodes/${node.id}/configuration`);
const config=configResponse.attributes??configResponse;
config.remote='http://host.docker.internal:8088';config.allowed_origins=[base];
config.system={...config.system,root_directory:'/var/lib/pteroclone-s3',data:'/var/lib/pteroclone-s3/volumes',log_directory:'/var/lib/pteroclone-s3/logs',backup_directory:'/var/lib/pteroclone-s3/backups',archive_directory:'/var/lib/pteroclone-s3/archives',tmp_directory:'/var/lib/pteroclone-s3/tmp',backups:{restore_host_allowlist:['host.docker.internal']}};
config.docker={network:{name:'pteroclone_s3wings',network_mode:'pteroclone_s3wings',interface:'172.30.86.1',interfaces:{v4:{subnet:'172.30.86.0/24',gateway:'172.30.86.1'},v6:{subnet:'fdba:17c8:6c98::/64',gateway:'fdba:17c8:6c98::1'}}}};
await writeFile('.local/s3-wings.json',JSON.stringify(config,null,2),{mode:0o600});
const container='pteroclone-s3-wings';
const networkExists=execFileSync('docker',['network','ls','--filter','name=^pteroclone_s3wings$','--format','{{.Name}}'],{encoding:'utf8'}).trim();
if(!networkExists)execFileSync('docker',['network','create','--driver','bridge','--subnet','172.30.86.0/24','--gateway','172.30.86.1','--ipv6','--subnet','fdba:17c8:6c98::/64','--gateway','fdba:17c8:6c98::1','--opt','com.docker.network.bridge.name=ptero_s3w','pteroclone_s3wings'],{stdio:'ignore'});
const existing=execFileSync('docker',['ps','-a','--filter',`name=^${container}$`,'--format','{{.Names}}'],{encoding:'utf8'}).trim();
if(!existing)execFileSync('docker',['run','-d','--name',container,'-p','127.0.0.1:18086:18086','-p','127.0.0.1:12025:12025','-v',`${resolve('.local/s3-wings.json')}:/etc/pterodactyl/config.yml`,'-v','/var/run/docker.sock:/var/run/docker.sock','-v','/run/wings:/run/wings','-v','/var/lib/pteroclone-s3:/var/lib/pteroclone-s3','pteroclone-wings:local','--config','/etc/pterodactyl/config.yml'],{stdio:'ignore'});
else execFileSync('docker',['start',container],{stdio:'ignore'});
await writeFile('.local/s3-fixtures.json',JSON.stringify({...original,node:node.id},null,2));
console.log(JSON.stringify({node:node.id,daemon:container,restoreAllowlist:['host.docker.internal'],port:18086}));
