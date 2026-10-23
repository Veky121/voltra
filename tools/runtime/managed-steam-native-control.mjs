// Owned disposable native control plane. No existing service is restarted.
import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {managedNativeLease} from './managed-steam-acceptance-lease.mjs';

const base=resolve('.local/managed-steam-native'),bin=join(base,'bin'),handle=join(base,'current.json');
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run=(command,args,extra={})=>{const r=spawnSync(command,args,{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,...extra});if(r.status!==0)throw Error(command+' failed: '+(r.stderr||r.error?.message||'nonzero exit'));return r.stdout.trim();};
const docker=args=>run('docker',args);
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const lease=(game,id)=>managedNativeLease(JSON.parse(fs.readFileSync('.local/game-batch/queue.json','utf8')),id,game);
function receipt(){
 const r=JSON.parse(fs.readFileSync(handle,'utf8'));
 if(!/^[a-f0-9-]{36}$/.test(r.run_id)||r.root!=='/var/lib/voltra-batch-20261023/managed-bridge/'+r.run_id||resolve(r.directory)!==join(base,r.run_id)||r.panel_url!=='http://127.0.0.1:18098'||r.node!==202)throw Error('Unexpected owned native namespace');
 if(r.wings_container!=='voltra-managed-wings-'+r.run_id||r.connector_container!=='voltra-managed-node-'+r.run_id)throw Error('Unexpected owned process identity');
 return r;
}
const [command,game,id]=process.argv.slice(2);
fs.mkdirSync(bin,{recursive:true});
if(command==='build'){
 if(fs.existsSync(handle))throw Error('Inspect active native handle before building another artifact');
 run('go',['build','-trimpath','-o',join(bin,'voltra-node-linux'),'./cmd/node'],{env:{...process.env,GOOS:'linux',GOARCH:'amd64',CGO_ENABLED:'0'}});
 run('go',['test','-c','-o',join(bin,'panel-managed-native.test.exe'),'./internal/panel']);
 save(join(bin,'build.json'),{built_at:new Date().toISOString(),node_sha256:sha(join(bin,'voltra-node-linux')),panel_test_sha256:sha(join(bin,'panel-managed-native.test.exe')),native_test_source_sha256:sha('internal/panel/steam_catalog_native_test.go'),source_plan:JSON.parse(fs.readFileSync('artifacts/managed-steam-native-acceptance-plan.json','utf8')).source_sha256});
 console.log('Built isolated source Panel test executable and Linux connector; no runtime started');
}else if(command==='start'){
 lease(game,id);
 if(fs.existsSync(handle))throw Error('Existing native handle must be inspected first');
 const built=JSON.parse(fs.readFileSync(join(bin,'build.json'),'utf8'));
 if(built.node_sha256!==sha(join(bin,'voltra-node-linux'))||built.panel_test_sha256!==sha(join(bin,'panel-managed-native.test.exe')))throw Error('Native build provenance changed');
 const line=fs.readFileSync('.local/runtime.env','utf8').replace(/^\uFEFF/,'').split(/\r?\n/).find(line=>line.startsWith('DATABASE_URL='));
 if(!line)throw Error('Private fixture database transport unavailable');
 const dsn=line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g,'');
 const log=fs.openSync(join(base,'panel-harness-private.log'),'a',0o600);
 const child=spawn(join(bin,'panel-managed-native.test.exe'),['-test.run=^TestSteamCatalogNativeAcceptanceHarness$','-test.v','-test.timeout=3h10m'],{cwd:resolve('internal/panel'),env:{...process.env,TEST_DATABASE_URL:dsn,VOLTRA_MANAGED_NATIVE_GAME:game,VOLTRA_MANAGED_NATIVE_LEASE:id},windowsHide:true,detached:true,stdio:['ignore',log,log]});
 child.unref();fs.closeSync(log);
 let r;
 for(let n=0;n<30;n++){if(fs.existsSync(handle)){r=receipt();break;}await sleep(500);}
 if(!r)throw Error('Isolated Panel failed to publish handle; inspect private log');
 save(join(r.directory,'process.json'),{panel_pid:child.pid,build:built,started_at:new Date().toISOString(),existing_services_changed:false});
 console.log(JSON.stringify({phase:'prepared',panel_pid:child.pid,run_id:r.run_id,receipt:join(r.directory,'receipt.json'),root:r.root,wings:r.wings_container,connector:r.connector_container}));
 // Recheck ownership immediately before any native container mutation.
 lease(game,id);
 for(const image of ['python:3.13-slim','pteroclone-wings:local','voltra-steam-node-test:local'])docker(['image','inspect',image,'--format','{{.Id}}']);
 const program="from pathlib import Path;import shutil,os;root=Path('/native');[(root/p).mkdir(parents=True,exist_ok=True,mode=0o700) for p in ['private','bin','volumes','logs','backups','archives','tmp','steam-jobs']];[(shutil.copyfile('/source/'+p,root/'private'/p),os.chmod(root/'private'/p,0o600)) for p in ['node.json','wings.json']];shutil.copyfile('/node-source',root/'bin/voltra-node');os.chmod(root/'bin/voltra-node',0o755)";
 docker(['run','--rm','--pull','never','--network','none','--memory','128m','--mount',`type=bind,source=${join(r.directory,'private')},target=/source,readonly`,'--mount',`type=bind,source=${join(bin,'voltra-node-linux')},target=/node-source,readonly`,'-v',r.root+':/native','python:3.13-slim','python3','-c',program]);
 docker(['run','-d','--name',r.wings_container,'--label','voltra.owner=managed-steam-bridge','--pull','never','--memory','512m','--cpus','1','--network','voltra-batch-20261023','-e','WINGS_UID=1000','-e','WINGS_GID=1000','-e','WINGS_USERNAME=container','-p','127.0.0.1:18191:18191','-p','127.0.0.1:12131:12131','--mount',`type=bind,source=${r.root}/private/wings.json,target=/etc/pterodactyl/config.yml,readonly`,'--mount',`type=bind,source=${resolve('.local/wings-install-status')},target=/usr/bin/wings,readonly`,'-v','/var/run/docker.sock:/var/run/docker.sock','-v','/run/wings:/run/wings','-v',r.root+':'+r.root,'pteroclone-wings:local','--config','/etc/pterodactyl/config.yml']);
 docker(['run','-d','--name',r.connector_container,'--label','voltra.owner=managed-steam-bridge','--pull','never','--memory','256m','--cpus','1','--network','container:'+r.wings_container,'--mount',`type=bind,source=${r.root}/private/node.json,target=/etc/voltra/node.json,readonly`,'--mount',`type=bind,source=${r.root}/private/wings.json,target=/etc/voltra/wings.yml,readonly`,'--mount',`type=bind,source=${r.root}/bin/voltra-node,target=/usr/local/bin/voltra-node,readonly`,'--mount',`type=bind,source=${r.root}/steam-jobs,target=/var/lib/voltra/steam-jobs`,'-v','/var/run/docker.sock:/var/run/docker.sock','-v',r.root+':'+r.root,'voltra-steam-node-test:local','-c','socat TCP-LISTEN:18098,bind=127.0.0.1,fork,reuseaddr TCP:host.docker.internal:18098 & exec /usr/local/bin/voltra-node run --config /etc/voltra/node.json']);
 r.phase='controllers_started';save(join(r.directory,'receipt.json'),r);save(handle,r);
 console.log('Fresh isolated control processes started; no native game created');
}else if(command==='status'){
 const r=receipt();console.log(JSON.stringify({run_id:r.run_id,phase:r.phase,game:r.game,root:r.root,lease_id:r.lease_id,process:JSON.parse(fs.readFileSync(join(r.directory,'process.json'),'utf8'))}));
}else if(command==='stop'){
 const r=receipt();fs.writeFileSync(join(r.directory,'stop'),'stop\n',{mode:0o600});
 for(let n=0;n<120&&fs.existsSync(handle);n++)await sleep(1000);
 if(fs.existsSync(handle))throw Error('Owned harness has not acknowledged stop; inspect rather than killing another process');
 console.log('Fixture Panel and receipt-owned containers stopped; retained volume namespace awaits explicit cleanup');
}else throw Error('Usage: managed-steam-native-control.mjs build | start GAME LEASE | status | stop');
