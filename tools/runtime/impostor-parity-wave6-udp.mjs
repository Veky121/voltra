// One bounded negative UDP handshake, derived from the server's exact upstream
// Hazel1.0.1 and Impostorv1.10.9. This is not a player/client implementation.
import fs from 'node:fs';
import dgram from 'node:dgram';
import {api,verifyRuntime,activeLease} from './campaign-native-20261029.mjs';
const dir='.local/game-parity-20261029/impostor-root-native',s=JSON.parse(fs.readFileSync(dir+'/state.json'));
activeLease(s.lease.lease_id,s.lease.owner);const runtime=await verifyRuntime();
const owner=(await api('/api/application/servers/'+s.server.id)).attributes;
if(owner.uuid!==s.server.uuid||owner.egg!==s.egg.id||owner.node!==1||(await api('/api/client/servers/'+s.server.uuid+'/resources')).attributes.current_state!=='running')throw Error('Exact ready owned Impostor required');
const name=Buffer.from('VoltraProbe','ascii'),payload=Buffer.alloc(4+4+1+name.length);
// Reliable Hello8, nonce0x1234 big-endian, Hazel version byte0. The game
// handshake then carries little-endian GameVersion0 and packed ASCII name.
payload[0]=8;payload.writeUInt16BE(0x1234,1);payload[3]=0;payload.writeInt32LE(0,4);payload[8]=name.length;name.copy(payload,9);
const result={at:new Date().toISOString(),runtime_pid:runtime.pid,server_uuid:s.server.uuid,port:s.lease.ports[0],request_hex:payload.toString('hex'),request_count:1,replies:[],scope:'Expected incompatible-version rejection/transport check from Windows loopback across actual Docker UDP mapping. No compatible game client or player join.',sources:[
 'https://github.com/Impostor/Impostor.Hazel/blob/afbf4e4330275c18caf4af688b8f9336c756331e/Hazel/Udp/UdpConnection.cs',
 'https://github.com/Impostor/Impostor.Hazel/blob/afbf4e4330275c18caf4af688b8f9336c756331e/Hazel/Udp/UdpConnection.Reliable.cs',
 'https://github.com/Impostor/Impostor/blob/v1.10.9/src/Impostor.Api/Net/Messages/C2S/HandshakeC2S.cs',
 'https://github.com/Impostor/Impostor/blob/v1.10.9/src/Impostor.Server/Net/Manager/ClientManager.cs'
]};
await new Promise((resolve,reject)=>{
 const socket=dgram.createSocket('udp4'),timer=setTimeout(()=>{socket.close();resolve();},2200);
 socket.on('error',error=>{clearTimeout(timer);socket.close();reject(Error('Owned UDP probe failed: '+error.code));});
 socket.on('message',(bytes,peer)=>{if(peer.port!==s.lease.ports[0]||peer.address!=='127.0.0.1'||bytes.length>4096||result.replies.length>=8)return;result.replies.push({hex:bytes.toString('hex'),option:bytes[0],bytes:bytes.length,text:bytes.toString('utf8').replace(/[^\x20-\x7e]/g,' ').trim()});});
 socket.connect(s.lease.ports[0],'127.0.0.1',()=>socket.send(payload));
});
result.hazel_transport_reply=result.replies.some(r=>[9,10].includes(r.option));
result.expected_old_version_disconnect=result.replies.some(r=>r.option===9&&r.text.includes('Please update your game to play on this server.'));
fs.writeFileSync(dir+'/udp-negative-handshake.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));if(!result.hazel_transport_reply)process.exitCode=1;
