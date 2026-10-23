import fs from 'node:fs';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const game=process.argv[2];if(!['dmp','lmp'].includes(game))throw Error('dmp|lmp');const dir='.local/ksp-games/'+game,s=JSON.parse(fs.readFileSync(dir+'/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));
if((await api('/api/application/servers/'+s.internal_id)).attributes.status!==null)throw Error('Installer is not finished');
const names=['steam-template.py','native-config.py','native-console.py','ksp-install.py','ksp-runtime.py'];
const script=`import pathlib,json,hashlib
r=pathlib.Path('/snapshot');names=json.loads(${JSON.stringify(JSON.stringify(names))})
print(json.dumps({'helpers':{name:hashlib.sha256((r/'.voltra'/name.replace('-','_')).read_bytes()).hexdigest() for name in names},'release':json.loads((r/'.voltra/ksp/${game}-release.json').read_text())}))`;
const run=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--read-only','--memory','128m','--mount',`type=bind,source=${n.volume_root}/${s.uuid},target=/snapshot,readonly`,'python:3.13-slim','python3','-B','-'],{input:script,encoding:'utf8'});if(run.status)throw Error(run.stderr);
const proof={uuid:s.uuid,...JSON.parse(run.stdout)};proof.matches=Object.fromEntries(names.map(name=>[name,proof.helpers[name]===crypto.createHash('sha256').update(fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')+'\n').digest('hex')]));
if(Object.values(proof.matches).some(value=>!value))throw Error('Installed final KSP source mismatch');fs.writeFileSync(dir+'/source-proof.json',JSON.stringify(proof,null,2)+'\n');console.log({source_matches:true,release:proof.release});
