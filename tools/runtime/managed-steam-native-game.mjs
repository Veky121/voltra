// Operate only the receipt-owned game in the isolated managed native fixture.
import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {managedNativeLease} from './managed-steam-acceptance-lease.mjs';

const base=resolve('.local/managed-steam-native');
const runtime=JSON.parse(fs.readFileSync(join(base,'current.json'),'utf8'));
if(!/^[a-f0-9-]{36}$/.test(runtime.run_id)||runtime.root!=='/var/lib/voltra-batch-20261023/managed-bridge/'+runtime.run_id||runtime.panel_url!=='http://127.0.0.1:18098'||resolve(runtime.directory)!==join(base,runtime.run_id))throw Error('Unexpected native fixture scope');
const active=()=>managedNativeLease(JSON.parse(fs.readFileSync('.local/game-batch/queue.json','utf8')),runtime.lease_id,runtime.game);
active();
const file=join(runtime.directory,'private','game.json');
function freshConsolePassword(){
 const base='+quit fixture "quoted" \\ λé '+randomBytes(20).toString('hex');
 const remaining=1024-Buffer.byteLength(base,'utf8');
 return base+'é'.repeat(Math.floor(remaining/2))+(remaining%2?'Z':'');
}
let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{game:runtime.game,request_id:randomUUID(),console_password:freshConsolePassword()};
if(state.game!==runtime.game)throw Error('Native game receipt mismatch');
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n',{mode:0o600});
save();
function redact(value){
 if(Array.isArray(value))return value.map(redact);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,value])=>[key,/password|token|secret|authorization/i.test(key)&&typeof value!=='boolean'?(value?'[configured]':''):redact(value)]));
 if(typeof value==='string'){for(const secret of [state.console_password,state.game_admin_password,state.game_token,...(state.previous_console_passwords??[])].filter(Boolean))value=value.replaceAll(secret,'[redacted]');}
 return value;
}
async function api(method,path,body){
 active();
 const response=await fetch(runtime.panel_url+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 const text=await response.text();let result;try{result=text?JSON.parse(text):{};}catch{throw Error('Fixture Panel returned non-JSON response');}
 if(!response.ok)throw Error(JSON.stringify(redact({status:response.status,result})));
 return result;
}
const [command,...args]=process.argv.slice(2);
if(command==='create'){
 if(state.identifier)throw Error('Inspect existing owned native game instead of creating another');
 const ports=active().ports;
 const environment=runtime.game==='7days'?{AUTO_UPDATE:'0',GAME_DIFFICULTY:'3',PASSWORD:state.console_password,TELNET_PORT:'9087',SERVER_DISABLED_NETWORK_PROTOCOLS:'SteamNetworking',LD_LIBRARY_PATH:'.',SRCDS_BETAID:''}:{AUTO_UPDATE:'0',VALIDATE:'1',NUM_AUTOSAVES:'2',INIT_CONNECT_TIMEOUT:'47.5',CONNECT_TIMEOUT:'29.5',RELIABLE_PORT:String(ports[1]),SRCDS_BETAID:'',SRCDS_BETAPASS:''};
 const body={name:'Voltra managed '+runtime.game+' '+runtime.run_id.slice(0,8),node_id:202,memory:runtime.game==='7days'?8192:12288,max_players:runtime.game==='7days'?12:6,request_id:state.request_id,environment};
 const result=await api('POST','/api/client/game-library/steam/'+runtime.game+'/install',body);
 if(!result.attributes?.identifier)throw Error('Missing owned native server identifier');
 state={...state,...result.attributes,environment};save();
 const details=await api('GET','/api/application/servers?per_page=1000');
 const owned=details.data?.map(item=>item.attributes).find(server=>server.uuid?.startsWith(state.identifier+'-'));
 if(!owned?.uuid)throw Error('Created server is recorded privately; resolve its owned identity before continuing');
 state.uuid=owned.uuid;state.internal_id=owned.id;save();
 console.log(JSON.stringify(redact(result)));
}else{
 if(!state.identifier)throw Error('Create the owned game first');
 const prefix='/api/client/servers/'+encodeURIComponent(state.identifier);
 let result;
 if(command==='status')result={steam:await api('GET',prefix+'/steam'),resources:await api('GET',prefix+'/resources')};
 else if(command==='power'){
  if(!['start','stop','restart'].includes(args[0]))throw Error('Choose start,stop,restart');
  result=await api('POST',prefix+'/power',{signal:args[0]});
 }else if(command==='console'){
  if(!args[0]||/[\r\n\0]/.test(args[0])||args[0].length>256)throw Error('One bounded native console command required');
  result=await api('POST',prefix+'/command',{command:args[0]});
 }else if(command==='settings'||command==='settings-file'){
  const input=JSON.parse(command==='settings-file'?fs.readFileSync(args[0],'utf8').replace(/^\uFEFF/,''):args[0]??'{}');
  if(input.beta_password||input.environment?.PASSWORD||input.environment?.SRCDS_BETAPASS)throw Error('Credential arguments must stay in private fixture files');
  result=await api('PATCH',prefix+'/steam',input);
  if(runtime.game==='7days'&&input.environment?.PASSWORD===''){
   state.previous_console_passwords=[...(state.previous_console_passwords??[]),state.console_password];state.console_password='';
  }
  state.environment={...state.environment,...input.environment};save();
 }else if(['rotate-console','rotate-console-basic','rotate-console-trimmed','rotate-console-utf8','rotate-console-1024'].includes(command)){
  if(runtime.game!=='7days')throw Error('Private console rotation is7Days-only');
  const next='  +quit rotated "quoted" \\ λé '+randomBytes(12).toString('hex')+'  ';
  const selected=command==='rotate-console-basic'?'VoltraFixture'+randomBytes(18).toString('hex'):command==='rotate-console-trimmed'?state.previous_console_passwords[0].trim():command==='rotate-console-utf8'?next.trim():command==='rotate-console-1024'?randomBytes(512).toString('hex'):next;
  result=await api('PUT',prefix+'/startup/variable',{key:'PASSWORD',value:selected});
  state.previous_console_passwords=[...(state.previous_console_passwords??[]),state.console_password];state.console_password=selected;save();
 }else if(command==='maintenance'){
  if(!['check','update','verify'].includes(args[0]))throw Error('Choose check,update,verify');
  result=await api('POST',prefix+'/steam/'+args[0],{});
 }else if(command==='reinstall-client'){
  result=await api('POST',prefix+'/settings/reinstall',{});
 }else if(command==='reinstall-admin'){
  result=await api('POST','/api/application/servers/'+encodeURIComponent(state.uuid)+'/reinstall',{});
 }else if(command==='startup')result=await api('GET',prefix+'/startup');
 else throw Error('Choose create,status,power,console,settings,maintenance,startup');
 console.log(JSON.stringify(redact(result)));
}
