// Actual native Socket.IO signaling; this is not Among Us audio/gameplay acceptance.
import fs from 'node:fs';
import path from 'node:path';
import {runtime,activeLease,verifyRuntime} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'banana-wave4-crewlink'),file=path.join(dir,'state.json');
const state=JSON.parse(fs.readFileSync(file));
activeLease(state.lease.lease_id,'crewlink_native_banana');await verifyRuntime();
const base='http://127.0.0.1:'+state.lease.ports[0];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,description){const began=Date.now();while(Date.now()-began<5000){const value=predicate();if(value)return value;await delay(40);}throw Error('Native signaling timeout: '+description);}
function connect(label){
 const client={label,events:[],engine:null,namespace:false,errors:[],socket:new WebSocket(base.replace('http:','ws:')+'/socket.io/?EIO=3&transport=websocket')};
 client.socket.addEventListener('error',()=>client.errors.push('websocket error'));
 client.socket.addEventListener('message',event=>{
  const frame=String(event.data);
  if(frame.startsWith('0'))client.engine=JSON.parse(frame.slice(1));
  else if(frame==='2')client.socket.send('3');
  else if(frame.startsWith('40'))client.namespace=true;
  else if(frame.startsWith('42'))client.events.push(JSON.parse(frame.slice(2)));
 });
 client.send=(event,...args)=>client.socket.send('42'+JSON.stringify([event,...args]));
 return client;
}
const a=connect('host'),b=connect('guest');let proof;
try{
 for(const client of [a,b]){
  await until(()=>client.engine,'Engine.IO open '+client.label);
  await delay(100);
  if(!client.namespace)client.socket.send('40');
  await until(()=>client.events.find(event=>event[0]==='clientPeerConfig'),'native peer configuration '+client.label);
 }
 const peer=a.events.find(event=>event[0]==='clientPeerConfig')[1];
 if(peer.forceRelayOnly!==Boolean(state.checkpoint?.forceRelayOnly))throw Error('Native peer setting differs from stopped-edit checkpoint/default');
 if(peer.iceServers?.some(server=>String(server.urls).startsWith('turn:')))throw Error('Managed integrated relay unexpectedly enabled');
 a.send('id',101,1001);
 a.send('join','VOLTRA_PARITY',101,1001,true);
 await until(()=>a.events.find(event=>event[0]==='setClients'),'host join acknowledgement');
 b.send('id',102,1002);
 b.send('join','VOLTRA_PARITY',102,1002,false);
 const guestSet=await until(()=>b.events.find(event=>event[0]==='setClients'),'guest join acknowledgement');
 const hostJoin=await until(()=>a.events.find(event=>event[0]==='join'),'native guest announcement');
 const hostID=Object.keys(guestSet[1])[0],guestID=hostJoin[1];
 if(!hostID||!guestID||guestSet[1][hostID].playerId!==101||hostJoin[2].playerId!==102)throw Error('Native lobby membership mismatch');
 a.send('signal',{to:guestID,data:'voltra-native-signal-fixture'});
 const signal=await until(()=>b.events.find(event=>event[0]==='signal'),'native signaling relay');
 if(signal[1].data!=='voltra-native-signal-fixture'||signal[1].from!==hostID)throw Error('Native signaling payload/source mismatch');
 const health=await (await fetch(base+'/health',{signal:AbortSignal.timeout(5000)})).json();
 if(health.connectionCount!==2||health.lobbiesCount!==1)throw Error('Native live connection/lobby counters incorrect');
 proof={at:new Date().toISOString(),engine_io:3,transport:'real WebSocket',namespace:'Socket.IO default',clients:2,host_join:true,guest_join:true,signaling_relay:true,forceRelayOnly:peer.forceRelayOnly,integrated_turn:false,health,voice_audio_acceptance:false,gameplay_acceptance:false,source:'https://github.com/OhMyGuus/BetterCrewLink-server/blob/0e1d4b12e7a7201cda4db723d08d57baa5549432/src/index.ts'};
}finally{a.socket.close();b.socket.close();}
for(let n=0;n<30;n++){
 const health=await (await fetch(base+'/health',{signal:AbortSignal.timeout(5000)})).json();
 if(health.connectionCount===0&&health.lobbiesCount===0){proof.disconnect_cleanup=true;break;}
 await delay(100);
}
if(!proof.disconnect_cleanup)throw Error('Native client/lobby disconnect cleanup not observed');
state.protocol??=[];state.protocol.push(proof);fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
fs.writeFileSync('artifacts/game-parity-20261029/banana-wave4-crewlink-protocol.json',JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof));
