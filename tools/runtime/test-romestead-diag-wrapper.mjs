import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const script=`from pathlib import Path
import tempfile,subprocess,os,sys,time,json
run='25fe42e1-2417-4b70-9e14-318f82e9cdbe';rows=[]
for completed in [False,True]:
 with tempfile.TemporaryDirectory()as directory:
  root=Path(directory);(root/'.voltra/diagnostics').mkdir(parents=True)
  # An unrelated prior completion can never release this generation's hold.
  (root/'.voltra/diagnostics/collector-00000000-0000-0000-0000-000000000000.done').write_text(run)
  code="import sys,types,runpy,time,threading;from pathlib import Path;m=types.ModuleType('crafting_runtime');m.main=lambda root,env:7;sys.modules['crafting_runtime']=m;sys.argv=['wrapper',"+repr(run)+"];"
  if completed:code+="threading.Thread(target=lambda:(time.sleep(.2),Path('.voltra/diagnostics/collector-"+run+".done').write_text('"+run+"'))).start();"
  code+="runpy.run_path('/source/wrapper.py',run_name='__main__')"
  begin=time.monotonic();p=subprocess.run([sys.executable,'-B','-c',code],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=7);elapsed=time.monotonic()-begin
  assert p.returncode==7,p.stderr.decode();assert (.15<elapsed<2)if completed else(4.9<elapsed<6)
  rows.append({'collector_completed':completed,'elapsed_seconds':round(elapsed,2),'raw_native_code':p.returncode,'stale_other_identity_ignored':True})
print(json.dumps({'synthetic_only':True,'memory_mib':256,'rows':rows}))`;
const r=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=bind,source=${path.resolve('tools/runtime/romestead-diag-wrapper.py')},target=/source/wrapper.py,readonly`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:script,encoding:'utf8',timeout:15000});if(r.status)throw Error(r.stderr);fs.writeFileSync('.local/romestead-native/trace-wrapper-synthetic-proof.json',r.stdout,{flag:'wx'});console.log(r.stdout);
