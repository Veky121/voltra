import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {api} from './openttd-compat-node.mjs';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const d='.local/sandstorm-native',phase=process.argv[2];assert(['prepare','verify'].includes(phase));
const {receipt:s}=await ownedStoppedServer(d+'/private.json');assert.equal(s.internal_id,527);assert.equal(s.owner,'unreal_survival');
const a=(await api('/api/application/servers/'+s.internal_id)).attributes;assert.equal(a.uuid,s.uuid);assert.equal(a.external_id,'sandstorm-native-'+s.request_id);
assert.equal(a.container.environment.GSLTT,'');assert.equal(a.container.environment.GST,'');
const file='Insurgency/Saved/Config/LinuxServer/voltra-acceptance-marker.txt',body=Buffer.from('Voltra owned Sandstorm restart-retention '+s.request_id+'\n');
const url='http://127.0.0.1:8088/api/client/servers/'+s.identifier+'/files/';
const output=d+'/final-sidecar-'+phase+'.json';assert(!fs.existsSync(output),'Phase already recorded');
if(phase==='prepare'){
 assert.equal(a.container.environment.HOSTNAME,'Voltra Sandstorm second e904b32a');assert.equal(a.container.environment.MAX_PLAYERS,'16');
 const listing=await api('/api/client/servers/'+s.identifier+'/files/list?directory='+encodeURIComponent('Insurgency/Saved/Config/LinuxServer'));assert(!listing.data.some(x=>x.attributes.name==='voltra-acceptance-marker.txt'));
 fs.writeFileSync(output,JSON.stringify({phase,at:new Date().toISOString(),file,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex'),scope:'operator sidecar only, not native INI comment persistence'},null,2)+'\n',{flag:'wx'});
 const w=await fetch(url+'write?file='+encodeURIComponent(file),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});assert(w.ok,'Sidecar write failed');
 await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{environment:{HOSTNAME:'Voltra Sandstorm e904b32a',MAX_PLAYERS:'28'},skip_scripts:false});
}else{
 assert.equal(a.container.environment.HOSTNAME,'Voltra Sandstorm e904b32a');assert.equal(a.container.environment.MAX_PLAYERS,'28');
 fs.writeFileSync(output,JSON.stringify({phase,at:new Date().toISOString(),original_test_controls_restored:true,scope:'operator sidecar only'},null,2)+'\n',{flag:'wx'});
}
const r=await fetch(url+'contents?file='+encodeURIComponent(file));assert(r.ok);assert.deepEqual(Buffer.from(await r.arrayBuffer()),body);console.log({phase,sidecar_exact:true,blank_tokens:true});
