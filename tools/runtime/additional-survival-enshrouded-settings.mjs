// Report managed native settings without writing any passwords to output.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const dir='.local/additional-survival/enshrouded',s=JSON.parse(fs.readFileSync(dir+'/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));
const script=`import pathlib,json,sys,hashlib
r=pathlib.Path('/snapshot');expected=json.load(sys.stdin);data=json.loads((r/'enshrouded_server.json').read_text())
groups={g['name']:g for g in data['userGroups']};keys={'Admin':'SRV_PW','Friend':'SRV_PW2','Guest':'SRV_PW3','Visitor':'SRV_PW4'}
result={'name':data['name'],'slotCount':data['slotCount'],'queryPort':data['queryPort'],'gameSettingsPreset':data['gameSettingsPreset'],'role_passwords_match':{name:groups[name]['password']==expected[key] for name,key in keys.items()},'role_count':len(groups),'proton_release':json.loads((r/'.voltra/proton/release.json').read_text()),'save_files':{str(p.relative_to(r)):p.stat().st_size for p in (r/'savegame').rglob('*') if p.is_file()}}
log=r/data.get('logDirectory','./logs')/'enshrouded_server.log'
assert log.resolve().is_relative_to(r.resolve())
tail=log.read_bytes()[-8192:] if log.is_file() else b''
result['native_log_closed']=b'[enshrouded] Close Log file' in tail
print(json.dumps(result))`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--read-only','--memory','128m','--mount',`type=bind,source=${n.volume_root}/${s.uuid},target=/snapshot,readonly`,'python:3.13-slim','python3','-B','-c',script],{input:JSON.stringify(s.passwords),encoding:'utf8',timeout:30000});
if(result.status)throw Error(result.stderr);const proof=JSON.parse(result.stdout);
if(Object.values(proof.role_passwords_match).some(value=>!value)||proof.name!=='Voltra Enshrouded'||proof.slotCount!==4||proof.queryPort!==s.ports[0])throw Error('Managed native settings mismatch');
fs.writeFileSync(dir+'/settings-proof.json',JSON.stringify(proof,null,2)+'\n');console.log({native_settings_match:true,role_count:proof.role_count,proton_version:proof.proton_release.version,save_files:Object.keys(proof.save_files).length});
