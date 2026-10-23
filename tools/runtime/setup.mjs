import {readFile,writeFile,mkdir} from 'node:fs/promises';
const base='http://127.0.0.1:8088';
const request=async(method,path,body)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${await r.text()}`);return r.status===204?null:await r.json()};
const attrs=r=>r?.attributes??r;const list=r=>r.data.map(attrs);
await mkdir('.local',{recursive:true});
let location=list(await request('GET','/api/application/locations')).find(x=>x.short==='GO-LOCAL');
if(!location)location=attrs(await request('POST','/api/application/locations',{short:'GO-LOCAL',long:'Go rewrite dedicated local runtime'}));
let node=list(await request('GET','/api/application/nodes')).find(x=>x.name==='Go rewrite local Wings');
if(!node)node=attrs(await request('POST','/api/application/nodes',{name:'Go rewrite local Wings',description:'Dedicated rewrite tests, separate from reference daemon',location_id:location.id,fqdn:'127.0.0.1',scheme:'http',memory:4096,memory_overallocate:0,disk:20480,disk_overallocate:0,daemon_listen:18084,daemon_sftp:12023,daemon_base:'/var/lib/pteroclone-go/volumes',allowed_origins:[base]}));
const config=await request('GET',`/api/application/nodes/${node.id}/configuration`);
const c=attrs(config);c.remote='http://host.docker.internal:8088';
c.allowed_origins=[base];c.system={...c.system,root_directory:'/var/lib/pteroclone-go',data:'/var/lib/pteroclone-go/volumes',log_directory:'/var/lib/pteroclone-go/logs',backup_directory:'/var/lib/pteroclone-go/backups',archive_directory:'/var/lib/pteroclone-go/archives',tmp_directory:'/var/lib/pteroclone-go/tmp'};
c.docker={network:{name:'pteroclone_go',network_mode:'pteroclone_go',interface:'172.30.84.1',interfaces:{v4:{subnet:'172.30.84.0/24',gateway:'172.30.84.1'},v6:{subnet:'fdba:17c8:6c96::/64',gateway:'fdba:17c8:6c96::1'}}}};
await writeFile('.local/wings.json',JSON.stringify(c,null,2),{mode:0o600});
// JSON is valid YAML, and Wings' yaml.v2 parser accepts it.
let allocations=list(await request('GET',`/api/application/nodes/${node.id}/allocations`));
if(!allocations.some(x=>x.port===25586)){await request('POST',`/api/application/nodes/${node.id}/allocations`,{ip:'0.0.0.0',ports:['25586','25587','25588']});allocations=list(await request('GET',`/api/application/nodes/${node.id}/allocations`));}
let nest=list(await request('GET','/api/application/nests')).find(x=>x.name==='Local runtime verification');
if(!nest)nest=attrs(await request('POST','/api/admin/nests',{name:'Local runtime verification',author:'local@example.invalid',description:'Real Docker runtime tests'}));
const startup='echo VOLTRA_READY; while IFS= read -r line; do case "$line" in stop) exit 0;; *) echo "received:$line";; esac; done';
let eggs=list(await request('GET',`/api/admin/nests/${nest.id}/eggs`));
let egg=eggs.find(x=>x.name==='Real process verification');
if(!egg){const data={_comment:'Dedicated local verification egg',meta:{version:'PTDL_v2',update_url:null},exported_at:new Date().toISOString(),name:'Real process verification',author:'local@example.invalid',description:'Installer and interactive process, not a game.',features:[],docker_images:{Smoke:'pteroclone-smoke:local'},file_denylist:[],startup,config:{files:'{}',startup:'{"done":"VOLTRA_READY"}',logs:'{}',stop:'stop'},scripts:{installation:{script:'#!/bin/sh\nset -eu\necho installer-ran > /mnt/server/installed.txt\n',container:'alpine:3.23',entrypoint:'sh'}},variables:[]};egg=attrs(await request('POST',`/api/admin/nests/${nest.id}/eggs/import`,data));}
await writeFile('.local/runtime-fixtures.json',JSON.stringify({location:location.id,node:node.id,nest:nest.id,egg:egg.id,allocation:allocations.find(x=>x.port===25586).id,startup},null,2));
console.log('Dedicated runtime node, egg and private Wings configuration ready.');
