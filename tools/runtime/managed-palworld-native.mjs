import {retainedPalworldLauncher} from './managed-palworld-renderer.mjs';
import fs from 'node:fs';import{join,resolve}from'node:path';import{randomBytes,randomUUID,createHash}from'node:crypto';import{spawnSync}from'node:child_process';import{managedNativeLease}from'./managed-steam-acceptance-lease.mjs';
const runtime=JSON.parse(fs.readFileSync('.local/managed-steam-native/current.json'));if(!['palworld-native','palworld-proton'].includes(runtime.game)||runtime.root!=='/var/lib/voltra-batch-20261023/managed-bridge/'+runtime.run_id||resolve(runtime.directory)!==resolve('.local/managed-steam-native',runtime.run_id)||runtime.panel_url!=='http://127.0.0.1:18098')throw Error('Owned Palworld fixture required');
const proton=runtime.game==='palworld-proton';
managedNativeLease(JSON.parse(fs.readFileSync('.local/game-batch/queue.json')),runtime.lease_id,runtime.game);
const file=join(runtime.directory,'private/game.json');let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{game:runtime.game,request_id:randomUUID(),console_password:'VoltraAdmin_'+randomBytes(8).toString('hex'),join_password:'VoltraJoin_'+randomBytes(8).toString('hex')};
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n',{mode:0o600});
const secrets=()=>[state.console_password,state.join_password,...(state.previous_passwords??[])].filter(Boolean);function redact(value){let text=JSON.stringify(value);for(const secret of secrets())text=text.replaceAll(secret,'[redacted]');return JSON.parse(text)}
const [command,label,...args]=process.argv.slice(2);if(label&&!/^[a-zA-Z0-9_-]{1,64}$/.test(label))throw Error('Bounded label required');
async function api(method,path,body){let response=await fetch(runtime.panel_url+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});let raw=await response.text(),value=raw?JSON.parse(raw):{};if(!response.ok)throw Error(JSON.stringify(redact({status:response.status,value})));return{status:response.status,value}}
const docker=(args,input)=>{const r=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',input,timeout:60000,maxBuffer:16*1024*1024});if(r.error)throw r.error;return r};
const owned=()=>{if(!state.uuid||!state.uuid.startsWith(state.identifier+'-'))throw Error('Owned UUID required');let r=docker(['inspect',state.uuid]);if(r.status)throw Error('Owned container absent');let info=JSON.parse(r.stdout)[0];if(!info.Mounts.some(m=>m.Source===runtime.root+'/volumes/'+state.uuid&&m.Destination==='/home/container'))throw Error('Owned mount mismatch');return info};
let report;
if(command==='create'){
 if(state.identifier)throw Error('Existing game must not be duplicated');save();
 const environment={SRCDS_APPID:'2394010',AUTO_UPDATE:'0',MAX_PLAYERS:'11',ADMIN_PASSWORD:state.console_password,PUBLIC_IP:'127.0.0.1',SERVER_NAME:'VoltraImported_'+runtime.run_id.slice(0,8),SERVER_PASSWORD:state.join_password,RCON_PORT:'25585',RCON_ENABLE:'True',SERVER_DESCRIPTION:'Imported eleven control native acceptance',ALLOW_CONNECT_PLATFORM:'Steam'};
 if(proton){environment.WINDOWS_INSTALL='1';environment.SERVER_DESCRIPTION='Imported twelve control Proton acceptance';}
 Object.assign(environment,state.seed_environment??{});
 const result=await api('POST','/api/client/game-library/steam/'+runtime.game+'/install',{name:'Voltra imported Palworld '+runtime.run_id.slice(0,8),node_id:runtime.node,memory:8192,max_players:11,server_password:state.join_password,request_id:state.request_id,start_on_completion:proton?false:true,environment});state={...state,...result.value.attributes,environment};save();
 const details=await api('GET','/api/application/servers?per_page=1000');let row=details.value.data.map(x=>x.attributes).find(x=>x.uuid.startsWith(state.identifier+'-'));if(!row)throw Error('Resolve created game UUID');state.uuid=row.uuid;state.internal_id=row.id;save();report=result;
}else if(command==='source'){
 const directory=join(runtime.directory,'source-at-first-install');fs.mkdirSync(directory,{recursive:true});let manifest={created_at:new Date().toISOString(),files:{}};for(const dir of ['internal/panel','internal/steamexec','internal/steamapi','internal/nodeagent']){for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.go')||x==='schema.sql')){let path=dir+'/'+name,target=join(directory,path);fs.mkdirSync(join(target,'..'),{recursive:true});let bytes=fs.readFileSync(path);fs.writeFileSync(target,bytes);manifest.files[path]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}}}for(const dir of ['internal/palworldloader','internal/panel/managed_console_assets','tools/runtime/palworld-runtime-probe']){for(const name of fs.readdirSync(dir,{recursive:true})){const path=join(dir,name);if(!fs.lstatSync(path).isFile())continue;const target=join(directory,path);fs.mkdirSync(join(target,'..'),{recursive:true});const bytes=fs.readFileSync(path);fs.writeFileSync(target,bytes);manifest.files[path]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};}}fs.writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2));report={source_files:Object.keys(manifest.files).length};
}else if(command==='options')report=await api('GET','/api/client/game-library/steam/'+runtime.game);
else{
 const prefix='/api/client/servers/'+state.identifier;
 if(command==='status')report={steam:(await api('GET',prefix+'/steam')).value,resources:(await api('GET',prefix+'/resources')).value};
 else if(['start','stop','restart'].includes(command))report=await api('POST',prefix+'/power',{signal:command});
 else if(command==='panel-console')report=await api('POST',prefix+'/command',{command:args[0]??'Info'});
 else if(command==='quick')report=await api('GET',prefix+'/quick-setup');
 else if(command==='quick-edit'){
  const view=(await api('GET',prefix+'/quick-setup')).value.attributes;const admin='EditedAdmin_'+randomBytes(8).toString('hex'),joinPassword='EditedJoin_'+randomBytes(8).toString('hex');
  report=await api('PUT',prefix+'/quick-setup',{revision:view.revision,settings:{AdminPassword:admin,ServerPassword:joinPassword,ExpRate:2,ServerName:'VoltraEdited_'+runtime.run_id.slice(0,8),ServerPlayerMaxNum:9}});state.previous_passwords=[...(state.previous_passwords??[]),state.console_password,state.join_password];state.console_password=admin;state.join_password=joinPassword;state.environment={...state.environment,ADMIN_PASSWORD:admin,SERVER_PASSWORD:joinPassword,SERVER_NAME:'VoltraEdited_'+runtime.run_id.slice(0,8),MAX_PLAYERS:'9'};save();
 }else if(command==='settings'){let environment={ALLOW_CONNECT_PLATFORM:'Xbox',SERVER_DESCRIPTION:'Edited retained native configuration',PUBLIC_IP:'127.0.0.1',RCON_PORT:'25586',AUTO_UPDATE:'1'};report=await api('PATCH',prefix+'/steam',{environment});state.environment={...state.environment,...environment};save();}
 else if(command==='admin-reinstall')report=await api('POST','/api/application/servers/'+state.uuid+'/reinstall',{});
 else if(command==='reinstall')report=await api('POST',prefix+'/settings/reinstall',{});
 else if(command==='startup')report=await api('GET',prefix+'/startup');
 else if(command==='leased-port'){
  const lease=managedNativeLease(JSON.parse(fs.readFileSync('.local/game-batch/queue.json')),runtime.lease_id,runtime.game);
  const port=lease.ports[0];if(lease.ports.length!==1||port!==28010)throw Error('Exact reviewed single leased port required');
  const status=(await api('GET',prefix+'/steam')).value.attributes,resources=(await api('GET',prefix+'/resources')).value.attributes;
  if(status.current_job||resources.current_state!=='offline'||!status.installed_build)throw Error('Terminal installed stopped game required before allocation correction');
  const server=(await api('GET','/api/application/servers/'+state.uuid)).value.attributes;
  if(server.uuid!==state.uuid||server.node!==runtime.node)throw Error('Owned server node mismatch');
  const allocations=(await api('GET','/api/application/nodes/'+runtime.node+'/allocations?per_page=1000')).value.data.map(x=>x.attributes);
  const allocation=allocations.find(x=>x.port===port&&x.ip==='127.0.0.1'&&!x.assigned);
  if(!allocation)throw Error('Reviewed unassigned lease allocation required');
  const result=await api('PATCH','/api/application/servers/'+state.uuid+'/build',{allocation_id:allocation.id,add_allocations:[allocation.id],remove_allocations:[server.allocation]});
  if(result.value.attributes.allocation!==allocation.id)throw Error('Primary allocation correction not persisted');
  await api('PATCH',prefix+'/steam',{environment:{PUBLIC_IP:state.environment.PUBLIC_IP,RCON_PORT:state.environment.RCON_PORT}});
  report={status:result.status,old_allocation:server.allocation,new_allocation:allocation.id,port,typed_native_configuration_refreshed:true,game_started:false};
 }
 else if(command==='console'||command==='wrong-password'){
  owned();const query=args[0]??'Info';let connection=command==='wrong-password'?['-a','127.0.0.1:'+state.environment.RCON_PORT,'-p','VOLTRA_PUBLIC_WRONG_FIXTURE']:['-c','/home/container/.voltra/palworld-console.json'];let r=docker(['exec',state.uuid,'timeout','20','/home/container/.voltra/console-client','-t','rcon',...connection,query]);report={exit_code:r.status,stdout:r.stdout,stderr:r.stderr};
 }else if(command==='old-password'){
  owned();if(!state.previous_passwords?.[0])throw Error('Previous own admin value required');let input=JSON.stringify({default:{address:'127.0.0.1:'+state.environment.RCON_PORT,password:state.previous_passwords[0],type:'rcon',log:''}});const script='umask 077; config=$(mktemp /tmp/voltra-old-admin-XXXXXX.json); trap \'rm -f "$config"\' EXIT; cat >"$config"; timeout 15 /home/container/.voltra/console-client -t rcon -c "$config" Info';let r=docker(['exec','-i',state.uuid,'bash','-c',script],input);report={exit_code:r.status,stdout:r.stdout,stderr:r.stderr};
 }else if(command==='logs'){owned();let r=docker(['logs','--tail','180',state.uuid]);report={output:r.stdout+r.stderr}}
 else if(command==='inspect'||command==='snapshot'){
  let info=owned();if(command==='snapshot'&&info.State.Running)throw Error('Snapshot requires stopped game');
  let r=docker(['run','--rm','-i','--pull','never','--network','none','--user','1000:1000','--read-only','--cap-drop','ALL','--memory','128m',...(command==='inspect'?['--pid','container:'+state.uuid]:[]),'--mount',`type=bind,source=${resolve('tools/runtime/managed-palworld-native-inspect.py')},target=/inspect.py,readonly`,'--mount',`type=bind,source=${resolve('tools/runtime/managed-steam-native-inspect.py')},target=/common.py,readonly`,'--mount',`type=bind,source=${runtime.root}/volumes/${state.uuid},target=/game,readonly`,'python:3.13-slim','python3','-B','/inspect.py',command,proton?'windows':'linux'],JSON.stringify({admin:state.console_password,join:state.join_password}));if(r.status)throw Error('Native inspection failed '+r.stderr);report=JSON.parse(r.stdout);report.container={uuid:state.uuid,image:info.Image,state:info.State,ports:info.HostConfig.PortBindings};
 }else if(command==='a2s'){
  const info=owned();if(!info.State.Running)throw Error('Running owned game required');const program=String.raw`import socket,struct,json
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.settimeout(5);query=b'\xff\xff\xff\xffTSource Engine Query\x00';s.sendto(query,('127.0.0.1',27015));data=s.recv(65535)
if data[:5]==b'\xff\xff\xff\xffA':s.sendto(query+data[5:9],('127.0.0.1',27015));data=s.recv(65535)
assert data[:5]==b'\xff\xff\xff\xffI','expected A2S_INFO';offset=6
fields={}
for key in ['name','map','folder','game']:
 end=data.index(b'\x00',offset);fields[key]=data[offset:end].decode('utf-8',errors='replace');offset=end+1
fields['app_id16']=struct.unpack_from('<H',data,offset)[0];offset+=2
for key in ['players','max_players','bots']:fields[key]=data[offset];offset+=1
fields['server_type']=chr(data[offset]);fields['environment']=chr(data[offset+1]);fields['password_required']=bool(data[offset+2]);print(json.dumps(fields))`;
  let result=docker(['run','--rm','--pull','never','--network','container:'+state.uuid,'--read-only','--memory','64m','--cpus','1','python:3.13-slim','python3','-B','-c',program]);if(result.status)throw Error('Owned A2S query failed '+result.stderr);report=JSON.parse(result.stdout);
 }else if(command==='launcher-source'){
  owned();const directory=join(runtime.directory,'exact-sources-'+label);fs.mkdirSync(directory,{recursive:true});const rendered=retainedPalworldLauncher(runtime.directory,proton?'windows':'linux',Number(state.environment.RCON_PORT));const expected=rendered.launcher;const script="from pathlib import Path;import base64,stat;p=Path('/game/.voltra/palworld-start.sh');assert stat.S_ISREG(p.lstat().st_mode);print(base64.b64encode(p.read_bytes()).decode())";let r=docker(['run','--rm','--pull','never','--network','none','--user','1000:1000','--read-only','--memory','64m','--mount',`type=bind,source=${runtime.root}/volumes/${state.uuid},target=/game,readonly`,'python:3.13-slim','python3','-B','-c',script]);if(r.status)throw Error('Read owned launcher failed');let actual=Buffer.from(r.stdout.trim(),'base64');if(!actual.equals(Buffer.from(expected)))throw Error('Installed launcher differs from frozen renderer');fs.writeFileSync(join(directory,'expected-palworld-start.sh'),expected);fs.writeFileSync(join(directory,'installed-palworld-start.sh'),actual);report={exact_renderer_match:true,sha256:createHash('sha256').update(actual).digest('hex')};
 }else if(command==='helper'){
  const status=(await api('GET',prefix+'/steam')).value.attributes,job=status.current_job;if(!job)throw Error('No active helper');let ids=docker(['ps','-q','--filter','label=io.voltra.steam-job']).stdout.trim().split(/\s+/).filter(Boolean);let items=ids.length?JSON.parse(docker(['inspect',...ids]).stdout):[];let info=items.find(x=>x.Config.Labels['io.voltra.steam-job'].startsWith(job.id)&&x.Mounts.some(m=>m.Source===runtime.root+'/volumes/'+state.uuid&&m.Destination==='/data'));if(!info)throw Error('Mutation helper not ready');let cmd=info.Config.Cmd;if(cmd[0]!=='-c'||cmd[2]!=='voltra-steam'||!cmd.includes('2394010')||cmd[cmd.indexOf('+login')+1]!=='anonymous')throw Error('Unexpected helper');if(proton){const index=cmd.indexOf('+@sSteamCmdForcePlatformType');if(index<0||cmd[index+1]!=='windows'||index>cmd.indexOf('+login'))throw Error('Proton requires explicit Windows publisher selection before anonymous login');}let expected=fs.readFileSync(join(runtime.directory,'source-at-first-install/internal/steamexec/docker.go'),'utf8').match(/const mutationScript = `([\s\S]*?)`/)[1];if(cmd[1]!==expected)throw Error('Actual helper differs');let dir=join(runtime.directory,'exact-sources-'+label);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(join(dir,'expected-steam-mutation.sh'),expected);fs.writeFileSync(join(dir,'actual-steam-mutation.sh'),cmd[1]);report={exact_helper_match:true,job:job.id,anonymous:true,argv:cmd.slice(2),sha256:createHash('sha256').update(cmd[1]).digest('hex')};
 }else throw Error('Unknown command');
}
report=redact(report);if(label)fs.writeFileSync(join(runtime.directory,label+'.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
