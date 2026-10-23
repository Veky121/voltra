// Native server greeting only: no handshake response, authentication or player join.
import net from 'node:net';
const [host,portText]=process.argv.slice(2),port=Number(portText);
if(!host||!Number.isInteger(port)||port<1||port>65535)throw Error('Usage: openra.mjs HOST PORT');
const started=Date.now();
const result=await new Promise((resolve,reject)=>{
 const socket=net.createConnection({host,port});let bytes=Buffer.alloc(0),done=false;
 const finish=(error,value)=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve(value);};
 socket.setTimeout(5000,()=>finish(Error('Native OpenRA greeting timed out')));
 socket.on('error',error=>finish(error));socket.on('end',()=>finish(Error('Native greeting ended before identification')));
 socket.on('data',block=>{bytes=Buffer.concat([bytes,block]);if(bytes.length>131072)return finish(Error('Oversized native greeting'));
  const text=bytes.toString('utf8'),mod=/\n\tMod: ([a-z0-9]+)\r?\n/.exec(text),version=/\n\tVersion: ([a-z0-9-]+)\r?\n/.exec(text);
  if(mod&&version&&bytes.length>=8)finish(null,{mod:mod[1],version:version[1],handshake_protocol:bytes.readInt32LE(0),ping:Date.now()-started,player_join_verified:false,authenticated:false});
 });
});
console.log(JSON.stringify(result));
