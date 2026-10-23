import fs from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {managedNativeLease} from './managed-steam-acceptance-lease.mjs';
const [operation,sourceRun]=process.argv.slice(2);
if(!['export','restore'].includes(operation))throw Error('Choose export or restore');
const runtime=JSON.parse(fs.readFileSync('.local/managed-steam-native/current.json'));
managedNativeLease(JSON.parse(fs.readFileSync('.local/game-batch/queue.json')),runtime.lease_id,runtime.game);
if(runtime.game!=='satisfactory'||runtime.root!=='/var/lib/voltra-batch-20261023/managed-bridge/'+runtime.run_id||resolve(runtime.directory)!==resolve('.local/managed-steam-native',runtime.run_id))throw Error('Unexpected own fixture namespace');
const privateFile=join(runtime.directory,'private/game.json'),game=JSON.parse(fs.readFileSync(privateFile));
if(!/^[a-f0-9-]{36}$/.test(game.uuid)||!game.uuid.startsWith(game.identifier+'-'))throw Error('Owned game identity unavailable');
const docker=args=>{const r=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',maxBuffer:1024*1024,timeout:30000});if(r.status)throw Error('Guarded private operator transfer failed; inspect retained own evidence');return r.stdout;};
const info=JSON.parse(docker(['inspect',game.uuid]))[0],volume=runtime.root+'/volumes/'+game.uuid;
if(info.State.Running||!info.Mounts.some(m=>m.Source===volume&&m.Destination==='/home/container'))throw Error('Private transfer requires owned stopped game');
const response=await fetch(runtime.panel_url+'/api/client/servers/'+game.identifier+'/steam');
if(!response.ok||(await response.json()).attributes.current_job)throw Error('Private transfer requires no active Steam job');
let directory;
if(operation==='export'){
 directory=join(runtime.directory,'private/operator-export');fs.mkdirSync(directory,{mode:0o700});
}else{
 if(!/^[a-f0-9-]{36}$/.test(sourceRun)||sourceRun===runtime.run_id)throw Error('Exact distinct closed fixture source required');
 const source=JSON.parse(fs.readFileSync(resolve('.local/managed-steam-native',sourceRun,'receipt.json')));
 if(source.game!=='satisfactory'||source.lease_id!==runtime.lease_id||source.phase!=='stopped'||!fs.existsSync(resolve('.local/managed-steam-native',sourceRun,'closed-handle.json')))throw Error('Source must be same-lease closed Satisfactory fixture');
 directory=resolve('.local/managed-steam-native',sourceRun,'private/operator-export');
 const receipt=JSON.parse(fs.readFileSync(join(directory,'private-receipt.json')));
 if(receipt.source_run!==sourceRun||receipt.source_uuid!==JSON.parse(fs.readFileSync(resolve('.local/managed-steam-native',sourceRun,'private/game.json'))).uuid)throw Error('Private source identity mismatch');
 for(const [name,expected] of Object.entries(receipt.sha256))if(createHash('sha256').update(fs.readFileSync(join(directory,name))).digest('hex')!==expected)throw Error('Private export checksum changed');
}
const result=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--cpus','1','--mount',`type=bind,source=${resolve('tools/runtime/managed-steam-operator-archive.py')},target=/archive.py,readonly`,'--mount',`type=bind,source=${volume},target=/game${operation==='export'?',readonly':''}`,'--mount',`type=bind,source=${directory},target=/export${operation==='restore'?',readonly':''}`,'python:3.13-slim','python3','-B','/archive.py',operation]));
if(operation==='export'){
 const admin={game_admin_password:game.game_admin_password,game_token:game.game_token};
 fs.writeFileSync(join(directory,'admin-state.json'),JSON.stringify(admin)+'\n',{mode:0o400});
 const receipt={source_run:runtime.run_id,source_uuid:game.uuid,sha256:{}};
 for(const name of ['operator.tar.gz','manifest.json','admin-state.json'])receipt.sha256[name]=createHash('sha256').update(fs.readFileSync(join(directory,name))).digest('hex');
 fs.writeFileSync(join(directory,'private-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o400});
}else{
 const admin=JSON.parse(fs.readFileSync(join(directory,'admin-state.json')));
 fs.writeFileSync(privateFile,JSON.stringify({...game,...admin},null,2)+'\n',{mode:0o600});
}
const evidence={observed_at:new Date().toISOString(),operation,run:runtime.run_id,source_run:sourceRun??runtime.run_id,...result};
fs.writeFileSync(join(runtime.directory,'operator-'+operation+'.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(evidence));
