// Local UI fixtures only. Imported through the DEV-only bootstrap in main.tsx.
import {minecraftAdminRecord,minecraftClientFixture,minecraftEgg} from './minecraftDemo.ts';
const date='2026-10-31T08:00:00Z';
const GB=1024;
export const demoAccount={id:9001,uuid:'voltra-dev-demo-account',username:'demo',nickname:'Demo admin',email:'demo@example.test',root_admin:true,language:'en',created_at:date};
export const demoNodes=[
 {id:9001,uuid:'demo-home-node',name:'Home node',fqdn:'home.demo.invalid',memory:64*GB,disk:1024*GB},
 {id:9002,uuid:'demo-edge-node',name:'Edge node',fqdn:'edge.demo.invalid',memory:32*GB,disk:512*GB},
].map(node=>({...node,description:'Static development preview',location_id:9001,scheme:'https',memory_overallocate:0,disk_overallocate:0,daemon_listen:8080,daemon_sftp:2022,upload_size:100,maintenance_mode:false,behind_proxy:true,public:true}));
const workloads=[
 {name:'Minecraft Survival',slug:'survival',game:'minecraft',egg_name:'Minecraft',node_id:9001,memory:8,disk:40,cpu:400,usedMemory:4.2,usedDisk:18,cpuUsage:37,state:'running',port:25565,description:'A survival world for friends.'},
 {name:'Satisfactory',slug:'factory',game:'satisfactory',egg_name:'Satisfactory',node_id:9001,memory:12,disk:80,cpu:600,usedMemory:6.8,usedDisk:24,cpuUsage:62,state:'running',port:7777,description:'Our shared factory on the northern forest map.'},
 {name:'Farming Simulator 25',slug:'farm',game:'farming-simulator-25',egg_name:'Farming Simulator 25',node_id:9001,memory:8,disk:100,cpu:400,usedMemory:2.1,usedDisk:45,cpuUsage:14,state:'running',port:10823,description:'Riverbend Springs cooperative farm.'},
 {name:'Palworld',slug:'palworld',game:'palworld',egg_name:'Palworld',node_id:9002,memory:12,disk:60,cpu:400,usedMemory:0,usedDisk:12,cpuUsage:0,state:'offline',port:8211,description:'Weekend exploration and base building.'},
 {name:'Creative Sandbox',slug:'creative',game:'minecraft',egg_name:'Minecraft',node_id:9002,memory:4,disk:20,cpu:200,usedMemory:0,usedDisk:3,cpuUsage:0,state:'offline',port:25566,description:'A separate world for testing builds.'},
];
export const demoServers=workloads.map((workload,index)=>({
 id:9101+index,...(workload.game==='minecraft'?{internal_id:9101+index}:{}),uuid:`demo-${workload.slug}`,identifier:`demo-${workload.slug}`,name:workload.name,description:workload.description,
 game:workload.game,egg_name:workload.egg_name,node_id:workload.node_id,node:demoNodes.find(n=>n.id===workload.node_id)!.name,
 owner_id:9001,user:9001,nest_id:9001,egg_id:9001,status:null,server_owner:true,is_suspended:false,is_installing:false,
 limits:{memory:workload.memory*GB,disk:workload.disk*GB,cpu:workload.cpu,swap:0,io:500,threads:null},
 allocation:{id:9201+index,ip:'192.0.2.10',ip_alias:'demo.invalid',port:workload.port,is_default:true},
 sftp_details:{ip:'demo.invalid',port:2022},feature_limits:{databases:2,backups:5,allocations:2},
 container:{installed:1,image:'demo-image',startup_command:'Demo preview'},
 favorite:index===0||index===1,last_visited_at:date,created_at:date,updated_at:date,
}));
export const demoAdminServers=()=>demoServers.map(server=>({...server,node:server.node_id}));
export const demoCapacityNodes=()=>demoNodes.map(node=>({...node,allocated_resources:{
 memory:demoServers.filter(s=>s.node_id===node.id).reduce((sum,s)=>sum+s.limits.memory,0),
 disk:demoServers.filter(s=>s.node_id===node.id).reduce((sum,s)=>sum+s.limits.disk,0),
}}));
export const demoResources=(id:string)=>{
 const server=demoServers.find(s=>s.uuid===id||s.identifier===id);
 if(!server)return null;
 const workload=workloads[demoServers.indexOf(server)];
 return {current_state:workload.state,is_suspended:false,resources:{cpu_absolute:workload.cpuUsage,memory_bytes:workload.usedMemory*1024**3,disk_bytes:workload.usedDisk*1024**3,network_rx_bytes:workload.state==='running'?14800000:0,network_tx_bytes:workload.state==='running'?32000000:0,uptime:workload.state==='running'?28800000:0}};
};
export const collection=(entries:unknown[])=>({object:'list',data:entries.map(attributes=>({attributes})),meta:{pagination:{total:entries.length,count:entries.length,per_page:100,current_page:1,total_pages:1}}});

