// Prepared read-only Steam A2S_INFO probe; execute only in an authorized native generation.
import fs from 'node:fs';
import dgram from 'node:dgram';
import {api} from './openttd-compat-node.mjs';
const dir='.local/aapg-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),tag=process.argv[2];
if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Explicit unique query tag required');
const n=JSON.parse(fs.readFileSync(s.node_receipt)),v=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(v.uuid!==s.uuid||v.egg!==s.egg_id||v.node!==n.node||s.node_uuid!==n.node_uuid||s.owner!=='game_batch_inventory')throw Error('Foreign query candidate');
const file=dir+'/query-'+tag+'.json';if(fs.existsSync(file))throw Error('Existing query result; no implicit retry');
const request=Buffer.from('ffffffff54536f7572636520456e67696e6520517565727900','hex');
let challenged=false,sends=0;
const result=await new Promise(resolve=>{
 const socket=dgram.createSocket('udp4');let finished=false;
 const done=value=>{if(finished)return;finished=true;clearTimeout(timer);socket.close();resolve(value);};
 const timer=setTimeout(()=>done({response:false,error:'timeout5000ms'}),5000);
 socket.on('error',error=>done({response:false,error:error.code}));
 socket.on('message',(packet,peer)=>{
  if(peer.address!=='127.0.0.1'||peer.port!==s.ports[1])return;
  if(packet.length<5||packet.length>65507||packet.readInt32LE(0)!==-1){done({response:true,error:'Unsupported or invalid response frame',reply_hex:packet.toString('hex')});return;}
  if(packet[4]===0x41&&!challenged&&packet.length===9){challenged=true;sends++;socket.send(Buffer.concat([request,packet.subarray(5,9)]),s.ports[1],'127.0.0.1');return;}
  if(packet[4]!==0x49){done({response:true,error:'Unsupported response type',reply_hex:packet.toString('hex')});return;}
  try{
   let offset=6;const decoder=new TextDecoder('utf-8',{fatal:true});
   const string=()=>{const end=packet.indexOf(0,offset);if(end<offset||end-offset>4096)throw Error('Invalid bounded string');const value=decoder.decode(packet.subarray(offset,end));offset=end+1;return value;};
   const fields={name:string(),map:string(),folder:string(),game:string()};
   if(offset+9>packet.length)throw Error('Truncated info fields');
   Object.assign(fields,{app_id:packet.readUInt16LE(offset),players:packet[offset+2],max_players:packet[offset+3],bots:packet[offset+4],server_type:String.fromCharCode(packet[offset+5]),os:String.fromCharCode(packet[offset+6]),password_required:packet[offset+7]===1,vac:packet[offset+8]===1});offset+=9;fields.version=string();
   done({response:true,fields,name_matches:fields.name==='Voltra isolated AAPG',reply_hex:packet.toString('hex')});
  }catch(error){done({response:true,error:error.message,reply_hex:packet.toString('hex')});}
 });
 sends++;socket.send(request,s.ports[1],'127.0.0.1');
});
const report={uuid:s.uuid,host:'127.0.0.1',query_port:s.ports[1],protocol:'Standard Steam A2S_INFO on the original query role',challenge:challenged,request_packets:sends,...result,at:new Date().toISOString()};
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(report);
if(!result.response||result.error||!result.name_matches)process.exitCode=1;
