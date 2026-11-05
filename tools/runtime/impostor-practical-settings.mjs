// A small actual-fixture step for the current editor. No work runs on import.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const decode=data=>JSON.parse(Buffer.from(data).toString('utf8').replace(/^\uFEFF/,''));
const readonly=field=>field?.readonly??field?.readOnly;

export async function checkImpostorSettings({endpoint,api,readConfig}) {
 assert.match(endpoint,/^\/api\/client\/servers\/[a-f0-9-]+$/i);
 const resources=(await api(endpoint+'/resources')).attributes;
 assert.equal(resources.current_state,'offline','Stop the owned fixture before editing settings');
 const url=endpoint+'/game-settings?file=%2Fimpostor%2Fconfig.json';
 let view=(await api(url)).attributes;
 for(const key of ['/Server/ListenIp','/Server/ListenPort','/HttpServer/ListenIp','/HttpServer/ListenPort']){
  assert.equal(readonly(view.fields.find(f=>f.key===key)),true,'Allocated listener must stay readonly: '+key);
 }
 for(const key of ['/Server/PublicIp','/Server/PublicPort']){
  const field=view.fields.find(f=>f.key===key);
  assert.ok(field&&readonly(field)!==true,'Advertised setting must be editable: '+key);
 }
 const before=Buffer.from(await readConfig()),original=decode(before);
 const address=original.Server.PublicIp==='127.0.0.2'?'127.0.0.1':'127.0.0.2';
 const port=original.Server.PublicPort===65535?65534:original.Server.PublicPort+1;
 const next={'/Server/PublicIp':address,'/Server/PublicPort':String(port)};
 let changed;
 try {
  await api(url,'PUT',{revision:view.revision,settings:next});
  changed=Buffer.from(await readConfig());
  const expected=structuredClone(original);expected.Server.PublicIp=address;expected.Server.PublicPort=port;
  assert.ok(isDeepStrictEqual(decode(changed),expected),'Only the two advertised values may change');
 } finally {
  // Leave the fixture ready to start with its original advertised endpoint.
  // Fetch a fresh revision rather than forcing a stale raw-file overwrite.
  view=(await api(url)).attributes;
  await api(url,'PUT',{revision:view.revision,settings:{'/Server/PublicIp':original.Server.PublicIp,'/Server/PublicPort':String(original.Server.PublicPort)}});
 }
 const restored=Buffer.from(await readConfig());
 assert.ok(isDeepStrictEqual(decode(restored),original),'Original fixture settings were not restored');
 return {before_sha256:digest(before),changed_sha256:digest(changed),restored_sha256:digest(restored),advertised_values_editable:true,allocated_listeners_readonly:true,original_values_restored:true,scope:'Actual API/native-file roundtrip only. Launch and native consumption require separate observation.'};
}
