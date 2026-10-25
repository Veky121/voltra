import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/wurm-native',tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid phase');
const {receipt:s,node}=await ownedStoppedServer(dir+'/private.json');if(s.owner!=='game_batch_inventory'||s.path!=='wurm_unlimited/egg-wurm-unlimited.json')throw Error('Foreign fixture');
const code=`from pathlib import Path
import sqlite3,json,shutil,tempfile,hashlib
r=Path('/volume');reports=[]
safe={'name','id','serverid','externalport','internalport','externalip','internalip','rmiport','rmiregport','queryport','steamqueryport','playerlimit','maxplayers','pvp','pvpserver','epic','isepic','lastpoll','uptime','time','servername'}
for p in(r/'dist/Adventure').rglob('*.db'):
 temporary=tempfile.TemporaryDirectory(prefix='wurm-private-sqlite-');copy=Path(temporary.name)/p.name
 for source in [p,p.with_name(p.name+'-wal'),p.with_name(p.name+'-shm'),p.with_name(p.name+'-journal')]:
  if source.exists():
   if source.is_symlink():raise ValueError('Unexpected database sidecar link')
   shutil.copyfile(source,Path(temporary.name)/source.name)
 c=sqlite3.connect(str(copy))
 try:
  tables=[v[0]for v in c.execute(\"select name from sqlite_master where type='table'\")];item={'database':str(p.relative_to(r)),'original_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'private_independent_copy':True,'quick_check':c.execute('pragma quick_check').fetchone()[0],'tables':len(tables)}
  if 'SERVERS'in tables:
   names=[v[1]for v in c.execute('pragma table_info(SERVERS)')];chosen=[n for n in names if n.lower().replace('_','')in safe]
   item['server_columns']=chosen
   quoted=','.join('"'+n.replace('"','""')+'"'for n in chosen)
   item['server_rows']=[dict(zip(chosen,row))for row in c.execute('select '+quoted+' from SERVERS')]
  reports.append(item)
 finally:c.close();temporary.cleanup()
print(json.dumps({'databases':reports}))
`;
const p=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:3e6});if(p.status)throw Error(p.stderr);const value=JSON.parse(p.stdout);fs.writeFileSync(dir+'/world-'+tag+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});console.log(value.databases.filter(d=>d.server_rows));
