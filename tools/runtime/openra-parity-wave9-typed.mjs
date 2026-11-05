import fs from 'node:fs';
import crypto from 'node:crypto';
import {verifyRuntime,activeLease,api,observePower,createReaderFixture,readerRequest,removeReaderFixture} from './campaign-native-20261029.mjs';
const dir='.local/game-parity-20261029/openra-ra-root-native',file=dir+'/state.json',s=JSON.parse(fs.readFileSync(file)),save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
activeLease(s.lease.lease_id,s.lease.owner);const receipt=await verifyRuntime();
if(receipt.pid===49592||s.typed||(await observePower(s)).current_state!=='offline'||s.reader&&!s.reader.user_removed)throw Error('Fresh root typed build and offline fixture without reader required');
const endpoint='/api/client/servers/'+s.server.uuid,url=endpoint+'/game-settings?file=%2FOpenRAData%2Fsettings.yaml';
async function bytes(){const r=await fetch('http://127.0.0.1:18099'+endpoint+'/files/contents?file=%2FOpenRAData%2Fsettings.yaml');if(!r.ok)throw Error('Owned config unavailable');return Buffer.from(await r.arrayBuffer());}
async function request(body){const r=await fetch('http://127.0.0.1:18099'+url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await r.text();return r.status;}
const view=(await api(url)).attributes,before=await bytes();
if(view.fields.length!==10||view.fields.filter(x=>x.type==='boolean').length!==4||JSON.stringify(view).includes('SYNTHETIC-HIDDEN-TEST-MARKER')||view.fields.some(x=>/Password|UnknownOperator/.test(x.key)))throw Error('Typed exact ten-field/four-switch/privacy contract differs');
s.typed={at:new Date().toISOString(),backend_pid:receipt.pid,backend_sha256:receipt.binary_sha256,initial_fields:view.fields,before_sha256:hash(before),negative:[]};save();
await api(url,'PUT',{revision:view.revision,settings:{'Server.EnableSyncReports':false,'Server.FloodLimitInterval':'3000'}});
const loaded=(await api(url)).attributes,after=await bytes();
const expected=Buffer.from(before.toString().replace('\tEnableSyncReports: True # operator comment retained','\tEnableSyncReports: False # operator comment retained').replace('\tFloodLimitInterval: 2500','\tFloodLimitInterval: 3000'));
if(!after.equals(expected)||loaded.fields.find(x=>x.key==='Server.EnableSyncReports')?.value!==false||String(loaded.fields.find(x=>x.key==='Server.FloodLimitInterval')?.value)!=='3000')throw Error('Exact typed/native scalar edit differs');
s.typed.after_sha256=hash(after);s.typed.only_scalar_spans_changed=true;save();
for(const[name,revision,settings]of[
 ['stale',view.revision,{'Server.FloodLimitInterval':'4000'}],
 ['managed-listener',loaded.revision,{'Server.ListenPort':'1'}],
 ['managed-password',loaded.revision,{'Server.Password':'denied'}],
 ['unknown-nested',loaded.revision,{'Server.UnknownOperatorGroup.Password':'denied'}],
 ['newline',loaded.revision,{'Server.FloodLimitInterval':'1\nServer: evil'}],
 ['int32-overflow',loaded.revision,{'Server.FloodLimitInterval':'2147483648'}]
]){const status=await request({revision,settings}),unchanged=hash(await bytes())===hash(after);s.typed.negative.push({name,status,unchanged});save();if(status<400||!unchanged||name==='stale'&&status!==409)throw Error('Typed refusal failed '+name);}
s.reader=await createReaderFixture(s,r=>{s.reader=r;save();});
try{const r=await readerRequest(s.reader,url),raw=await r.text();s.typed.reader_get_status=r.status;if(r.status!==200||raw.includes('SYNTHETIC-HIDDEN-TEST-MARKER')||JSON.parse(raw).attributes.fields.length!==10)throw Error('Read-only typed privacy mismatch');
 const denied=await readerRequest(s.reader,url,'PUT',{revision:loaded.revision,settings:{'Server.EnableSyncReports':true}});await denied.text();s.typed.reader_put_status=denied.status;save();if(denied.status!==403||hash(await bytes())!==hash(after))throw Error('Read-only typed mutation accepted');
}finally{await removeReaderFixture(s.reader,r=>{s.reader=r;save();});}
s.typed.reader_removed=s.reader.user_removed;s.typed.subuser_removed=s.reader.subuser_removed;s.typed.native_reload_pending=true;s.latest_runtime=receipt;save();
console.log(JSON.stringify({...s.typed,initial_fields:undefined}));
