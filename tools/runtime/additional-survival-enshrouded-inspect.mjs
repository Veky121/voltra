import fs from'node:fs';import{spawnSync}from'node:child_process';
const s=JSON.parse(fs.readFileSync('.local/additional-survival/enshrouded/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));
const script=`import pathlib,json,hashlib
r=pathlib.Path('/snapshot')
print(json.dumps([{'path':str(p.relative_to(r)),'bytes':p.stat().st_size,'utils011':b'SteamUtils011' in p.read_bytes()} for p in r.rglob('*') if p.is_file() and (p.name.lower().startswith(('steamclient','steam_api','tier0','vstdlib')) or p.name=='steam_appid.txt')]))`;
const result=spawnSync('docker',['run','--rm','-i','--network','none','--read-only','--memory','192m','--mount',`type=bind,source=${n.volume_root}/${s.uuid},target=/snapshot,readonly`,'python:3.13-slim','python3','-B','-'],{input:script,encoding:'utf8',timeout:60000});if(result.status)throw Error(result.stderr);console.log(result.stdout);