const item=(attributes:unknown)=>({attributes});
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const unavailable=(detail:string,status=404)=>json({errors:[{code:'DevPreview',detail}]},status);
export function demoResponse(url:URL,method:string,body?:BodyInit|null):Response {
 const path=url.pathname;
 // Favorites and recents are ephemeral UI state, never persisted to the panel.
 const navigation=path.match(/^\/api\/client\/servers\/([^/]+)\/navigation$/);
 if(navigation&&['POST','PUT'].includes(method)){
  const server=demoServers.find(s=>s.uuid===navigation[1]);
  if(!server)return unavailable('Demo server not found.');
  if(method==='POST')server.last_visited_at=new Date().toISOString();
  else {try{const value=JSON.parse(String(body));server.favorite=value.favorite===true}catch{return unavailable('Invalid demo preference.',400)}}
  return json(item(server));
 }
 if(method!=='GET')return unavailable('Demo preview is read-only. No changes were made.',405);
 if(path==='/api/setup/status')return json({needs_setup:false,setup_allowed:false,auth_enabled:true,public_url:'http://localhost:5180',access_mode:'local',tls_mode:'proxy',restart_required:false,dev_mode:true});
 if(path==='/api/auth/session')return json({authenticated:true,user:{...demoAccount,email:undefined}});
 if(path==='/api/client/account')return json(item(demoAccount));
 if(path==='/api/client/account/activity')return json(collection([]));
 if(path==='/api/client/settings')return json(item({name:'Voltra'}));
 if(path==='/api/client/artwork/catalog')return json({});
 if(path==='/api/client'||path==='/api/client/account/server-navigation')return json(collection(demoServers));
 if(path==='/api/application/servers')return json(collection(demoAdminServers()));
 if(path==='/api/application/nodes')return json(collection(demoCapacityNodes()));
 const system=path.match(/^\/api\/admin\/nodes\/(\d+)\/system-information$/);
 if(system){const node=demoNodes.find(n=>String(n.id)===system[1]);return node?json({cpu_count:node.id===9001?16:8,architecture:'amd64',os:'linux',version:'demo'}):unavailable('Demo node not found.')}
 if(path==='/api/application/users'||path==='/api/admin/users')return json(collection([{...demoAccount,email:undefined}]));
 if(path==='/api/application/users/9001'||path==='/api/admin/users/9001')return json(item({...demoAccount,email:undefined}));
 if(path==='/api/application/locations')return json(collection([{id:9001,short:'Demo',long:'Development preview'}]));
 if(path==='/api/admin/eggs/9001')return json(item(minecraftEgg));
 if(path==='/api/admin/database-hosts')return json(collection([]));
 const applicationServer=path.match(/^\/api\/application\/servers\/(\d+)(?:\/(.+))?$/);
 if(applicationServer){
  const server=demoServers.find(s=>String(s.id)===applicationServer[1]&&s.game==='minecraft');
  if(server&&!applicationServer[2])return json(item(minecraftAdminRecord(server)));
  if(server&&applicationServer[2]==='databases')return json(collection([]));
 }
 const mounts=path.match(/^\/api\/admin\/servers\/(\d+)\/mounts$/);
 if(mounts&&demoServers.some(s=>String(s.id)===mounts[1]&&s.game==='minecraft'))return json(collection([{id:9501,name:'Shared resource packs',source:'/srv/demo/resource-packs',target:'/mnt/resource-packs',read_only:true,attached:true}]));
 const transfer=path.match(/^\/api\/admin\/servers\/(\d+)\/transfer$/);
 if(transfer&&demoServers.some(s=>String(s.id)===transfer[1]&&s.game==='minecraft'))return json(collection([]));
 const node=path.match(/^\/api\/application\/nodes\/(\d+)(?:\/(.+))?$/);
 if(node){
  const found=demoCapacityNodes().find(n=>String(n.id)===node[1]);
  if(!found)return unavailable('Demo node not found.');
  if(!node[2])return json(item(found));
  if(node[2]==='allocations')return json(collection(demoServers.filter(s=>s.node_id===found.id).map(s=>({...s.allocation,assigned:true,server_id:s.id}))));
  if(node[2]==='configuration')return json({comment:'Static demo node. No daemon is connected.'});
 }
 const client=path.match(/^\/api\/client\/servers\/([^/]+)(?:\/(.+))?$/);
 if(client){
  const server=demoServers.find(s=>s.uuid===client[1]||s.identifier===client[1]||String(s.id)===client[1]);
  if(!server)return unavailable('Demo server not found.');
  const section=client[2];
  if(server.game==='minecraft'){
   if(section==='game-settings'&&url.searchParams.has('file')&&url.searchParams.get('file')!=='/server.properties')return unavailable('This configuration file has no demo fixture.');
   const fixture=minecraftClientFixture(server,section);
   if(fixture!==undefined)return json(fixture);
  }
  if(!section)return json({...item({...server,relationships:{allocations:collection([server.allocation])}}),meta:{is_server_owner:true,user_permissions:['*']}});
  if(section==='subdomain')return json({choices:[],label:'',hostname:'',detail:'Static demo. No managed domain is configured.'});
  if(section==='resources')return json(item(demoResources(client[1])));
  if(section==='websocket')return unavailable('Static demo. Live console and commands are unavailable.',503);
  if(section==='console-history')return json({data:url.searchParams.get('after')==='2'?[]:[{id:'1',event:'panel message',line:'[Demo preview] Static sample output. No game server is connected.',created_at:date},{id:'2',event:'console output',line:`[Demo preview] ${server.name}: ${demoResources(client[1])!.current_state}`,created_at:date}],cursor:'2',more:false,capture:{connected:false},limits:{lines:5000}});
  if(section==='startup')return json({...collection([]),meta:{startup_command:'Demo preview',raw_startup_command:'Demo preview',docker_images:{Demo:'demo-image'},docker_image:'demo-image'}});
  if(section==='backups')return json({...collection([{uuid:`${server.uuid}-backup`,name:'Before update',is_successful:true,is_locked:false,bytes:268435456,created_at:date,completed_at:date}]),meta:{backup_count:1,storage:{local_bytes:268435456,remote_bytes:0,other_bytes:0,total_bytes:268435456,pending_count:0,failed_count:0}}});
  if(section==='schedules')return json(collection([{id:9301,name:'Daily backup',is_active:true,only_when_online:false,cron:{minute:'0',hour:'4',day_of_month:'*',month:'*',day_of_week:'*'},tasks:[],last_run_at:date,next_run_at:'2026-11-01T04:00:00Z'}]));
  if(['users','activity','databases','proxy-routes'].includes(section))return json(collection([]));
  if(section==='network/allocations')return json(collection([server.allocation]));
  if(section==='files/list')return json(collection(url.searchParams.get('directory')&&url.searchParams.get('directory')!=='/'?[]:[
   {name:'config',is_file:false,size:0,mimetype:'',mode_bits:'755',modified_at:date},
   {name:'saves',is_file:false,size:0,mimetype:'',mode_bits:'755',modified_at:date},
   {name:'demo-readme.txt',is_file:true,size:84,mimetype:'text/plain',mode_bits:'644',modified_at:date},
  ]));
  if(section==='files/contents')return new Response('Static development preview. These files and servers do not exist on a real node.\n',{headers:{'Content-Type':'text/plain'}});
 }
 return unavailable('This page has no demo fixture yet. Exit demo to use your panel.');
}
