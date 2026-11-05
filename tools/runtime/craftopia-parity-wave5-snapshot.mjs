// Exact owned stopped operator/world state; read-only bounded Linux inspection.
import fs from 'node:fs';
import path from 'node:path';
import {runtime,api,docker,digest,verifyRuntime,activeLease,observePower} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'craftopia-wave5-native'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file)),phase=process.argv[2];
if(!['baseline','pre-install','after-install','after-runtime'].includes(phase))throw Error('Explicit snapshot phase required');
await verifyRuntime();activeLease(s.lease.lease_id,'craftopia_native_wave5');if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Activation paused');if((await observePower(s.fixture)).current_state!=='offline')throw Error('Stopped pilot required');
const uuid=s.fixture.server.uuid;if(!/^[a-f0-9-]{36}$/.test(uuid))throw Error('Owned UUID required');
if(phase==='baseline'){
 const body='Unknown operator notes must survive Craftopia reinstall.\n',route='http://127.0.0.1:18099/api/client/servers/'+uuid+'/files/contents?file=%2FDedicatedServerSave%2Fvoltra-operator-preserve.txt';
 const listed=(await api('/api/client/servers/'+uuid+'/files/list?directory=%2FDedicatedServerSave')).data.map(x=>x.attributes);
 if(listed.some(x=>x.name==='voltra-operator-preserve.txt')){const prior=await fetch(route);if(!prior.ok||digest(Buffer.from(await prior.arrayBuffer()))!==digest(body))throw Error('Existing unrelated operator file; refuse overwrite');}else{const r=await fetch(route.replace('/files/contents','/files/write'),{method:'POST',headers:{'Content-Type':'text/plain'},body});if(!r.ok)throw Error('Operator checkpoint write failed');}
}
const code=String.raw`from pathlib import Path
import hashlib,json,sqlite3,stat
root=Path('/owned')
names=('ServerSetting.ini','DedicatedServerSave','PPSave','.config','.local/share','BepInEx','mods')
rows=[]
for name in names:
 target=root/name
 if not target.exists():continue
 for item in ([target] if target.is_file() else sorted(target.rglob('*'))):
  if item.is_symlink() or not item.resolve().is_relative_to(root):raise RuntimeError('Unsafe owned snapshot path')
  if not item.is_file():continue
  meta=item.stat()
  if not stat.S_ISREG(meta.st_mode):raise RuntimeError('Nonregular owned state')
  rows.append({'path':str(item.relative_to(root)),'sha256':hashlib.sha256(item.read_bytes()).hexdigest(),'bytes':meta.st_size,'mode':oct(stat.S_IMODE(meta.st_mode)),'uid':meta.st_uid,'gid':meta.st_gid,'mtime_ns':meta.st_mtime_ns})
dbs=[]
for item in sorted((root/'DedicatedServerSave').rglob('*.db')):
 if item.read_bytes()[:16]!=b'SQLite format 3'+bytes([0]):
  dbs.append({'path':str(item.relative_to(root)),'format':'non-SQLite native database'});continue
 db=sqlite3.connect(item.as_uri()+'?mode=ro&immutable=1',uri=True)
 tables=[]
 for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
  quoted=chr(34)+name.replace(chr(34),chr(34)*2)+chr(34)
  columns=[{'name':x[1],'type':x[2]} for x in db.execute('PRAGMA table_info('+quoted+')')]
  count=db.execute('SELECT COUNT(*) FROM '+quoted).fetchone()[0]
  tables.append({'table':name,'rows':count,'columns':columns})
 integrity=db.execute('PRAGMA integrity_check').fetchone()[0]
 db.close()
 dbs.append({'path':str(item.relative_to(root)),'format':'SQLite','integrity':integrity,'wal_present':item.with_name(item.name+'-wal').exists(),'tables':tables})
print(json.dumps({'files':sorted(rows,key=lambda x:x['path']),'databases':dbs}))`;
const image='sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704';
const observed=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','128m','--memory-swap','128m','--cpus','1','--mount','type=bind,source=/var/lib/voltra-parity-20261029/volumes/'+uuid+',target=/owned,readonly',image,'python','-B','-c',code]));
const output=path.join(dir,'snapshot-'+phase+'.json');if(phase==='baseline'&&fs.existsSync(output))throw Error('Preserve original snapshot; choose a new reviewed phase');
fs.writeFileSync(output,JSON.stringify({at:new Date().toISOString(),...observed},null,2)+'\n');
s.snapshots??={};s.snapshots[phase]={file:output,sha256:digest(fs.readFileSync(output)),files:observed.files.length,databases:observed.databases.length};
if(phase==='pre-install'||phase==='after-install'){const before=JSON.parse(fs.readFileSync(s.snapshots.baseline.file));if(JSON.stringify(before.files)!==JSON.stringify(observed.files))throw Error('Strict reinstall bytes/modes/owners/mtime drift');if(phase==='after-install')s.reinstall_preservation={at:new Date().toISOString(),strict_all_rows:true,files:observed.files.length};}
fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');console.log(JSON.stringify({phase,files:observed.files.length,databases:observed.databases,strict_reinstall:phase==='after-install'?true:undefined}));
