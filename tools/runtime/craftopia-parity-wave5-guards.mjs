import fs from 'node:fs';
import path from 'node:path';
import {runtime,api,digest,verifyRuntime,activeLease,observePower,createReaderFixture,readerRequest,removeReaderFixture} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'craftopia-wave5-native'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file));
const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');
await verifyRuntime();activeLease(s.lease.lease_id,'craftopia_native_wave5');if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Activation paused');
if((await observePower(s.fixture)).current_state!=='offline')throw Error('Stopped native pilot required');
const base='/api/client/servers/'+s.fixture.server.uuid,route=base+'/game-settings?file=%2FServerSetting.ini';
const read=async()=>{const r=await fetch('http://127.0.0.1:18099'+base+'/files/contents?file=%2FServerSetting.ini');if(!r.ok)throw Error('Owned native file unavailable');return Buffer.from(await r.arrayBuffer());};
const before=await read(),view=(await api(route)).attributes,checks=[];
for(const [name,body,status] of [
 ['stale',{revision:'stale',settings:{'CreativeModeSetting/noHunger':true}},409],
 ...['GameWorld/name','Host/port','Host/bindAddress','Save/savePath'].map(key=>['managed/'+key,{revision:view.revision,settings:{[key]:'unsafe-fixture'}},422]),
 ['boolean-type',{revision:view.revision,settings:{'CreativeModeSetting/noHunger':'true'}},422],
 ['password-injection',{revision:view.revision,settings:{'Host/serverPassword':'fixture\nport=1'}},422],
]){const r=await fetch('http://127.0.0.1:18099'+route,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});checks.push({name,status:r.status});if(r.status!==status)throw Error('Guard failed: '+name);}
if(digest(await read())!==digest(before))throw Error('Refused native edits changed bytes');
s.reader=await createReaderFixture(s.fixture,async r=>{s.reader=r;save();});
const reader=await readerRequest(s.reader,route),body=await reader.json(),write=await readerRequest(s.reader,route,'PUT',{revision:view.revision,settings:{'CreativeModeSetting/noHunger':true}});
const pin=body.attributes?.fields.find(f=>f.key==='Host/serverPassword'),flag=body.attributes?.fields.find(f=>f.key==='Host/usePassword');
s.permissions={at:new Date().toISOString(),read:reader.status,write:write.status,pin_masked:pin?.secret===true&&pin.value==null,public_password_switch:flag?.type==='boolean'&&flag.secret===false,boundary:s.reader.identity_boundary};save();
await removeReaderFixture(s.reader,async r=>{s.reader=r;save();});
if(reader.status!==200||write.status!==403||!s.permissions.pin_masked||!s.permissions.public_password_switch)throw Error('Native RBAC/masking failed');
s.guards={at:new Date().toISOString(),checks,unchanged:true,sha256:digest(before)};save();console.log(JSON.stringify({guards:s.guards,permissions:s.permissions}));
