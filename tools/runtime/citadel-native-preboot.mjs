import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/citadel-native',{receipt:s,node}=await ownedStoppedServer(dir+'/private.json');
if(s.owner!=='game_batch_inventory'||s.path!=='citadel/egg-citadel-forged-with-fire.json')throw Error('Foreign fixture');
const image=Object.values(JSON.parse(fs.readFileSync(dir+'/source-profile-current.json')).egg.docker_images)[0];
const code=`from pathlib import Path
import json,hashlib,stat,os,re
def digest(path):
 with path.open('rb')as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
r=Path('/volume');legal=[];binaries=[];files=0;size=0;links=[]
for base,dirs,names in os.walk(r,followlinks=False):
 for name in names:
  p=Path(base)/name;relative=p.relative_to(r).as_posix()
  if p.is_symlink():links.append({'path':relative,'target':os.readlink(p)});continue
  if not p.is_file():continue
  files+=1;st=p.stat();size+=st.st_size
  if re.search(r'eula|licen[cs]e|terms|agreement|legal',relative,re.I):
   item={'path':relative,'bytes':st.st_size,'sha256':digest(p)}
   if st.st_size<=1024*1024:item['text']=p.read_text(errors='replace')
   legal.append(item)
  if relative.startswith('Citadel/Binaries/Linux/')and 'Server' in name:
   binaries.append({'path':relative,'bytes':st.st_size,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid,'header':p.open('rb').read(20).hex(),'sha256':digest(p)})
target=r/'Citadel/Plugins/UWorks/Source/ThirdParty/Linux/steamclient.so';source=r/'.steam/sdk64/steamclient.so'
ledger=json.loads((r/'.voltra/fantasy-worlds/citadel-sdk.json').read_text())
print(json.dumps({'files':files,'volume_bytes':size,'wrapper':(r/'CitadelServer.sh').read_text(),'native_binaries':binaries,'legal_scan':'All regular file relative paths, including filenames and every ancestor; no symlink traversal','legal_files':legal,'links':links,'sdk':{'ledger':ledger,'target_sha256':digest(target),'source_sha256':digest(source),'target_is_symlink':target.is_symlink()},'release':json.loads((r/'.voltra/steam-template-release.json').read_text())}))
`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--memory','256m','--cpus','1','--pids-limit','32','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',timeout:60000,maxBuffer:10e6});
fs.writeFileSync(dir+'/preboot-scanner-result.json',JSON.stringify({status:result.status,signal:result.signal,error:result.error?.message??null,stderr:result.stderr},null,2)+'\n',{flag:'wx'});
if(result.status)throw Error('Read-only scanner exit '+result.status+': '+result.stderr);
const report=JSON.parse(result.stdout);
fs.writeFileSync(dir+'/preboot-files.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
const binary=report.native_binaries.find(x=>x.header.startsWith('7f454c46'));
if(!binary)throw Error('Actual native ELF missing');
const deps=spawnSync('docker',['run','--rm','--pull','never','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--user','988:988','--memory','256m','--cpus','1','--pids-limit','32','--entrypoint','/bin/bash','--env','HOME=/tmp','--env','LD_LIBRARY_PATH=/volume/.steam/sdk64:/volume/linux64','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,image,'-c','getconf GNU_LIBC_VERSION; ldd "$1"','owned-ldd','/volume/'+binary.path],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:2e6});
fs.writeFileSync(dir+'/preboot-ldd.log',(deps.stdout??'')+(deps.stderr??''),{flag:'wx'});
fs.writeFileSync(dir+'/preboot-ldd-result.json',JSON.stringify({status:deps.status,signal:deps.signal,contains_missing_library:(deps.stdout??'').includes('not found')},null,2)+'\n',{flag:'wx'});
console.log({files:report.files,volume_bytes:report.volume_bytes,native_binaries:report.native_binaries.map(x=>({path:x.path,bytes:x.bytes,header:x.header})),legal_files:report.legal_files.map(x=>({path:x.path,bytes:x.bytes})),sdk_hashes_match:report.sdk.target_sha256===report.sdk.source_sha256&&report.sdk.target_sha256===report.sdk.ledger.sha256,dependency_exit:deps.status,missing_libraries:(deps.stdout??'').includes('not found')});
