import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider,useNavigate} from 'react-router-dom';
import App from '../../src/App';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/sidebar.css';
import '../../src/user-theme.css';
import '../../src/design-system.css';
import '../../src/shell-ui.css';
import '../../src/shadcn.css';
import '../../src/shadcn-app.css';
import '../../src/glass-surfaces.css';
const params=new URLSearchParams(location.search),account=params.get('account')||'theme-fixture-a';
const servers=[{id:1,uuid:'fixture-server',identifier:'fixture',name:'Survival SMP',status:null,favorite:true,last_visited_at:'2026-10-25T10:00:00Z',egg_name:'Minecraft',game:'minecraft',limits:{memory:8192,disk:32768,cpu:400},allocation:{ip:'192.168.1.10',port:25565},node:'home-server',node_id:1,user:1,owner_id:1},
 {id:2,uuid:'fixture-creative',identifier:'creative',name:'Creative sandbox',status:null,favorite:false,last_visited_at:'2026-10-24T18:00:00Z',egg_name:'Minecraft',game:'minecraft',limits:{memory:4096,disk:16384,cpu:200},allocation:{ip:'192.168.1.10',port:25566},node:'home-server',node_id:1,user:1,owner_id:1},
 {id:3,uuid:'fixture-factory',identifier:'factory',name:'Satisfactory',status:null,favorite:true,last_visited_at:'2026-10-23T18:00:00Z',egg_name:'Satisfactory',game:'satisfactory',limits:{memory:16384,disk:65536,cpu:600},allocation:{ip:'192.168.1.10',port:7777},node:'home-server',node_id:1,user:1,owner_id:1}];
