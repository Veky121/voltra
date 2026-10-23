// Offline development preflight only. No panel request or native game startup.
import fs from'node:fs';import path from'node:path';import{spawnSync}from'node:child_process';
const s=JSON.parse(fs.readFileSync('.local/additional-survival/enshrouded/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));
if(s.node!==202||n.node!==202||n.root!=='/var/lib/voltra-batch-20261023')throw Error('Owned local node mismatch');
for(const name of[s.uuid,s.uuid+'_installer']){const r=spawnSync('docker',['inspect',name],{encoding:'utf8'});if(r.status===0&&JSON.parse(r.stdout)[0].State.Running)throw Error('Stop server and installer before offline prep');if(r.status&&!r.stderr.includes('No such'))throw Error('Inspection failed');}
const script=`set -eu
apt-get update
apt-get install -y --no-install-recommends libvulkan1
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 - <<'PROTON_PREFLIGHT'
import importlib.util,pathlib,json,subprocess
s=importlib.util.spec_from_file_location('proton','/helper/enshrouded-proton.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r=pathlib.Path('/snapshot');record=m.provision(r)
wine=r/'.voltra/proton'/m.VERSION/'files/bin/wine64'
if not wine.exists():wine=r/'.voltra/proton'/m.VERSION/'files/bin/wine'
environment=dict(__import__('os').environ);environment['LD_LIBRARY_PATH']=str(r/'.voltra/proton/lib')
p=subprocess.run(['ldd',str(wine)],env=environment,text=True,capture_output=True)
assert p.returncode==0 and 'not found' not in p.stdout, p.stdout+p.stderr
print(json.dumps({'proton':record,'wine_dependencies_present':True}))
PROTON_PREFLIGHT
`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--user','0','--memory','1024m','--cpus','2','--mount',`type=bind,source=${n.volume_root}/${s.uuid},target=/snapshot`,'--mount',`type=bind,source=${path.resolve('internal/panel/game_library/scripts/enshrouded-proton.py')},target=/helper/enshrouded-proton.py,readonly`,'--entrypoint','/bin/sh','ghcr.io/ptero-eggs/steamcmd@sha256:38380883a880937c6bdfa25a29a50601e8fd010a126157f857539bfd9057ed7b'],{input:script,encoding:'utf8',timeout:300000,maxBuffer:2*1024*1024});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error)throw result.error;process.exitCode=result.status??1;
