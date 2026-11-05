import fs from 'node:fs';
import path from 'node:path';
import {runtime,docker,digest,verifyRuntime,activeLease,observePower,api} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'banana-wave10-etlegacy'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file)),phase=process.argv[2];
if(!['baseline','before-install','after-install','after-runtime'].includes(phase))throw Error('Explicit snapshot phase required');
await verifyRuntime();activeLease(s.lease.lease_id,'etlegacy_native_banana');if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Activation paused');
if((await observePower(s.fixture)).current_state!=='offline')throw Error('Stopped native process required');
const uuid=s.fixture.server.uuid;if(!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(uuid))throw Error('Owned UUID required');
const base='/api/client/servers/'+uuid,canary='etlegacy/userdata/legacy/voltra-operator-preserve.txt';
const output=path.join(dir,'snapshot-'+phase+(phase==='baseline'?'':'-'+Date.now())+'.json');
const ids=docker(['ps','-q','--filter','name='+uuid]).trim();if(ids)throw Error('Owned native/installer process remains');
if(phase==='baseline'){
 if(s.snapshots?.baseline||fs.existsSync(output))throw Error('Original baseline retained');
 const rows=(await api(base+'/files/list?directory=%2Fetlegacy%2Fuserdata%2Flegacy')).data.map(r=>r.attributes);
 const body='Owned ETLegacy parity preservation canary; unknown operator file.\n';
 if(rows.some(r=>r.name==='voltra-operator-preserve.txt')){
  if(!s.operator_canary_created)throw Error('Canary path already exists; preserve operator bytes');
  const r=await fetch('http://127.0.0.1:18099'+base+'/files/contents?file='+encodeURIComponent('/'+canary));if(!r.ok||digest(Buffer.from(await r.arrayBuffer()))!==s.operator_canary_created.sha256)throw Error('Recorded canary drift');
 }else{
  if(s.operator_canary_created)throw Error('Recorded operator canary disappeared');
  const r=await fetch('http://127.0.0.1:18099'+base+'/files/write?file='+encodeURIComponent('/'+canary),{method:'POST',headers:{'Content-Type':'text/plain'},body});if(!r.ok)throw Error('Owned canary creation failed');
  s.operator_canary_created={at:new Date().toISOString(),path:canary,sha256:digest(body)};fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');
 }
}
const code=String.raw`from pathlib import Path
import hashlib,json,stat,sqlite3
root=Path('/owned');game=root/'etlegacy';rows=[];databases=[]
targets=list(game.rglob('*'))+[root/'.voltra/etlegacy/release.json']
for item in sorted(targets):
 if item.is_symlink() or not item.resolve().is_relative_to(root):raise RuntimeError('Unsafe native snapshot path')
 if not item.is_file():continue
 st=item.stat()
 if not stat.S_ISREG(st.st_mode):raise RuntimeError('Nonregular native snapshot')
 h=hashlib.sha256()
 with item.open('rb') as stream:
  head=stream.read(16);h.update(head)
  for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
 rows.append({'path':str(item.relative_to(root)),'sha256':h.hexdigest(),'bytes':st.st_size,'mode':oct(stat.S_IMODE(st.st_mode)),'uid':st.st_uid,'gid':st.st_gid,'mtime_ns':st.st_mtime_ns})
 if head==b'SQLite format 3'+bytes([0]):
  db=sqlite3.connect(item.as_uri()+'?mode=ro&immutable=1',uri=True)
  databases.append({'path':str(item.relative_to(root)),'integrity':db.execute('PRAGMA integrity_check').fetchone()[0],'wal_present':item.with_name(item.name+'-wal').exists()});db.close()
print(json.dumps({'files':rows,'databases':databases}))`;
const result=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','128m','--memory-swap','128m','--cpus','1','--mount','type=bind,source=/var/lib/voltra-parity-20261029/volumes/'+uuid+',target=/owned,readonly','sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704','python','-B','-c',code]));
if(result.databases.some(d=>d.integrity!=='ok'||d.wal_present))throw Error('Native database not clean');
fs.writeFileSync(output,JSON.stringify({at:new Date().toISOString(),...result},null,2)+'\n');
if(['before-install','after-install'].includes(phase)){
 const baseline=JSON.parse(fs.readFileSync(s.snapshots.baseline.file));if(JSON.stringify(baseline.files)!==JSON.stringify(result.files))throw Error('Strict native/operator reinstall metadata or hash drift');
}
s.snapshots??={};s.snapshots[phase]={file:output,sha256:digest(fs.readFileSync(output)),files:result.files.length,databases:result.databases.length,bytes:result.files.reduce((n,f)=>n+f.bytes,0)};
if(phase==='after-runtime'){
 const before=JSON.parse(fs.readFileSync(s.snapshots.baseline.file)),old=before.files.find(f=>f.path===canary),now=result.files.find(f=>f.path===canary);if(!old||JSON.stringify(old)!==JSON.stringify(now))throw Error('Unknown operator file changed');
 s.snapshots[phase].operator_exact=true;
}
fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');console.log(JSON.stringify({phase,...s.snapshots[phase],databases:result.databases}));
