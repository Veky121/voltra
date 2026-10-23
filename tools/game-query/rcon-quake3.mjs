import dgram from 'node:dgram';
const [host,portText,command]=process.argv.slice(2),port=Number(portText),password=process.env.QUAKE3_RCON_PASSWORD||'';
if(!host||!Number.isInteger(port)||port<1||port>65535||!['status','fraglimit','sv_hostname','voltra_acceptance_marker'].includes(command)||!password||/["\r\n\0]/.test(password))throw Error('Provide HOST PORT READ_COMMAND and QUAKE3_RCON_PASSWORD');
const socket=dgram.createSocket('udp4');
try{
 const response=await new Promise((resolve,reject)=>{
  const deadline=setTimeout(()=>reject(Error('Native RCON response timed out')),3000);
  socket.on('error',error=>{clearTimeout(deadline);reject(error);});
  socket.on('message',packet=>{if(!packet.subarray(0,10).equals(Buffer.from('\xff\xff\xff\xffprint\n','latin1')))return;clearTimeout(deadline);resolve(packet.subarray(10).toString('utf8').replace(/\0+$/,''));});
  socket.connect(port,host,()=>socket.send(Buffer.concat([Buffer.from([255,255,255,255]),Buffer.from('rcon "'+password+'" '+command+'\n','utf8')])));
 });
 console.log(JSON.stringify({authenticated:!/(bad rconpassword|no rconpassword set)/i.test(response),command,response}));
}finally{socket.close();}
