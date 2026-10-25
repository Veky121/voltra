import fs from'node:fs';import dgram from'node:dgram';import{spawnSync}from'node:child_process';
const dir='.local/source-third/sven',r=JSON.parse(fs.readFileSync(dir+'/private.json')),node=JSON.parse(fs.readFileSync(r.node_receipt)),action=process.argv[2],label=process.argv[3]||'probe';if(r.kind!=='sven'||r.node!==node.node||r.node_uuid!==node.node_uuid||r.ports.length!==1||!/^[a-z0-9-]{1,64}$/.test(label))throw Error('Scoped Sven probe required');
const response=await fetch('http://127.0.0.1:8088/api/client/servers/'+r.identifier);if(!response.ok||(await response.json()).attributes.uuid!==r.uuid)throw Error('Owned API identity mismatch');
const host='127.0.0.1',port=r.ports[0],header=Buffer.from([255,255,255,255]);
async function exchange(packet,timeout=4000){return new Promise((resolve,reject)=>{const socket=dgram.createSocket('udp4');const timer=setTimeout(()=>{socket.close();reject(Error('Bounded native UDP response timeout'));},timeout);socket.on('error',()=>{clearTimeout(timer);socket.close();reject(Error('Native UDP socket error'));});socket.on('message',(data,source)=>{if(source.address!==host||source.port!==port)return;clearTimeout(timer);socket.close();resolve(data);});socket.send(packet,port,host);});}
const redact=value=>{let text=typeof value==='string'?value:JSON.stringify(value);for(const secret of[r.rcon_password,r.join_password].filter(Boolean))text=text.replaceAll(secret,'[redacted]');return text;};
if(action==='query'){
 const result=spawnSync(process.execPath,['tools/game-query/query.mjs','svencoop',host,String(port)],{windowsHide:true,encoding:'utf8',timeout:15000});if(result.status)throw Error('Actual native A2S query failed');const query=JSON.parse(result.stdout);
 // Force the native Valve challenge on A2S_RULES even if INFO itself does not
 // require a challenge. Preserve framing/source checks and challenge evidence.
 const challenge=await exchange(Buffer.concat([header,Buffer.from('V'),header]));if(challenge.length!==9||!challenge.subarray(0,5).equals(Buffer.concat([header,Buffer.from('A')])))throw Error('Expected actual Valve challenge');
 const rules=await exchange(Buffer.concat([header,Buffer.from('V'),challenge.subarray(5)]));if(rules.length<7||!rules.subarray(0,5).equals(Buffer.concat([header,Buffer.from('E')])))throw Error('Expected challenge-authorized rules response');
 const evidence={uuid:r.uuid,observed_at:new Date().toISOString(),...query,challenge_received:true,challenge_response_accepted:true,rules_bytes:rules.length};fs.writeFileSync(dir+'/query-'+label+'.json',JSON.stringify(evidence,null,2));console.log(evidence);
}else if(action==='rcon'){
 const command=process.argv[4]||'status';if(!/^[A-Za-z0-9_ .-]{1,128}$/.test(command)||/password/i.test(command))throw Error('One bounded non-secret native RCON command required');
 const challenge=await exchange(Buffer.concat([header,Buffer.from('challenge rcon\n')]));const text=challenge.subarray(4).toString('ascii').replace(/\0/g,'').trim(),match=/^challenge rcon (-?[0-9]+)$/.exec(text);if(!challenge.subarray(0,4).equals(header)||!match)throw Error('Actual GoldSrc RCON challenge missing');
 const password=label==='wrong'?'deliberately-wrong-sven-fixture':r.rcon_password;
 const answer=await exchange(Buffer.concat([header,Buffer.from('rcon '+match[1]+' "'+password+'" '+command+'\n')]));if(!answer.subarray(0,4).equals(header))throw Error('GoldSrc response framing mismatch');
 const body=answer.subarray(answer[4]===108?5:4).toString('utf8').replace(/\0/g,'');const denied=/bad rcon_password|bad rcon|invalid password/i.test(body);const evidence={uuid:r.uuid,observed_at:new Date().toISOString(),protocol:'GoldSrc UDP challenge RCON',command,challenge_received:true,authenticated:!denied&&command==='status'&&/hostname:/i.test(body)&&/map\s*:/i.test(body)&&/players\s*:/i.test(body),denied,response:redact(body)};fs.writeFileSync(dir+'/rcon-'+label+'.json',JSON.stringify(evidence,null,2));console.log(evidence);
}else throw Error('Choose query or rcon');
