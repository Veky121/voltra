import {pathToFileURL} from 'node:url';
// Publisher protocol: https://mojang.github.io/bedrock-protocol-docs/guides/nether-net-onboarding-guide/
export function serverInfo(value){
 if(!value||typeof value!=='object'||typeof value.name!=='string'||typeof value.version!=='string'||typeof value.level!=='string'||!['protocol','players','maxPlayers','gameType'].every(k=>Number.isSafeInteger(value[k]))||value.protocol<1||value.players<0||value.maxPlayers<value.players||value.maxPlayers<1||value.gameType<0||value.gameType>2)throw Error('Invalid native NetherNet server-info response');
 return {transport:'nethernet',nethernet_supported:true,server_info_available:true,name:value.name,protocol:value.protocol,version:value.version,world:value.level,players:value.players,max_players:value.maxPlayers,gamemode:value.gameType,authenticated_player_join:false,gameplay_tested:false};
}
export async function queryNethernet(port,host='127.0.0.1'){
 if(host!=='127.0.0.1'||!Number.isInteger(port)||port<1||port>65535)throw Error('Native acceptance query requires owned loopback port');
 const response=await fetch(`http://${host}:${port}/v1/join`,{signal:AbortSignal.timeout(4000),redirect:'error'});if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('Native NetherNet capability check failed');
 const reader=response.body.getReader();let bytes=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>32768)throw Error('Native server-info response exceeds bound');chunks.push(value);}}finally{await reader.cancel();}
 // Stable BDS1.26.52.3 returns a genuine200 capability response with an empty
 // JSON body; later publisher docs specify optional structured server info.
 if(bytes===0)return {transport:'nethernet',nethernet_supported:true,capability_http_status:response.status,server_info_available:false,authenticated_player_join:false,gameplay_tested:false};
 return {...serverInfo(JSON.parse(Buffer.concat(chunks).toString('utf8'))),capability_http_status:response.status};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await queryNethernet(Number(process.argv[2])),null,2));
