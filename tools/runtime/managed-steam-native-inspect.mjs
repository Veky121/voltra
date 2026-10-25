import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {managedNativeLease} from './managed-steam-acceptance-lease.mjs';

const base=resolve('.local/managed-steam-native');
const runtime=JSON.parse(fs.readFileSync(join(base,'current.json'),'utf8'));
if(!/^[a-f0-9-]{36}$/.test(runtime.run_id)||runtime.root!=='/var/lib/voltra-batch-20261023/managed-bridge/'+runtime.run_id||runtime.panel_url!=='http://127.0.0.1:18098'||resolve(runtime.directory)!==join(base,runtime.run_id))throw Error('Unexpected native fixture scope');
managedNativeLease(JSON.parse(fs.readFileSync('.local/game-batch/queue.json','utf8')),runtime.lease_id,runtime.game);
const state=JSON.parse(fs.readFileSync(join(runtime.directory,'private','game.json'),'utf8'));
if(!/^[a-f0-9-]{36}$/.test(state.uuid)||!state.uuid.startsWith(state.identifier+'-'))throw Error('Unexpected owned game identity');
const docker=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});if(r.status)throw Error('Owned native inspection failed');return r.stdout;};
const info=JSON.parse(docker(['inspect',state.uuid]))[0];
const volume=runtime.root+'/volumes/'+state.uuid;
if(info.Name!=='/'+state.uuid||!info.Mounts.some(mount=>mount.Source===volume&&mount.Destination==='/home/container'))throw Error('Game container is outside receipt-owned volume namespace');
const snapshot=process.argv.includes('--snapshot');
const consoleSHA=runtime.game==='7days'?JSON.parse(fs.readFileSync('internal/panel/managed_console_assets/manifest.json','utf8')).artifacts.find(a=>a.architecture==='amd64')?.sha256:undefined;
if(snapshot){
 if(info.State.Running)throw Error('Protected snapshot requires the real game stopped');
 const response=await fetch(runtime.panel_url+'/api/client/servers/'+state.identifier+'/steam');
 if(!response.ok||(await response.json()).attributes.current_job)throw Error('Protected snapshot requires no active Steam maintenance');
}else if(!info.State.Running)throw Error('Native process/socket inspection requires the game running');
const output=docker(['run','--rm','-i','--pull','never','--network','none','--user','1000:1000','--memory','128m','--cpus','1','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',...(snapshot?[]:['--pid','container:'+state.uuid]),'--mount',`type=bind,source=${resolve('tools/runtime/managed-steam-native-inspect.py')},target=/inspect.py,readonly`,'--mount',`type=bind,source=${volume},target=/game,readonly`,'python:3.13-slim','python3','-B','/inspect.py','--game',runtime.game,'--expected-stdin',...(snapshot?['--snapshot']:[])],JSON.stringify({console_password:state.console_password,console_sha256:consoleSHA}));
const result=JSON.parse(output);
const secrets=[state.console_password,state.game_admin_password,state.game_token,...(state.previous_console_passwords??[])].filter(Boolean).flatMap(secret=>[secret,secret.trim(),JSON.stringify(secret).slice(1,-1)]).filter(Boolean);
function containsSecret(value){if(typeof value==='string')return secrets.some(secret=>value.includes(secret));if(Array.isArray(value))return value.some(containsSecret);if(value&&typeof value==='object')return Object.values(value).some(containsSecret);return false;}
if(containsSecret(result))throw Error('Native evidence unexpectedly contains a private credential');
result.container={uuid:state.uuid,image_id:info.Image,runtime_image:info.Config.Image,user:info.Config.User,state:{running:info.State.Running,exit_code:info.State.ExitCode,oom:info.State.OOMKilled,started_at:info.State.StartedAt,finished_at:info.State.FinishedAt},ports:info.HostConfig.PortBindings};
const name=process.argv.find(argument=>argument.startsWith('--save='))?.slice('--save='.length);
if(name){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(name))throw Error('Use a bounded evidence label');fs.writeFileSync(join(runtime.directory,name+'.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});}
console.log(JSON.stringify(result));
