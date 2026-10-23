// Exercise reviewed Bash integrity, private modes and process reaping without a game.
import fs from 'node:fs';import {resolve} from 'node:path';import {spawnSync} from 'node:child_process';
const file=resolve(process.argv[2]??'');if(!file.endsWith('console-launcher-current.sh')||!fs.statSync(file).isFile())throw Error('Explicit secret-free rendered launcher required');
const program=String.raw`
from pathlib import Path
import os,subprocess,tempfile,json,hashlib,re,stat
source=Path('/reviewed.sh').read_text()
expected=re.findall(r"'([a-f0-9]{64})'",source)[0]
for code in [0,7,'corrupt']:
 with tempfile.TemporaryDirectory() as d:
  p=Path(d);private=p/'.voltra';private.mkdir()
  client=private/'console-client'
  client.write_text('#!/usr/local/bin/python3\nimport os,time\nfrom pathlib import Path\nPath("client.pid").write_text(str(os.getpid()))\ntime.sleep(60)\n')
  digest=hashlib.sha256(client.read_bytes()).hexdigest()
  if code=='corrupt':client.write_bytes(client.read_bytes()+b'#corrupted')
  client.chmod(0o644)
  for name in ['sevendays-console.yaml','console-client.manifest.json','console-client.LICENSE']:(private/name).write_text('{}\n')
  (p/'serverconfig.xml').write_text('<ServerSettings/>')
  script=source.replace('/home/container',d).replace(expected,digest)
  lines=script.splitlines();lines=[('(echo native-started >native.flag; sleep .4; exit '+str(code)+') &' if line.startswith('./7DaysToDieServer.x86_64 ') else line) for line in lines]
  script='\n'.join(lines).replace('for attempt in $(seq 1 240); do','console_ready() { return 0; }\nfor attempt in $(seq 1 240); do')
  (p/'start.sh').write_text(script)
  result=subprocess.run(['bash','start.sh'],cwd=d,capture_output=True,timeout=5)
  if code=='corrupt':
   assert result.returncode!=0 and not (p/'native.flag').exists(),'corrupt client launched native game'
   assert stat.S_IMODE(client.stat().st_mode)==0o644,'corrupt client made executable'
   print(json.dumps({'corrupt_client_rejected_before_chmod_and_game':True}));continue
  assert result.returncode==code,'native exit status not preserved'
  pid=int((p/'client.pid').read_text())
  try:os.kill(pid,0);raise AssertionError('console client survived native exit')
  except ProcessLookupError:pass
  assert stat.S_IMODE(client.stat().st_mode)==0o700 and stat.S_IMODE(private.stat().st_mode)==0o700
  assert all(stat.S_IMODE(q.stat().st_mode)==0o600 for q in [p/'serverconfig.xml',private/'sevendays-console.yaml',private/'console-client.manifest.json',private/'console-client.LICENSE'])
  print(json.dumps({'native_exit':code,'wrapper_exit':result.returncode,'console_reaped':True,'private_modes':True}))
`;
const r=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','64m','--cpus','1','--mount',`type=bind,source=${file},target=/reviewed.sh,readonly`,'python:3.13-slim','python3','-B','-c',program],{encoding:'utf8',windowsHide:true,timeout:20000});if(r.status)throw Error('Native launcher fixture failed: '+r.stderr);console.log(r.stdout.trim());
