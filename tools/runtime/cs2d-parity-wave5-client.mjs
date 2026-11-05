// Bounded real-client probe in the already-owned server container. No download.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {runtime,verifyRuntime,activeLease,docker,api} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'cs2d-native'),state=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
const receipt=await verifyRuntime();activeLease(state.lease.lease_id,'cs2d_native');
const uuid=state.fixture.server.uuid;
const container=JSON.parse(docker(['inspect',uuid]))[0];
if(!container.State.Running)throw Error('Owned server must already be running');
const report={at:new Date().toISOString(),uuid,container:container.Id,backend:receipt.binary_sha256,kind:'actual-local-matching-client',client_duration_seconds:35};
const code=String.raw`
import os, pathlib, zipfile, hashlib, subprocess, time, json, shutil, signal, ctypes, struct, zlib
root=pathlib.Path('/home/container');sha='855314b79c1cca60e93834461784882464fe00bf6a5aa2e86017c4ecbc4b16b1'
archive=root/'.voltra/public-cache-retained/0ce1aa60-f0cb-4f80-b100-88e15d48822a'/sha
assert hashlib.sha256(archive.read_bytes()).hexdigest()==sha
base=root/('.voltra/cs2d/client-proof-'+str(int(time.time())))
`;
// Keep the Python source separate from shell quoting; Docker exec consumes stdin.
const python=code+String.raw`
base.mkdir(parents=True);sysroot=base/'sys';sysroot.mkdir()
client=base/'CS2D';shutil.copyfile(root/'cs2d/CS2D',client);client.chmod(0o700)
assert hashlib.sha256(client.read_bytes()).digest()==hashlib.sha256((root/'cs2d/CS2D').read_bytes()).digest()
with zipfile.ZipFile(archive) as z:
 for entry in z.infolist():
  p=pathlib.PurePosixPath(entry.filename)
  if not p.parts or p.parts[0]!='sys':continue
  assert not p.is_absolute() and '..' not in p.parts and entry.file_size<4000000
  target=base/pathlib.Path(*p.parts)
  if entry.is_dir():target.mkdir(parents=True,exist_ok=True)
  else:
   target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(entry))
assert not (sysroot/'lua/autorun/voltra-console.lua').exists()
env=os.environ.copy()
for k in ('PYTHONHOME','PYTHONPATH'):env.pop(k,None)
env.update(DISPLAY=':98',LD_LIBRARY_PATH=str(root/'cs2d'),LIBGL_ALWAYS_SOFTWARE='1')
assert not pathlib.Path('/tmp/.X98-lock').exists()
xlog=open(base/'xvfb.log','wb');clog=open(base/'client.log','wb');x=None;c=None;result={}
try:
 x=subprocess.Popen(['Xvfb',':98','-screen','0','640x480x24','-nolisten','tcp','-ac'],env=env,stdout=xlog,stderr=subprocess.STDOUT,start_new_session=True)
 time.sleep(1);assert x.poll() is None
 args=[str(client),'-path',str(root/'cs2d'),'-sys',str(sysroot),'-join','127.0.0.1:29106','-noopenal','-nosfx','-nointro','-off','-win','-w','640','-h','480']
 c=subprocess.Popen(args,cwd=root/'cs2d',env=env,stdout=clog,stderr=subprocess.STDOUT,start_new_session=True)
 print(json.dumps({'stage':'client-started','pid':c.pid,'sys':str(sysroot)}),flush=True)
 deadline=time.time()+35
 screenshot=False
 while time.time()<deadline and c.poll() is None:
  time.sleep(.5)
  if not screenshot and deadline-time.time()<23:
   xlib=ctypes.CDLL('libX11.so.6');xlib.XOpenDisplay.argtypes=[ctypes.c_char_p];xlib.XOpenDisplay.restype=ctypes.c_void_p
   d=xlib.XOpenDisplay(b':98');assert d
   xlib.XDefaultRootWindow.argtypes=[ctypes.c_void_p];xlib.XDefaultRootWindow.restype=ctypes.c_ulong
   xlib.XGetImage.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_int,ctypes.c_uint,ctypes.c_uint,ctypes.c_ulong,ctypes.c_int];xlib.XGetImage.restype=ctypes.c_void_p
   image=xlib.XGetImage(d,xlib.XDefaultRootWindow(d),0,0,640,480,0xffffffff,2);assert image
   xlib.XGetPixel.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int];xlib.XGetPixel.restype=ctypes.c_ulong
   pixels=bytearray()
   for y in range(480):
    pixels.append(0)
    for xcoord in range(640):
     v=xlib.XGetPixel(image,xcoord,y);pixels.extend(((v>>16)&255,(v>>8)&255,v&255))
   def chunk(t,b):return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
   (base/'client.png').write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',640,480,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b''))
   xlib.XDestroyImage.argtypes=[ctypes.c_void_p];xlib.XDestroyImage(image);xlib.XCloseDisplay.argtypes=[ctypes.c_void_p];xlib.XCloseDisplay(d);screenshot=True
 result={'client_exit_before_cleanup':c.poll(),'client_alive_at_deadline':c.poll() is None,'client_sys':str(sysroot),'base':str(base)}
finally:
 for child in (c,x):
  if child and child.poll() is None:
   os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=3)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=3)
 for handle in (clog,xlog):handle.close()
result.update(client_cleaned=c is None or c.poll() is not None,display_cleaned=x is None or x.poll() is not None)
result['client_log_tail']=(base/'client.log').read_text(errors='replace')[-5000:]
print(json.dumps({'stage':'complete',**result}),flush=True)
`;
const child=spawn('docker',['--context','desktop-linux','exec','-i',container.Id,'env','PYTHONHOME=/home/container/.voltra/python','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','/home/container/.voltra/python/bin/python3','-u','-'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
let output='',errors='';child.stdout.on('data',x=>{output+=x;});child.stderr.on('data',x=>{errors+=x;});child.stdin.end(python);
const done=new Promise(resolve=>child.on('close',resolve));
report.observations=[];
for(let n=0;n<7;n++){
 await new Promise(r=>setTimeout(r,4500));
 if(child.exitCode!==null)break;
 const command=`lua "print('CS2D_CLIENT_CONNECTED',#player(0,'table')); for _,id in pairs(player(0,'table')) do print('CS2D_CLIENT_PEER',id,player(id,'name'),player(id,'bot')) end"`;
 await api('/api/client/servers/'+uuid+'/command','POST',{command});
 report.observations.push({at:new Date().toISOString(),command_submitted:true});
}
report.exit=await done;report.stdout=output;report.stderr=errors;
const completed=output.split('\n').filter(Boolean).map(line=>JSON.parse(line)).find(x=>x.stage==='complete');
if(completed){try{const png=path.join(dir,'client-'+Date.now()+'.png');docker(['cp',container.Id+':'+completed.base+'/client.png',png]);report.screenshot=png;}catch{}}
const nativeLog=docker(['logs','--tail','400',container.Id]);
report.server_evidence=nativeLog.split(/\r?\n/).filter(line=>/CS2D_CLIENT_|joined the game|has joined|connected|disconnected/i.test(line));
report.native_settings_unchanged=true;
const cfg=docker(['exec',container.Id,'sha256sum','/home/container/cs2d/sys/server.cfg']);
report.config_sha256=cfg.split(/\s/)[0];
report.native_settings_unchanged=report.config_sha256===state.reinstall.after.config_sha256;
fs.writeFileSync(path.join(dir,'client-proof-'+Date.now()+'.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(report.exit!==0||!report.native_settings_unchanged)process.exitCode=1;