const collection=(entries:any[])=>({object:'list',data:entries.map(attributes=>({attributes})),meta:{pagination:{total:entries.length,count:entries.length,per_page:100,current_page:1,total_pages:1}}});
const users=[{id:1,uuid:account,email:'vek@example.test',username:'vek',nickname:'Veky',root_admin:true,language:'en',created_at:'2026-10-25T10:00:00Z'}];
const nodes=[{id:1,uuid:'fixture-node',name:'Home server',fqdn:'home-server',scheme:'https',location_id:1,memory:65536,memory_overallocate:0,disk:1048576,disk_overallocate:0,daemon_listen:8080,daemon_sftp:2022,maintenance_mode:false,behind_proxy:true,public:true}];
const consoleFixture={captureConnected:!params.has('captureDisconnected'),historyFailure:false,backfill:false,socket:null as any,logRequests:0};
(window as any).consoleFixture=consoleFixture;
class PreviewSocket{
 static OPEN=1;readyState=1;onopen:((event:any)=>void)|null=null;onmessage:((event:any)=>void)|null=null;onclose:((event:any)=>void)|null=null;onerror:((event:any)=>void)|null=null;
 constructor(_url:string){consoleFixture.socket=this;setTimeout(()=>this.onopen?.({}),15)}
 send(raw:string){const event=JSON.parse(raw).event;if(event==='send logs'){consoleFixture.logRequests++;if(params.has('captureDisconnected'))setTimeout(()=>this.onmessage?.({data:JSON.stringify({event:'console output',args:['Fixture live log from Wings']})}),10)}if(event==='auth'){setTimeout(()=>{this.onmessage?.({data:JSON.stringify({event:'auth success',args:[]})});this.onmessage?.({data:JSON.stringify({event:'status',args:['running']})})},10)}}
 close(){this.readyState=3;this.onclose?.({})}
}
(window as any).WebSocket=PreviewSocket;
const requests:unknown[]=[];(window as any).themeRequests=requests;
const uiErrors:string[]=[];(window as any).uiErrors=uiErrors;window.addEventListener('error',event=>uiErrors.push(event.message));window.addEventListener('unhandledrejection',event=>uiErrors.push(String(event.reason)));
if(params.has('storageError'))Storage.prototype.setItem=function(){throw new DOMException('Storage is unavailable','QuotaExceededError')};
window.fetch=async(input,init)=>{
 const url=new URL(String(input),location.href),path=url.pathname;let data:any={data:[]};
 if(init?.method&&init.method!=='GET')requests.push({path,method:init.method,body:init.body?JSON.parse(String(init.body)):null});
 if(path==='/api/setup/status')data={needs_setup:params.get('mode')==='setup',setup_allowed:true,auth_enabled:params.get('mode')!=='setup',public_url:'http://localhost:8088',access_mode:'local',tls_mode:'proxy',restart_required:false,dev_mode:false};
 if(path==='/api/auth/session')data={authenticated:!['login','setup'].includes(params.get('mode')||''),user:{root_admin:true}};
 if(path==='/api/client/account')data={attributes:{uuid:account,id:account,email:'vek@example.test',username:'vek',nickname:'Veky',root_admin:true}};
 if(path==='/api/client/settings')data={attributes:{name:'Voltra'}};
 if(path==='/api/client')data=collection(servers);
 if(path==='/api/client/account/server-navigation')data={data:servers.map(attributes=>({attributes}))};
 if(path==='/api/client/servers/fixture')data={attributes:{...servers[0],uuid:'fixture-server',node:'home-server',description:'Our Minecraft server',game:'minecraft',server_owner:!params.has('readonly'),sftp_details:{ip:'home-server',port:2022},permissions:[]},meta:{user_permissions:[]}};
 if(path.endsWith('/resources')){const offline=path.includes('creative');data={attributes:{current_state:offline?'offline':'running',is_suspended:false,resources:{cpu_absolute:offline?0:32,memory_bytes:offline?0:2576980377,disk_bytes:1073741824,network_rx_bytes:102400,network_tx_bytes:204800,uptime:offline?0:7200000}}}}
 if(path.endsWith('/websocket'))data={attributes:{socket:'ws://preview.invalid/console',token:'fixture'}};
 if(path.endsWith('/console-history'))data={data:url.searchParams.get('after')==='3'?[]:[{id:'1',event:'panel message',line:'[Voltra]: Start requested.',created_at:'2026-10-25T10:00:00Z'},{id:'2',event:'console output',line:'[Server thread/INFO]: Starting minecraft server version 1.21.4',created_at:'2026-10-25T10:00:01Z'},{id:'3',event:'console output',line:'[Server thread/INFO]: Done (4.253s)! For help, type "help"',created_at:'2026-10-25T10:00:05Z'}],cursor:'3',more:false,capture:{connected:true},limits:{lines:5000}};
 if(path.endsWith('/console-history')&&params.has('captureDisconnected')){
  if(consoleFixture.historyFailure)return new Response(JSON.stringify({errors:[{detail:'Fixture history unavailable'}]}),{status:503,headers:{'Content-Type':'application/json'}});
  const after=url.searchParams.get('after');
  data={data:!after||after==='0'?[{id:'1',event:'panel message',line:'[Voltra]: Saved power request.',created_at:'2026-10-25T10:00:00Z'}]:consoleFixture.backfill&&after==='1'?[{id:'2',event:'console output',line:'Fixture live log from Wings',created_at:'2026-10-25T10:00:01Z'}]:[],cursor:consoleFixture.backfill?'2':'1',more:false,capture:{connected:consoleFixture.captureConnected},limits:{lines:5000}};
 }
 if(path.endsWith('/startup'))data={data:[],meta:{startup_command:'java -Xms128M -Xmx8192M -jar server.jar',raw_startup_command:'java -Xms128M -Xmx8192M -jar server.jar',docker_images:{'Java 21':'ghcr.io/pterodactyl/yolks:java_21'},docker_image:'ghcr.io/pterodactyl/yolks:java_21'}};
 if(path==='/api/client/game-library/templates')data={games:[{id:'factorio',name:'Factorio',category:'factorio',source:'fixture/factorio/egg.json',description:'Factory server',available:true,verification:'verified',detail:''},{id:'terraria',name:'Terraria',category:'terraria',source:'fixture/terraria/egg.json',description:'Adventure server',available:true,verification:'verified',detail:''}],can_install:true};
 if(path==='/api/client/game-library/steam')data={games:[{id:'satisfactory',name:'Satisfactory',description:'Factory server'},{id:'palworld-native',name:'Palworld',description:'Dedicated server'},{id:'valheim',name:'Valheim',description:'Dedicated server'}]};
 if(path==='/api/application/servers')data=collection(servers);
 if(path==='/api/application/nodes')data=collection(nodes);
 if(path==='/api/application/users')data=collection(users);
 if(path==='/api/application/locations')data=collection([{id:1,short:'Home',long:'Home network'}]);
 if(path==='/api/application/nests')data=collection([{id:1,name:'Minecraft',description:'Minecraft servers'}]);
 if(path==='/api/application/nodes/1')data={attributes:nodes[0]};
 if(path==='/api/application/users/1')data={attributes:users[0]};
 if(path==='/api/application/servers/1')data={attributes:{...servers[0],owner_id:1,nest_id:1,egg_id:1,node_id:1,description:'Our Minecraft server',environment:{},container:{startup_command:'java -jar server.jar',image:'java:21'},feature_limits:{databases:2,backups:5,allocations:2}}};
 if(path.endsWith('/files/list'))data=collection([{name:'config',is_file:false,size:0,modified_at:'2026-10-25T10:00:00Z',mimetype:'',mode_bits:'755'},{name:'world',is_file:false,size:0,modified_at:'2026-10-25T10:00:00Z',mimetype:'',mode_bits:'755'},{name:'server.properties',is_file:true,size:1024,modified_at:'2026-10-25T10:00:00Z',mimetype:'text/plain',mode_bits:'644'},{name:'server.jar',is_file:true,size:42857231,modified_at:'2026-10-25T10:00:00Z',mimetype:'application/java-archive',mode_bits:'644'}]);
 if(path.endsWith('/files/contents')||path.endsWith('/files/download-stream'))return new Response('server-name=Survival SMP\nmax-players=20\nmotd=Welcome\n',{headers:{'Content-Type':'text/plain'}});
 if(path.endsWith('/schedules'))data=collection([{id:1,name:'Daily backup',is_active:true,only_when_online:false,cron:{minute:'0',hour:'4',day_of_month:'*',month:'*',day_of_week:'*'},tasks:[],last_run_at:'2026-10-25T04:00:00Z',next_run_at:'2026-10-26T04:00:00Z'}]);
 if(path.endsWith('/backups'))data=collection([{uuid:'fixture-backup',name:'Before update',is_successful:true,is_locked:false,bytes:268435456,created_at:'2026-10-25T04:00:00Z',completed_at:'2026-10-25T04:01:00Z'}]);
 return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
function Fixture(){const navigate=useNavigate();React.useEffect(()=>{(window as any).uiNavigate=navigate},[navigate]);return <App/>}
const router=createMemoryRouter([{path:'*',element:<Fixture/>}],{initialEntries:[params.get('view')||'/account/appearance']});
createRoot(document.getElementById('root')!).render(<React.StrictMode><RouterProvider router={router}/></React.StrictMode>);
