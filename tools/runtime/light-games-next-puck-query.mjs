import fs from 'node:fs';import net from 'node:net';import assert from 'node:assert/strict';import {api} from './openttd-compat-node.mjs';
const dir='.local/light-games-next/puck',s=JSON.parse(fs.readFileSync(dir+'/private.json')),server=(await api('/api/application/servers/'+s.internal_id)).attributes;
assert.equal(server.uuid,s.uuid);assert.equal(server.node,202);assert.equal(s.ports.length,2);
const results=[];
for(const port of s.ports){
 const response=await new Promise((resolve,reject)=>{
  const socket=net.createConnection({host:'127.0.0.1',port}),timer=setTimeout(()=>{socket.destroy();reject(Error('Native publisher preview timeout'));},4000);let data='';
  socket.on('error',error=>{clearTimeout(timer);socket.destroy();reject(error);});socket.on('connect',()=>socket.write(JSON.stringify({type:0})));
  socket.on('data',chunk=>{data+=chunk.toString('utf8');if(data.length>65536){clearTimeout(timer);socket.destroy();reject(Error('Preview exceeds bound'));return;}let value;try{value=JSON.parse(data);}catch{return;}clearTimeout(timer);socket.end();resolve(value);});
 });assert.equal(response.type,1);results.push({port,protocol:'Publisher TCPServer PreviewRequest/Response',response});
}
const proof={uuid:s.uuid,loopback:'127.0.0.1',results,at:new Date().toISOString()};fs.writeFileSync(dir+'/query.json',JSON.stringify(proof,null,2)+'\n');console.log(proof);
