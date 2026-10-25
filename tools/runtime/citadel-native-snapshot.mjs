import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/citadel-native',tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid snapshot tag');
const {receipt:s,node}=await ownedStoppedServer(dir+'/private.json');
if(s.owner!=='game_batch_inventory'||s.path!=='citadel/egg-citadel-forged-with-fire.json')throw Error('Foreign fixture');
const code=`from pathlib import Path
import json,hashlib,stat,os
r=Path('/volume');secret=${JSON.stringify(s.test_password)};files={};links={};configs={};mtimes={}
def digest(p):
 with p.open('rb')as source:return hashlib.file_digest(source,'sha256').hexdigest()
for relative in ('Config','Citadel/Saved','Engine/Saved','Mods','Citadel/Mods','.voltra/fantasy-worlds/citadel-sdk.json','Citadel/Plugins/UWorks/Source/ThirdParty/Linux/steamclient.so','.steam/sdk64/steamclient.so'):
 base=r/relative
 for p in [base,*base.rglob('*')]if base.is_dir()else[base]:
  name=p.relative_to(r).as_posix()
  if p.is_symlink():links[name]={'target':os.readlink(p),'uid':p.lstat().st_uid,'gid':p.lstat().st_gid};continue
  if not p.is_file():continue
  st=p.stat();files[name]={'sha256':digest(p),'bytes':st.st_size,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid};mtimes[name]=st.st_mtime_ns
  if p.suffix=='.ini'and st.st_size<1024*1024:configs[name]=p.read_text(errors='replace').replace(secret,'[redacted]')
print(json.dumps({'files':files,'links':links,'configs':configs,'mtimes_ns':mtimes,'world_files':[name for name in files if '/SaveGames/'in name],'sdk_ledger':json.loads((r/'.voltra/fantasy-worlds/citadel-sdk.json').read_text())}))
`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--user','988:988','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--memory','256m','--cpus','1','--pids-limit','32','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',timeout:20000,maxBuffer:3e6});
if(result.status)throw Error('Snapshot failed: '+result.stderr);
const value=JSON.parse(result.stdout);value.at=new Date().toISOString();
fs.writeFileSync(dir+'/snapshot-'+tag+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});
console.log({files:Object.keys(value.files).length,world_files:value.world_files,sdk_sha256:value.sdk_ledger.sha256});
