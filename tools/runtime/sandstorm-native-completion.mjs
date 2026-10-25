import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {api} from './openttd-compat-node.mjs';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const d='.local/sandstorm-native',phase=process.argv[2];
assert(['prepare','restore','final-check'].includes(phase));
const {receipt:s}=await ownedStoppedServer(d+'/private.json');
assert.equal(s.internal_id,527);assert.equal(s.owner,'unreal_survival');
const a=(await api('/api/application/servers/'+s.internal_id)).attributes;
assert.equal(a.uuid,s.uuid);assert.equal(a.external_id,'sandstorm-native-'+s.request_id);
assert.equal(a.container.environment.GSLTT,'');assert.equal(a.container.environment.GST,'');
const config='Insurgency/Saved/Config/LinuxServer/Game.ini',marker='; Voltra owned Sandstorm acceptance '+s.request_id;
const r=await fetch('http://127.0.0.1:8088/api/client/servers/'+s.identifier+'/files/contents?file='+encodeURIComponent(config));assert(r.ok);const before=await r.text();
const receipt=d+'/completion-'+phase+'.json';assert(!fs.existsSync(receipt),'Phase already submitted');
if(phase==='prepare'){
 assert.equal(a.container.environment.HOSTNAME,'Voltra Sandstorm e904b32a');assert.equal(a.container.environment.MAX_PLAYERS,'28');assert(!before.includes(marker));
 fs.writeFileSync(d+'/operator-config-before.ini',before,{flag:'wx'});
 const after=before+(before.endsWith('\n')?'':'\n')+marker+'\n';
 fs.writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),phase,config,marker,before_sha256:createHash('sha256').update(before).digest('hex'),intended_sha256:createHash('sha256').update(after).digest('hex')},null,2)+'\n',{flag:'wx'});
 const w=await fetch('http://127.0.0.1:8088/api/client/servers/'+s.identifier+'/files/write?file='+encodeURIComponent(config),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:after});assert(w.ok,'Owned comment write failed');
 await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{environment:{HOSTNAME:'Voltra Sandstorm second e904b32a',MAX_PLAYERS:'16'},skip_scripts:false});
}else{
 assert(before.includes(marker),'Owned comment did not survive native boot');
 fs.writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),phase,marker_retained:true,config_sha256:createHash('sha256').update(before).digest('hex')},null,2)+'\n',{flag:'wx'});
 if(phase==='restore'){
  assert.equal(a.container.environment.HOSTNAME,'Voltra Sandstorm second e904b32a');assert.equal(a.container.environment.MAX_PLAYERS,'16');
  await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{environment:{HOSTNAME:'Voltra Sandstorm e904b32a',MAX_PLAYERS:'28'},skip_scripts:false});
 }else{assert.equal(a.container.environment.HOSTNAME,'Voltra Sandstorm e904b32a');assert.equal(a.container.environment.MAX_PLAYERS,'28');}
}
console.log({phase,owned_marker:phase==='prepare'?'written':'retained',normal_api:true});
