// Read-only native Steam A2S query against this candidate's loopback lease.
import fs from 'node:fs';
import dgram from 'node:dgram';
const game=process.argv[2];if(!['banana','nuclear'].includes(game))throw Error('A2S game required');const dir='.local/light-games-next/'+game,receipt=JSON.parse(fs.readFileSync(dir+'/private.json'));
if(receipt.node!==202||receipt.ports.length!==(game==='nuclear'?2:1))throw Error('Unexpected candidate node/port boundary');
const socket=dgram.createSocket('udp4'),request=Buffer.concat([Buffer.from([255,255,255,255,84]),Buffer.from('Source Engine Query\0')]);
try{
 const response=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Native A2S response timeout')),5000);
  socket.on('error',error=>{clearTimeout(timer);reject(error);});
  socket.on('message',(data,peer)=>{
   if(peer.address!=='127.0.0.1'||peer.port!==receipt.ports[game==='nuclear'?1:0])return;
   if(data.length>=9&&data.readInt32LE(0)===-1&&data[4]===65){socket.send(Buffer.concat([request,data.subarray(5,9)]),receipt.ports[game==='nuclear'?1:0],'127.0.0.1');return;}
   if(data.length<7||data.readInt32LE(0)!==-1||data[4]!==73)return;
   clearTimeout(timer);resolve(data);
  });
  socket.send(request,receipt.ports[game==='nuclear'?1:0],'127.0.0.1');
 });
 let offset=6;
 const string=()=>{const end=response.indexOf(0,offset);if(end<offset)throw Error('Malformed native A2S string');const value=response.toString('utf8',offset,end);offset=end+1;return value;};
 const result={uuid:receipt.uuid,protocol:response[5],name:string(),map:string(),folder:string(),game:string()};
 if(offset+9>response.length)throw Error('Truncated native A2S fields');
 Object.assign(result,{steam_appid_low16:response.readUInt16LE(offset),players:response[offset+2],max_players:response[offset+3],bots:response[offset+4],server_type:String.fromCharCode(response[offset+5]),environment:String.fromCharCode(response[offset+6]),password_required:Boolean(response[offset+7]),vac:Boolean(response[offset+8])});offset+=9;
 result.version=string();result.observed_at=new Date().toISOString();
 fs.writeFileSync(dir+'/query.json',JSON.stringify(result,null,2)+'\n');console.log(result);
}finally{socket.close();}
