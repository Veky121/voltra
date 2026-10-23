import fs from'node:fs';import{execFileSync}from'node:child_process';import{api,remote,file,directory}from'./openttd-compat-node.mjs';
const s=JSON.parse(fs.readFileSync(file));const [action,value]=process.argv.slice(2);const base='/api/client/servers/'+s.identifier;
if((await api(base)).attributes.uuid!==s.uuid)throw Error('Identity mismatch');
if(action==='commands'){
 for(const command of ['getseed','setting server_game_type','save /home/container/voltra-compat'])await api(base+'/command','POST',{command});
 console.log('Native seed/visibility/save commands sent; observe acknowledgements.');
}else if(action==='visibility'){
 if((await api(base+'/resources')).attributes.current_state!=='offline')throw Error('Stop first');
 if(value==='explicit-local')await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{environment:{srv_advertise:'true',SERVER_VISIBILITY:'local'}});
 else if(value==='legacy-local')await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{environment:{srv_advertise:'false',SERVER_VISIBILITY:'auto'}});
 else throw Error('Unknown mode');
 console.log('Owned visibility setting changed.');
}else if(action==='paths'){
 console.log(remote(`import json,pathlib
r=pathlib.Path('/var/lib/voltra-temp-20261022-lan/volumes/${s.uuid}')
print(json.dumps({'save_paths':[str(p.relative_to(r)) for p in r.rglob('*.sav')],'root':[p.name for p in r.iterdir()]}))`));
}else if(action==='record'){
 const observation=JSON.parse(fs.readFileSync(directory+'/observation.json'));
 const query=JSON.parse(execFileSync(process.execPath,['tools/game-query/query.mjs','openttd','192.168.178.89',String(s.port)],{encoding:'utf8'}));
 const data=remote(`import json,pathlib,hashlib,subprocess
r=pathlib.Path('/var/lib/voltra-temp-20261022-lan/volumes/${s.uuid}')
logs=subprocess.check_output(['docker','logs','${s.uuid}'],text=True,stderr=subprocess.STDOUT)
cfg=(r/'openttd.cfg').read_text();p=r/'voltra-compat.sav'
print(json.dumps({'native_probes':[x for x in logs.splitlines() if 'Generation Seed:' in x or 'server_game_type' in x or 'Game saved' in x or 'Loading game' in x or 'Map generated, starting game' in x],'save_bytes':p.stat().st_size if p.exists() else None,'save_sha256':hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None,'visibility':[x.strip() for x in cfg.splitlines() if x.strip().startswith('server_game_type')]}))`);
 fs.writeFileSync(directory+'/'+value+'.json',JSON.stringify({query,...data,observed_at:new Date().toISOString()},null,2));console.log({query,...data});
}else throw Error('commands|visibility|record');
