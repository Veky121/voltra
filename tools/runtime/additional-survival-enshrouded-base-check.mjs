import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const dir='.local/additional-survival/enshrouded',s=JSON.parse(fs.readFileSync(dir+'/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt));
const image=Object.values(JSON.parse(fs.readFileSync('.local/additional-survival/profiles.json'))['enshrouded/egg-enshrouded.json'].egg.docker_images)[0];
const previous=JSON.parse(fs.readFileSync(dir+'/observation.json'));
const failure='artifacts/enshrouded-ge11-bookworm-development.json';
if(!fs.existsSync(failure))fs.writeFileSync(failure,JSON.stringify({uuid:s.uuid,revision:'enshrouded-native-v3',accepted:false,observation:previous,diagnosis:'GE11 dynamically loaded ntdll.so requires GLIBC_2.38, unavailable in bookworm. No HostOnline reached.'},null,2)+'\n');
const script=`import os,pathlib,subprocess,json
r=pathlib.Path('/snapshot');env=dict(os.environ);env['LD_LIBRARY_PATH']=str(r/'.voltra/proton/lib')+':'+str(r/'.voltra/proton/GE-Proton11-9/files/lib/wine/x86_64-unix')
files=[r/'.voltra/proton/GE-Proton11-9/files/bin/wine',r/'.voltra/proton/GE-Proton11-9/files/lib/wine/x86_64-unix/ntdll.so',r/'.voltra/proton/GE-Proton11-9/files/lib/wine/x86_64-unix/lsteamclient.so']
checks={str(p.relative_to(r)):subprocess.run(['ldd',str(p)],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT).stdout for p in files}
if any(not p.is_file() for p in files):raise ValueError(json.dumps(checks))
if any('not found' in text for text in checks.values()):raise ValueError('Missing runtime dependency')
print(json.dumps({'glibc':subprocess.check_output(['getconf','GNU_LIBC_VERSION'],text=True).strip(),'dependencies':checks}))`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--read-only','--memory','192m','--entrypoint','python3','--mount',`type=bind,source=${n.volume_root}/${s.uuid},target=/snapshot,readonly`,image,'-B','-'],{input:script,encoding:'utf8',timeout:60000});
if(result.status)throw Error(result.stderr+result.stdout);const proof={image,...JSON.parse(result.stdout)};fs.writeFileSync(dir+'/base-proof.json',JSON.stringify(proof,null,2)+'\n');console.log({image,glibc:proof.glibc,checked_native_libraries:Object.keys(proof.dependencies).length});
