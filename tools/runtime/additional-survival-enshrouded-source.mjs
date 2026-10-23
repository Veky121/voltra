import fs from'node:fs';import crypto from'node:crypto';import{spawnSync}from'node:child_process';import{api}from'./openttd-compat-node.mjs';
const dir='.local/additional-survival/enshrouded',s=JSON.parse(fs.readFileSync(dir+'/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));
if(s.node!==202||n.root!=='/var/lib/voltra-batch-20261023'||(await api('/api/application/servers/'+s.internal_id)).attributes.status!==null)throw Error('Owned installation is not ready');
const names=['steam-template.py','bundle-debian-python.py','native-config.py','additional-survival-install.py','enshrouded-proton.py','enshrouded-runtime.py'];
const script=`import json,pathlib,hashlib
r=pathlib.Path('/snapshot');names=json.loads(${JSON.stringify(JSON.stringify(names))})
print(json.dumps({'helpers':{name:hashlib.sha256((r/'.voltra'/name.replace('-','_')).read_bytes()).hexdigest() for name in names},'release':json.loads((r/'.voltra/steam-template-release.json').read_text()),'native_exe_bytes':(r/'enshrouded_server.exe').stat().st_size,'save_files':{str(p.relative_to(r)):p.stat().st_size for p in (r/'savegame').rglob('*') if p.is_file()}}))`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','128m','--mount',`type=bind,source=${n.volume_root}/${s.uuid},target=/snapshot,readonly`,'python:3.13-slim','python3','-B','-'],{input:script,encoding:'utf8',timeout:60000});
if(result.status)throw Error(result.stderr);const proof=JSON.parse(result.stdout);proof.uuid=s.uuid;proof.matches=Object.fromEntries(names.map(name=>[name,proof.helpers[name]===crypto.createHash('sha256').update(fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')+'\n').digest('hex')]));
if(Object.values(proof.matches).some(x=>!x)||proof.release.platform!=='windows'||proof.release.appid!==2278520)throw Error('Reviewed Windows install/source identity mismatch');
fs.writeFileSync(dir+'/source-proof.json',JSON.stringify(proof,null,2));console.log({source_matches:true,release:proof.release,native_exe_bytes:proof.native_exe_bytes});
