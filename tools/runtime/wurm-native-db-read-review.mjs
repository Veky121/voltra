import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/wurm-native',{receipt:s,node}=await ownedStoppedServer(dir+'/private.json');if(s.owner!=='game_batch_inventory'||s.path!=='wurm_unlimited/egg-wurm-unlimited.json')throw Error('Foreign fixture');
const code=`from pathlib import Path
import os,json,sqlite3,stat
r=Path('/volume');reports=[]
for p in(r/'dist/Adventure/sqlite').glob('*.db'):
 parents=[]
 for item in [r,r/'dist',r/'dist/Adventure',p.parent,p]:
  st=item.stat();parents.append({'path':str(item),'uid':st.st_uid,'gid':st.st_gid,'mode':stat.S_IMODE(st.st_mode),'readable':os.access(item,os.R_OK),'traversable':os.access(item,os.X_OK)if item.is_dir()else None})
 value={'path':str(p),'uri':p.as_uri()+'?mode=ro','parents':parents}
 try:
  c=sqlite3.connect(value['uri'],uri=True);value['quick_check']=c.execute('pragma quick_check').fetchone()[0];c.close()
 except sqlite3.Error as error:value['error']=str(error)
 with p.open('rb')as source:header=source.read(20)
 value['sqlite_header_write_version']=header[18];value['sqlite_header_read_version']=header[19]
 reports.append(value)
print(json.dumps({'actual_uid':os.getuid(),'actual_gid':os.getgid(),'read_only_mount':True,'databases':reports}))
`;
const p=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--user','988:988','--cap-drop','ALL','--memory','256m','--cpus','1','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:3e6});if(p.status)throw Error(p.stderr);const result=JSON.parse(p.stdout);fs.writeFileSync(dir+'/db-read-review.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log({...result,databases:result.databases.map(d=>({...d,parents:undefined}))});
