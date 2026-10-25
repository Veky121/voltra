import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/jc3-native',{receipt:s,node}=await ownedStoppedServer(dir+'/private.json');if(s.owner!=='game_batch_inventory'||s.path!=='just_cause/just_cause_3/egg-j-c3-m-p.json')throw Error('Foreign fixture');
const original=JSON.parse(fs.readFileSync(dir+'/test-package-files.json'))['main.js'],body=original.replace("print('VOLTRA_NATIVE_SAVE", "console.log('VOLTRA_NATIVE_SAVE");if(body===original)throw Error('Expected fixture-only print correction');
const code=`from pathlib import Path
import os,json,hashlib,tempfile
r=Path('/volume');p=r/'packages/voltra-persistence/main.js'
if p.is_symlink() or p.parent.is_symlink() or p.read_text()!=${JSON.stringify(original)}:raise ValueError('Fixture changed unexpectedly')
old=p.stat();fd,tmp=tempfile.mkstemp(prefix='.fixture-fix-',dir=p.parent)
try:
 with os.fdopen(fd,'w')as output:output.write(${JSON.stringify(body)});output.flush();os.fsync(output.fileno())
 os.chown(tmp,old.st_uid,old.st_gid);os.chmod(tmp,old.st_mode&0o777);os.replace(tmp,p)
finally:
 if os.path.exists(tmp):os.unlink(tmp)
counter=json.loads((p.parent/'data/counter.json').read_text())
if counter['generation']!=1:raise ValueError('Unexpected prior native save')
print(json.dumps({'prior_native_generation':counter['generation'],'main_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'mode':p.stat().st_mode&0o777,'uid':p.stat().st_uid,'gid':p.stat().st_gid}))
`;
const p=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8'});if(p.status)throw Error(p.stderr);fs.writeFileSync(dir+'/test-package-fixed-main.js',body,{flag:'wx'});fs.writeFileSync(dir+'/test-package-fix.json',p.stdout,{flag:'wx'});console.log(JSON.parse(p.stdout));
