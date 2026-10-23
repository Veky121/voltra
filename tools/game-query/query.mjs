import {GameDig} from 'gamedig';
const [type,host,portText]=process.argv.slice(2),port=Number(portText);
if(!type||!host||!Number.isInteger(port)||port<1||port>65535)throw Error('Usage: query.mjs TYPE HOST PORT');
const state=await GameDig.query({type,host,port,givenPortOnly:true,portCache:false,maxRetries:0,socketTimeout:2000,attemptTimeout:7000,ipFamily:4});
const raw={};for(const key of ['sv_hostname','sv_maxclients','mapname','g_gametype','g_needpass','protocol','gamename','version','timelimit','fraglimit','qcstatus','modname','gameversion','bots','clients'])if(state.raw?.[key]!==undefined)raw[key]=state.raw[key];
// These native protocols do not include a join-password flag. GameDig's default
// false must not be presented as evidence of passwordless joins.
const password=['xonotic','starmade'].includes(type)?null:state.password===true||state.password===1||state.password==='1';
console.log(JSON.stringify({name:state.name,map:state.map,version:state.version,maxplayers:Number(state.maxplayers),players:state.players?.length||0,bots:state.bots?.length||0,password,ping:state.ping,raw}));
