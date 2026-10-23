import fs from 'node:fs';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const[game,action]=process.argv.slice(2),dir='.local/small-games-family/'+game,s=JSON.parse(fs.readFileSync(dir+'/private.json'));if(!['clone','tachyon','stk','mohaa'].includes(game))throw Error('Invalid family game');
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;if(server.uuid!==s.uuid||server.node!==202||server.egg!==s.egg_id)throw Error('Owned identity mismatch');
const run=(args,input)=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,input});if(r.status)throw Error('Owned Docker read failed: '+r.stderr.slice(0,200));return r.stdout;};
const clean=value=>{for(const secret of s.passwords||[])value=value.replaceAll(secret,'[REDACTED]');return value;};
if(action==='observe'){
 const info=JSON.parse(run(['inspect',s.uuid]))[0];const logs=spawnSync('docker',['logs','--tail','150',s.uuid],{encoding:'utf8',windowsHide:true});
 const proof={uuid:s.uuid,status:server.status,container:info.State,logs:clean(logs.stdout+logs.stderr),at:new Date().toISOString()};fs.writeFileSync(dir+'/observation.json',JSON.stringify(proof,null,2)+'\n');console.log({...proof,logs:proof.logs.slice(-2400)});
}else if(action==='source'){
 if(server.status!==null)throw Error('Installer not finished');const names=['steam-template.py','native-config.py','native-console.py','native-release.py','java-games-install.py','small-games-family-install.py','small-games-family-runtime.py'];
 const input=`import pathlib,json,hashlib
r=pathlib.Path('/volume');names=json.loads(${JSON.stringify(JSON.stringify(names))});print(json.dumps({name:hashlib.sha256((r/'.voltra'/name.replace('-','_')).read_bytes()).hexdigest() for name in names}))`;
 const actual=JSON.parse(run(['run','--rm','-i','--network','none','--read-only','--memory','128m','--mount',`type=bind,source=/var/lib/voltra-batch-20261023/volumes/${s.uuid},target=/volume,readonly`,'python:3.13-slim','python','-B','-'],input));const matches=Object.fromEntries(names.map(name=>[name,actual[name]===crypto.createHash('sha256').update(fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')+'\n').digest('hex')]));if(!Object.values(matches).every(Boolean))throw Error('Installed source differs: '+Object.entries(matches).filter(([,ok])=>!ok).map(([name])=>name).join(','));fs.writeFileSync(dir+'/source-proof.json',JSON.stringify({uuid:s.uuid,matches,hashes:actual},null,2));console.log({source_matches:true});
}else if(action==='commands'){
 const commands={clone:['help'],tachyon:['/help','/online','/save'],stk:['help'],mohaa:['status']}[game];for(const command of commands)await api('/api/client/servers/'+s.identifier+'/command','POST',{command});console.log('Native console probes sent; acknowledgements require observation.');
}else if(action==='sockets'){
 const input=`import pathlib,json
ports={};
for proto in ['tcp','tcp6','udp','udp6']:
 ports[proto]=[int(line.split()[1].split(':')[-1],16) for line in pathlib.Path('/proc/net/'+proto).read_text().splitlines()[1:]]
assert ${s.ports[0]} in [p for values in ports.values() for p in values];print(json.dumps(ports))`;
 const proof={uuid:s.uuid,ports:JSON.parse(run(['exec','-i',s.uuid,'python3','-B','-'],input))};fs.writeFileSync(dir+'/sockets.json',JSON.stringify(proof,null,2));console.log(proof);
}else throw Error('observe|source|commands|sockets');
