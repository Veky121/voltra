import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/virtual-worlds/nwn',{receipt}=await ownedStoppedServer(dir+'/private.json');
const code=`import pathlib,re,tomllib,json,os
r=pathlib.Path('/volume');p=r/'user/settings.tml';assert not p.is_symlink()
content=p.read_text();before=tomllib.loads(content)
pattern=r'(?m)(^\\s*\\[server\\.log\\.rotation\\]\\s*\\n)(.*?)(?=^\\s*\\[|\\Z)'
matches=list(re.finditer(pattern,content,re.S|re.M));assert len(matches)==1
m=matches[0];section=m.group(2);updated,count=re.subn(r'(?m)^(\\s*enabled\\s*=\\s*)(true|false)(.*)$',r'\\1false\\3',section);assert count==1
content=content[:m.start(2)]+updated+content[m.end(2):];after=tomllib.loads(content);assert after['server']['log']['rotation']['enabled'] is False
p.write_text(content);p.chmod(0o600)
folder=r/'user/voltra-retention';assert not folder.is_symlink();folder.mkdir(exist_ok=True)
for name,data in [('unicode-note.txt','Operator fixture 雪 517077\\n'.encode()),('opaque.bin',bytes(range(256)))]:
 q=folder/name;assert not q.exists();q.write_bytes(data);q.chmod(0o640)
print(json.dumps({'operator_native_log_rotation':False,'unmanaged_files':2,'uid':p.stat().st_uid,'gid':p.stat().st_gid,'settings_mode':oct(p.stat().st_mode&0o777)}))`;
const result=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','128m','--cpus','1','--read-only','--user','988:988','--mount',`type=bind,source=/var/lib/voltra-batch-20261023/volumes/${receipt.uuid},target=/volume`,'python:3.13-slim','python','-B','-c',code],{windowsHide:true,encoding:'utf8',timeout:15000});
if(result.status)throw Error('Retention fixture failed '+result.stderr.slice(-800));
const proof={uuid:receipt.uuid,at:new Date().toISOString(),...JSON.parse(result.stdout)};fs.writeFileSync(dir+'/retention-fixture.json',JSON.stringify(proof,null,2));console.log(proof);
