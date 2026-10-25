import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const dir='.local/solace-native',phase=process.argv[2]??'first',live=JSON.parse(fs.readFileSync(dir+'/live-'+phase+'.json'));
const reply=Buffer.from(live.query.reply_hex,'hex');assert.equal(reply.readInt32LE(0),-1);assert.equal(reply[4],0x49);let offset=6;
function string(){const end=reply.indexOf(0,offset);assert(end>=offset,'Truncated A2S string');const value=reply.toString('utf8',offset,end);offset=end+1;return value;}
const query={protocol:reply[5],name:string(),map:string(),folder:string(),game:string()};query.appid=reply.readUInt16LE(offset);offset+=2;
Object.assign(query,{players:reply[offset++],maximum:reply[offset++],bots:reply[offset++],type:String.fromCharCode(reply[offset++]),environment:String.fromCharCode(reply[offset++]),password:reply[offset++]===1,vac:reply[offset++]});query.version=string();
assert.equal(query.name,live.config.name);assert.equal(query.maximum,live.config.maxPlayers);assert.equal(query.password,live.config.password);assert(live.game_tcp_connected);assert.equal(live.resources.attributes.current_state,'running');
assert(live.listeners.some(p=>p.port===live.config.port&&p.protocol.startsWith('tcp')));assert(live.listeners.some(p=>p.port===live.config.steamQueryPort&&p.protocol==='udp'));
assert(!live.listeners.some(p=>p.port===5055),'Unexpected5055 listener needs allocation review');
const sourcePhase=phase==='first'?'first':'final-source',sourceDir=dir+'/installed-source-'+sourcePhase,manifest=JSON.parse(fs.readFileSync(sourceDir+'/manifest.json')),profile=JSON.parse(fs.readFileSync(dir+'/source-profile-'+sourcePhase+'.json'));
for(const[name,value]of Object.entries(manifest)){
 const bytes=fs.readFileSync(sourceDir+'/'+name);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),value.sha256);
 const marker=`cat > .voltra/${name} <<'VOLTRA_FANTASY_SOURCE'\n`,script=profile.egg.scripts.installation.script,start=script.indexOf(marker)+marker.length,end=script.indexOf('VOLTRA_FANTASY_SOURCE\n',start);
 assert(start>=marker.length&&end>start,'Missing helper heredoc '+name);
 assert.equal(bytes.toString(),script.slice(start,end),'Actual helper does not match exact heredoc bytes '+name);
}
const result={phase,query,game_tcp_connected:true,query_matches_native_config:true,allocated_game_and_query_listeners:true,no_5055_listener_observed:true,source_helpers_verified:Object.keys(manifest).length,native_gameplay_tested:false};
fs.writeFileSync(dir+'/evidence-'+phase+'.json',JSON.stringify(result,null,2)+'\n');console.log(result);
