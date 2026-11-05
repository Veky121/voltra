// One bounded local client feasibility probe. No new image/dependency/download.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {runtime,verifyRuntime,activeLease,observePower} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'xonotic-native'),file=path.join(dir,'state.json'),s=JSON.parse(fs.readFileSync(file)),receipt=await verifyRuntime();activeLease(s.lease.lease_id,'xonotic_native');assert.equal((await observePower(s.fixture)).current_state,'running');
const code=`import pathlib,os,subprocess,time,json,signal,resource,hashlib,shutil
root=pathlib.Path('/home/container');owned=root/'.voltra'/('xonotic-client-probe-'+str(time.time_ns()));owned.mkdir(mode=0o700);(owned/'data').mkdir(mode=0o700)
shutil.copy2(root/'.xonotic/data/voltra-parity-map.pk3',owned/'data/voltra-parity-map.pk3')
protected=[root/'.xonotic/data/server.cfg',root/'.xonotic/data/voltra-managed.cfg',root/'.xonotic/data/voltra-parity-map.pk3',root/'.voltra/xonotic/rcon-password']
before={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
env=dict(os.environ);env.update(SDL_VIDEODRIVER='offscreen',SDL_AUDIODRIVER='dummy',LIBGL_ALWAYS_SOFTWARE='1',GALLIUM_DRIVER='llvmpipe',LP_NUM_THREADS='1',EGL_PLATFORM='surfaceless')
argv=[str(root/'xonotic/xonotic-linux64-sdl'),'-basedir',str(root/'xonotic'),'-userdir',str(owned),'-nohome','-nosound','-window','+vid_fullscreen','0','+vid_width','640','+vid_height','480','+r_picmip','4','+net_slist_pause','1','+name','VoltraParityClient','+connect','127.0.0.1:${s.lease.ports[0]}','+defer','15','screenshot','+defer','24','quit']
log=owned/'client.log';peak=0;reason='native-client-exit';start=time.monotonic()
def core_limit():resource.setrlimit(resource.RLIMIT_CORE,(0,0))
with log.open('wb') as output:
 child=subprocess.Popen(argv,cwd=owned,env=env,stdin=subprocess.PIPE,stdout=output,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=core_limit)
 try:
  while child.poll() is None:
   values=dict(line.split() for line in pathlib.Path('/sys/fs/cgroup/memory.stat').read_text().splitlines());used=int(values.get('anon','0'))+int(values.get('kernel','0'));peak=max(peak,used)
   if used>1536*1024**2:reason='combined-anon-memory-cutoff';break
   if time.monotonic()-start>30:reason='bounded-30s-timeout';break
   time.sleep(0.1)
 finally:
  if child.poll() is None:
   try:child.stdin.write(b'quit\\n');child.stdin.flush();child.wait(timeout=2)
   except (OSError,subprocess.TimeoutExpired):
    try:os.killpg(child.pid,signal.SIGTERM);child.wait(timeout=2)
    except (ProcessLookupError,subprocess.TimeoutExpired):
     if child.poll() is None:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=2)
after={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in protected};assert before==after
print(json.dumps({'client_pid':child.pid,'client_exit':child.returncode,'reason':reason,'elapsed_seconds':time.monotonic()-start,'combined_anon_kernel_peak':peak,'existing_container_memory_max':pathlib.Path('/sys/fs/cgroup/memory.max').read_text().strip(),'client_and_display_processes_finished':child.poll() is not None,'new_dependencies':False,'new_downloads':False,'display':'SDL offscreen/Mesa software; no host window or Xvfb','separate_client_userdir':str(owned.relative_to(root)),'client_log':str(log.relative_to(root)),'server_files_unchanged':True,'screenshots':[str(p.relative_to(root)) for p in (owned/'data/screenshots').glob('*')]}))
`;
const r=spawnSync('docker',['--context','desktop-linux','exec',s.fixture.server.uuid,'python3','-c',code],{windowsHide:true,encoding:'utf8',timeout:45000});
fs.writeFileSync(path.join(dir,'client-probe-command.log'),(r.stdout||'')+(r.stderr||''));if(r.status!==0)throw Error('Owned bounded client probe failed; diagnostics retained, no gameplay claim');
const result=JSON.parse(r.stdout.trim());
const response=await fetch('http://127.0.0.1:18099/api/client/servers/'+s.fixture.server.uuid+'/files/contents?file='+encodeURIComponent('/'+result.client_log));assert.equal(response.status,200);const log=await response.text();fs.writeFileSync(path.join(dir,'client-probe-native.log'),log);
const current=JSON.parse(fs.readFileSync(file));current.client_probe={at:new Date().toISOString(),backend:receipt.binary_sha256,...result,player_join_verified:false,gameplay:false};fs.writeFileSync(file,JSON.stringify(current,null,2)+'\n');console.log(JSON.stringify(current.client_probe));
