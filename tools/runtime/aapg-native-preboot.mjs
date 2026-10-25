import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/aapg-native',{receipt:s,node}=await ownedStoppedServer(dir+'/private.json');
if(s.owner!=='game_batch_inventory'||s.path!=='americas_army/proving_grounds/egg-america-s-army--proving-grounds.json')throw Error('Foreign fixture');
const profile=JSON.parse(fs.readFileSync(dir+'/source-profile-current.json')),image=Object.values(profile.egg.docker_images)[0];
const code=`from pathlib import Path
import json,hashlib,stat,os,re
r=Path('/volume');legal=[];files=0;size=0;links=[]
def digest(p):
 with p.open('rb')as source:return hashlib.file_digest(source,'sha256').hexdigest()
for base,dirs,names in os.walk(r,followlinks=False):
 for name in names:
  p=Path(base)/name;relative=p.relative_to(r).as_posix()
  if p.is_symlink():links.append({'path':relative,'target':os.readlink(p)});continue
  if not p.is_file():continue
  st=p.stat();files+=1;size+=st.st_size
  if re.search(r'eula|licen[cs]e|terms|agreement|legal',relative,re.I):
   item={'path':relative,'bytes':st.st_size,'sha256':digest(p)}
   if st.st_size<=1024*1024:item['text']=p.read_text(errors='replace')
   legal.append(item)
p=r/'Binaries/Linux/AAPG'
binary={'path':'Binaries/Linux/AAPG','exists':p.is_file()}
if p.is_file():
 st=p.stat();binary.update(bytes=st.st_size,header=p.open('rb').read(20).hex(),sha256=digest(p),uid=st.st_uid,gid=st.st_gid,mode=stat.S_IMODE(st.st_mode))
print(json.dumps({'files':files,'volume_bytes':size,'binary':binary,'legal_scan':'Every regular file full relative pathname, including filename and all ancestors; no symlink traversal','legal_files':legal,'links':links,'release':json.loads((r/'.voltra/steam-template-release.json').read_text())}))
`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--memory','256m','--cpus','1','--pids-limit','32','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',timeout:60000,maxBuffer:10e6});
fs.writeFileSync(dir+'/preboot-scanner-result.json',JSON.stringify({status:result.status,signal:result.signal,error:result.error?.message??null,stderr:result.stderr},null,2)+'\n',{flag:'wx'});
if(result.status)throw Error('Read-only scanner failed: '+result.stderr);const report=JSON.parse(result.stdout);
fs.writeFileSync(dir+'/preboot-files.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
if(!report.binary.exists||!report.binary.header.startsWith('7f454c46'))throw Error('Original Linux AAPG ELF unavailable; no alternate launcher');
const deps=spawnSync('docker',['run','--rm','--pull','never','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--user','988:988','--memory','256m','--cpus','1','--pids-limit','32','--entrypoint','/bin/bash','--env','HOME=/tmp','--env','LD_LIBRARY_PATH=/volume/.steam/sdk64','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,image,'-c','getconf GNU_LIBC_VERSION; ldd "$1"','owned-ldd','/volume/Binaries/Linux/AAPG'],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:2e6});
fs.writeFileSync(dir+'/preboot-ldd.log',(deps.stdout??'')+(deps.stderr??''),{flag:'wx'});
fs.writeFileSync(dir+'/preboot-ldd-result.json',JSON.stringify({status:deps.status,signal:deps.signal,contains_missing_library:(deps.stdout??'').includes('not found')},null,2)+'\n',{flag:'wx'});
console.log({files:report.files,volume_bytes:report.volume_bytes,binary:report.binary,legal_files:report.legal_files.map(x=>({path:x.path,bytes:x.bytes})),dependency_exit:deps.status,missing_libraries:(deps.stdout??'').includes('not found')});
