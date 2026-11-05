// Real native UDP challenge queries, separate from paid/player gameplay.
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import {runtime,verifyRuntime,activeLease,observePower} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'banana-wave10-etlegacy'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file));
await verifyRuntime();const lease=activeLease(s.lease?.lease_id,'etlegacy_native_banana');
if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Activation paused');
if((await observePower(s.fixture)).current_state!=='running'||lease.ports.length!==1)throw Error('Owned native running endpoint required');
async function query(command){
 const challenge=crypto.randomBytes(12).toString('hex'),socket=dgram.createSocket('udp4');
 const result=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.close();reject(Error('Owned UDP challenge timeout'));},5000);
  socket.on('error',()=>{clearTimeout(timer);socket.close();reject(Error('Owned UDP socket error'));});
  socket.on('message',(packet,remote)=>{
   if(remote.address!=='127.0.0.1'||remote.port!==lease.ports[0]||packet.length>16384)return;
   const prefix=Buffer.concat([Buffer.from([255,255,255,255]),Buffer.from(command==='getinfo'?'infoResponse\n':'statusResponse\n')]);
   if(!packet.subarray(0,prefix.length).equals(prefix))return;
   const body=packet.subarray(prefix.length).toString('utf8'),lines=body.split('\n'),pairs=lines[0].trim().split('\\'),info={};
   for(let i=1;i+1<pairs.length;i+=2){if(Object.hasOwn(info,pairs[i])){clearTimeout(timer);socket.close();reject(Error('Ambiguous native query info'));return;}info[pairs[i]]=pairs[i+1];}
   if(info.challenge!==challenge)return;
   clearTimeout(timer);socket.close();resolve({command,challenge_echoed:true,reply_bytes:packet.length,info:Object.fromEntries(['hostname','sv_hostname','mapname','sv_maxclients','clients','g_needpass','needpass','gamename','game','protocol','version','g_gametype'].filter(k=>Object.hasOwn(info,k)).map(k=>[k,info[k]])),player_rows:command==='getstatus'?lines.slice(1).filter(x=>x.trim()).length:undefined});
  });
  socket.send(Buffer.concat([Buffer.from([255,255,255,255]),Buffer.from(command+' '+challenge+'\n')]),lease.ports[0],'127.0.0.1');
 });return result;
}
const result={at:new Date().toISOString(),port:lease.ports[0],info:await query('getinfo'),status:await query('getstatus'),scope:'Actual native publisher UDP query/challenge; no player join/gameplay/WAN claim.'};
s.queries??=[];s.queries.push(result);fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');console.log(JSON.stringify(result));
