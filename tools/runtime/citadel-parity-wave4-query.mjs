import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import {runtime,verifyRuntime,activeLease,api} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'citadel-wave4'),s=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
await verifyRuntime();activeLease(s.lease.lease_id,'citadel_native');const a=(await api('/api/application/servers/'+s.server.id)).attributes;if(a.uuid!==s.server.uuid||a.egg!==s.egg.id)throw Error('Owned Citadel fixture required');
const port=s.lease.ports[1],request=Buffer.from('ffffffff54536f7572636520456e67696e6520517565727900','hex');let challenge=false;
const result={at:new Date().toISOString(),host:'127.0.0.1',port,protocol:'A2S_INFO',success:false};
try{
 const reply=await new Promise((resolve,reject)=>{const c=dgram.createSocket('udp4');const finish=(err,data)=>{clearTimeout(timer);c.close();err?reject(err):resolve(data);};const timer=setTimeout(()=>finish(Error('A2S_INFO timeout after5000ms')),5000);c.once('error',e=>finish(e));c.on('message',(b,peer)=>{if(peer.address!=='127.0.0.1'||peer.port!==port)return;if(b.length<5||b.readInt32LE(0)!==-1)return finish(Error('Unsupported split/malformed packet'));if(b[4]===0x41&&!challenge){if(b.length!==9)return finish(Error('Malformed challenge'));challenge=true;c.send(Buffer.concat([request,b.subarray(5)]),port,'127.0.0.1');return;}finish(null,b);});c.send(request,port,'127.0.0.1');});
 if(reply.length<6||reply[4]!==0x49)throw Error('Not modern A2S_INFO');let at=6;const fields={};for(const key of['name','map','folder','game']){const end=reply.indexOf(0,at);if(end<at)throw Error('Truncated string field');fields[key]=reply.toString('utf8',at,end);at=end+1;}
 if(reply.length<at+9)throw Error('Truncated scalar fields');Object.assign(fields,{appid:reply.readUInt16LE(at),players:reply[at+2],maxplayers:reply[at+3],password_required:reply[at+7]===1});Object.assign(result,{success:true,challenge,fields,reply_hex:reply.toString('hex')});
}catch(e){result.error=e.message;}
fs.writeFileSync(path.join(dir,'query-'+Date.now()+'.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!result.success)process.exitCode=1;
