import fs from 'node:fs';import {api} from './openttd-compat-node.mjs';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/mordhau-native',{receipt:s,node}=await ownedStoppedServer(dir+'/private.json'),cfg=await api('/api/application/nodes/'+s.node+'/configuration');
if(cfg.uuid!==node.node_uuid||!cfg.token_id||!cfg.token)throw Error('Exact node daemon configuration required');
const r=await fetch('http://127.0.0.1:'+node.daemon_port+'/api/servers/'+s.uuid,{headers:{Authorization:'Bearer '+cfg.token},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Exact daemon state HTTP'+r.status);
const value=await r.json(),found=[];
function visit(v,p=''){if(!v||typeof v!=='object')return;for(const[k,x]of Object.entries(v)){if(k==='crash_detection_enabled')found.push({path:p+'.'+k,value:x});else if(x&&typeof x==='object')visit(x,p+'.'+k);}}
visit(value);if(found.length!==1||found[0].value!==false)throw Error('Expected exact owned false crash policy; found '+JSON.stringify(found));
fs.writeFileSync(dir+'/crash-policy-false.json',JSON.stringify({uuid:s.uuid,node:s.node,crash_detection_enabled:false,location:found[0].path,at:new Date().toISOString()},null,2)+'\n');console.log({uuid:s.uuid,crash_detection_enabled:false});
