// Hash selected persistent paths on the owned temporary acceptance node.
// Usage: node game-volume-snapshot.mjs receipt.json output.json relative-path [...]
import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const [receiptPath,outputPath,...paths]=process.argv.slice(2),receipt=JSON.parse(fs.readFileSync(receiptPath));
if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(receipt.uuid)||!paths.length||paths.some(path=>!path||path.startsWith('/')||path.split('/').includes('..')))throw Error('Specify owned receipt and relative persistent paths');
let localNode,localInfo,localImage;
if(receipt.node_receipt){
 localNode=JSON.parse(fs.readFileSync(receipt.node_receipt));
 if(localNode.node!==receipt.node||localNode.root!=='/var/lib/voltra-batch-20261023'||localNode.container!=='voltra-batch-20261023')throw Error('Local node receipt mismatch');
 const response=await fetch('http://127.0.0.1:8088/api/client/servers/'+receipt.identifier,{signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Owned local server lookup failed');
 const server=(await response.json()).attributes;
 if(server.uuid!==receipt.uuid||server.status!==null)throw Error('Local snapshot requires the installed owned server');
 const inspect=spawnSync('docker',['inspect',receipt.uuid],{windowsHide:true,encoding:'utf8'});
 if(inspect.status)throw Error('Owned local container inspection failed');
 localInfo=JSON.parse(inspect.stdout)[0];
 if(localInfo.State.Running)throw Error('Snapshot requires a stopped game');
 if(!/^[0-9]+:[0-9]+$/.test(localInfo.Config.User))throw Error('Snapshot requires an explicit numeric game UID:GID');
 if(!localInfo.Mounts.some(mount=>mount.Source===localNode.volume_root+'/'+receipt.uuid&&mount.Destination==='/home/container'))throw Error('Container volume does not match owned node');
 const image=spawnSync('docker',['image','inspect','python:3.13-slim','--format','{{.Id}}'],{windowsHide:true,encoding:'utf8'});
 if(image.status||!/^sha256:[a-f0-9]{64}$/.test(image.stdout.trim()))throw Error('Local Python helper image missing');
 localImage=image.stdout.trim();
}
const script=`import pathlib,subprocess,json,hashlib
uuid='${receipt.uuid}';root=pathlib.Path('${localNode?'/snapshot':'/var/lib/voltra-temp-20261022-lan/volumes/'+receipt.uuid}')
info=${localInfo?'json.loads('+JSON.stringify(JSON.stringify({State:localInfo.State}))+')':"json.loads(subprocess.check_output(['docker','inspect',uuid],text=True))[0]"}
assert not info['State']['Running'], 'Snapshot requires a stopped game'
paths=json.loads(${JSON.stringify(JSON.stringify(paths))});selected={}
for relative in paths:
 path=root/relative
 assert path.resolve().is_relative_to(root.resolve()), 'Selected path leaves the volume'
 assert path.exists(), 'Selected persistent path is missing: '+relative
 for entry in ([path] if path.is_file() else path.rglob('*')):
  if not entry.is_file():continue
  name=str(entry.relative_to(root))
  if entry.name in ['server_log.txt','client_log.txt'] or entry.suffix.lower()=='.log' or any(p.lower() in ['logs','backup_logs'] for p in entry.relative_to(root).parts):continue
  assert entry.resolve().is_relative_to(root.resolve()), 'Persistent file leaves the volume'
  digest=hashlib.sha256()
  with entry.open('rb') as source:
   for block in iter(lambda:source.read(1048576),b''):digest.update(block)
  metadata=entry.stat()
  selected[name]={'sha256':digest.hexdigest(),'bytes':metadata.st_size,'mode':oct(metadata.st_mode&511),'uid':metadata.st_uid,'gid':metadata.st_gid}
release=root/'.voltra/steam-template-release.json'
print(json.dumps({'uuid':uuid,'exit_code':info['State']['ExitCode'],'oom_killed':info['State']['OOMKilled'],'files':dict(sorted(selected.items())),'release':json.loads(release.read_text()) if release.is_file() else None}))
`;
const childOptions={windowsHide:true,input:script,encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024};
const result=localNode?spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--user',localInfo.Config.User,'--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--mount',`type=bind,source=${localNode.volume_root}/${receipt.uuid},target=/snapshot,readonly`,localImage,'python3','-B','-'],childOptions):spawnSync('ssh',['-o','BatchMode=yes','home-server-ai','sudo -n python3 -'],childOptions);
if(result.error)throw Error('Snapshot helper failed: '+(result.error.code||result.error.message));
if(result.status!==0)throw Error('Snapshot helper exit '+result.status+': '+String(result.stderr||'').slice(0,2048));
if(!result.stdout.trim())throw Error('Snapshot helper returned no report');
const snapshot=JSON.parse(result.stdout);snapshot.observed_at=new Date().toISOString();fs.writeFileSync(outputPath,JSON.stringify(snapshot,null,2)+'\n');console.log({exit_code:snapshot.exit_code,files:Object.keys(snapshot.files).length,release:snapshot.release});

