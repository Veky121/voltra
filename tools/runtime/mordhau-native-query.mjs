import fs from 'node:fs';import dgram from 'node:dgram';import {api} from './openttd-compat-node.mjs';
const d='.local/mordhau-native',s=JSON.parse(fs.readFileSync(d+'/private.json')),tag=process.argv[2];
if(!/^[a-z0-9_-]+$/.test(tag??'')||fs.existsSync(d+'/query-'+tag+'.json'))throw Error('Unique query tag required');
const node=JSON.parse(fs.readFileSync(s.node_receipt)),a=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(a.uuid!==s.uuid||a.node!==node.node||s.node_uuid!==node.node_uuid||a.egg!==s.egg_id||a.external_id!=='mordhau-native-'+s.request_id||s.owner!=='unreal_survival')throw Error('Exact owned query identity');
const request=Buffer.from('ffffffff54536f7572636520456e67696e6520517565727900','hex'),packets=[];let challenged=false;
const result=await new Promise(resolve=>{
 const c=dgram.createSocket('udp4'),done=v=>{clearTimeout(timer);c.close();resolve(v);},timer=setTimeout(()=>done({error:'A2S_INFO timeout after5000ms'}),5000);
 c.on('error',()=>done({error:'UDP query transport failed'}));
 c.on('message',b=>{packets.push(b.toString('hex'));if(b.length>=9&&b.readInt32LE(0)===-1&&b[4]===0x41&&!challenged&&b.length===9){challenged=true;c.send(Buffer.concat([request,b.subarray(5,9)]),s.ports[1],'127.0.0.1');return;}done({reply_hex:b.toString('hex')});});
 c.send(request,s.ports[1],'127.0.0.1');
});
const out={host:'127.0.0.1',port:s.ports[1],challenged,packets,...result,at:new Date().toISOString()};
if(result.reply_hex){
 try{const b=Buffer.from(result.reply_hex,'hex');if(b.readInt32LE(0)!==-1||b[4]!==0x49)throw Error();let at=6;out.fields={};for(const key of ['name','map','folder','game']){const end=b.indexOf(0,at);if(end<at)throw Error();out.fields[key]=b.toString('utf8',at,end);at=end+1;}out.fields.appid_low16=b.readUInt16LE(at);out.fields.players=b[at+2];out.fields.max_players=b[at+3];out.fields.password_required=b[at+7]===1;}catch{out.parse_error='Unexpected query packet; raw packet retained';}
}
fs.writeFileSync(d+'/query-'+tag+'.json',JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(out);
