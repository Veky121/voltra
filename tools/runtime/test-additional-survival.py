import importlib.util
import pathlib
import tempfile
import unittest
import os
import sys
import io
import signal
import threading
import time
import subprocess
import tarfile

root=pathlib.Path('/source')
sys.path.insert(0,str(root))
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,root/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
steam=load('steam_template','steam-template.py')
load('native_config','native-config.py');load('native_console','native-console.py')
install=load('additional_survival_install','additional-survival-install.py')
proton=load('enshrouded_proton','enshrouded-proton.py')
baro=load('barotrauma_runtime','barotrauma-runtime.py');ensh=load('enshrouded_runtime','enshrouded-runtime.py')

class Config(unittest.TestCase):
 def test_ensh_native_signal_targets_exact_windows_binary(self):
  with tempfile.TemporaryDirectory() as directory:
   base=pathlib.Path(directory);proc=base/'proc';proc.mkdir();game=base/'game';game.mkdir()
   for pid,args in [('123',('Z:'+str(game/'enshrouded_server.exe').replace('/','\\')).encode()+b'\0'),('124',b'python3\0proton\0enshrouded_server.exe\0'),('125',b'Z:\\other\\enshrouded_server.exe\0')]:
    entry=proc/pid;entry.mkdir();(entry/'cmdline').write_bytes(args)
   self.assertEqual(ensh.native_pids(game,proc),[123])
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)
  for name in ['DedicatedServer','enshrouded_server.exe']:(self.root/name).touch()
  self.env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001','SERVER_NAME':'literal +$ "name"','SERVER_PASSWORD':'private-secret','MAX_PLAYERS':'8'}
 def tearDown(self):self.temp.cleanup()
 def test_baro_native_xml_and_argv(self):
  (self.root/'serversettings.xml').write_text('<serversettings custom="retain" maxplayers="2"><!--operator--><CampaignSettings custom="true" /></serversettings>')
  argv,env,creds=baro.configure(self.root,self.env)
  import xml.etree.ElementTree as ET
  data=ET.parse(self.root/'serversettings.xml').getroot()
  self.assertEqual(data.attrib['servername'],self.env['SERVER_NAME']);self.assertEqual(data.attrib['maxplayers'],'8')
  self.assertEqual(data.attrib['queryport'],'28001');self.assertEqual(data.attrib['ispublic'],'false');self.assertEqual(data.attrib['custom'],'retain')
  self.assertIn('<!--operator-->',(self.root/'serversettings.xml').read_text());self.assertIsNotNone(data.find('CampaignSettings'))
  self.assertNotIn('private-secret',argv);self.assertIn('private-secret',creds)
  self.assertEqual((self.root/'serversettings.xml').stat().st_mode&511,384)
 def test_baro_port_and_xml_validation(self):
  for change in [{'QUERY_PORT':'28000'},{'VOLTRA_ALLOCATED_PORTS':'28000'},{'MAX_PLAYERS':'17'},{'SERVER_NAME':'bad\nname'}]:
   with self.assertRaises(ValueError):baro.configure(self.root,{**self.env,**change})
  (self.root/'serversettings.xml').write_text('<!DOCTYPE x [<!ENTITY a "bad">]><serversettings/>')
  with self.assertRaises(ValueError):baro.configure(self.root,self.env)
 def test_ensh_roles_and_unknown_json(self):
  import json
  fake=self.root/'.voltra/proton'/proton.VERSION/'proton';fake.parent.mkdir(parents=True);fake.touch()
  (self.root/'enshrouded_server.json').write_text(json.dumps({'other':{'keep':True},'userGroups':[{'name':'Admin','canKickBan':False,'custom':7},{'name':'Operator custom','password':'kept-secret'}]}))
  argv,env,creds,log=ensh.configure(self.root,{**self.env,'SRV_NAME':'Ensh $quoted','SRV_PW':'AdminPass','SRV_PW2':'FriendPass','SRV_PW3':'GuestPass','SRV_PW4':'VisitorPass'})
  data=json.loads((self.root/'enshrouded_server.json').read_text());self.assertTrue(data['other']['keep']);self.assertEqual(data['queryPort'],28000)
  admin=data['userGroups'][0];self.assertFalse(admin['canKickBan']);self.assertEqual(admin['custom'],7);self.assertEqual(admin['password'],'AdminPass')
  self.assertIn('kept-secret',creds);self.assertEqual(argv[:2],[str(fake),'run']);self.assertTrue(str(log).startswith(str(self.root)))
 def test_ensh_invalid_password_slots_paths(self):
  for change in [{'SRV_PW':'1234'},{'SRV_PW':'same','SRV_PW2':'same'},{'MAX_PLAYERS':'17'},{'GAME_PRESET':'unknown'}]:
   with self.assertRaises(ValueError):ensh.configure(self.root,{**self.env,**change})
  (self.root/'enshrouded_server.json').write_text('{"saveDirectory":"../escape"}')
  with self.assertRaises(ValueError):ensh.configure(self.root,self.env)
 def test_installer_preserves_bytes_even_on_failure(self):
  content=b'\xef\xbb\xbf<serversettings custom="bytes"/>\r\n';target=self.root/'serversettings.xml';target.write_bytes(content)
  target.chmod(0o640);os.chown(target,12345,23456)
  old=install.update
  def fail(*args,**kwargs):target.write_bytes(b'publisher replacement');raise RuntimeError('native Steam failed')
  install.update=fail
  try:
   with self.assertRaises(RuntimeError):install.install(self.root,'barotrauma',self.env)
  finally:install.update=old
  self.assertEqual(target.read_bytes(),content)
  self.assertEqual(target.stat().st_mode&511,0o640);self.assertEqual(target.stat().st_uid,12345);self.assertEqual(target.stat().st_gid,23456)
 def test_typed_windows_platform(self):
  args=steam.arguments(self.root,2278520,{'WINDOWS_INSTALL':'1'},platform='windows')
  self.assertLess(args.index('+@sSteamCmdForcePlatformType'),args.index('+login'))
  with self.assertRaises(ValueError):steam.arguments(self.root,2278520,{'WINDOWS_INSTALL':'1'})
 def test_runtime_user_can_restore_owned_metadata(self):
  self.root.chmod(0o755);runtime=self.root/'runtime';runtime.mkdir();os.chown(runtime,65534,65534)
  target=runtime/'serversettings.xml';target.write_bytes(b'operator bytes');os.chown(target,65534,65534);target.chmod(0o640)
  code="import sys,importlib.util,types,os,pathlib\ns=types.ModuleType('steam_template');s.update=lambda *a,**kw:None;sys.modules['steam_template']=s\np=importlib.util.spec_from_file_location('installer','/source/additional-survival-install.py');m=importlib.util.module_from_spec(p);p.loader.exec_module(m)\nos.setgid(65534);os.setuid(65534);m.install(pathlib.Path(sys.argv[1]),'barotrauma')\n"
  result=subprocess.run([sys.executable,'-c',code,str(runtime)],capture_output=True,timeout=5)
  self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(target.stat().st_uid,65534);self.assertEqual(target.stat().st_gid,65534);self.assertEqual(target.stat().st_mode&511,0o640)
 def test_ensh_native_log_redaction_and_stop_signal(self):
  log=self.root/'native.log';child=self.root/'fake-native.py'
  child.write_text("import signal,time,pathlib,sys\np=pathlib.Path(sys.argv[1])\ndef stop(*_):\n p.open('a').write('native saved\\n');sys.exit(0)\nsignal.signal(signal.SIGINT,stop)\np.write_text(\"[Session] 'HostOnline' (up)! private-secret\\n\")\nwhile True:time.sleep(.05)\n")
  oldout=sys.stdout;oldsignals={s:signal.getsignal(s) for s in (signal.SIGINT,signal.SIGTERM)}
  capture=io.BytesIO();wrapper=io.TextIOWrapper(capture,encoding='utf-8');sys.stdout=wrapper
  timer=threading.Timer(.5,lambda:os.kill(os.getpid(),signal.SIGTERM));timer.start()
  try:result=ensh.run(self.root,[sys.executable,str(child),str(log)],dict(os.environ),['private-secret'],log)
  finally:
   timer.cancel();timer.join();wrapper.flush();sys.stdout=oldout
   for s,handler in oldsignals.items():signal.signal(s,handler)
  output=capture.getvalue();self.assertEqual(result,0);self.assertNotIn(b'private-secret',output);self.assertIn(b"HostOnline",output);self.assertIn('native saved',log.read_text())
  wrapper.detach()
 def test_symlink_backup_confinement(self):
  with tempfile.TemporaryDirectory() as outside:
   (self.root/'.voltra').symlink_to(outside,target_is_directory=True)
   with self.assertRaises(ValueError):baro.configure(self.root,self.env)
   with self.assertRaises(ValueError):install.install(self.root,'barotrauma',self.env)
 def test_fragmented_terminal_queries_preserve_nonqueries(self):
  console=sys.modules['native_console'];pending=b'';out=b'';replies=[]
  for chunk in [b'hello\x1b',b'[',b'6',b'n\x1b[5',b'n world\x1b[31m']:
   clean,pending,reply=console.terminal_queries(chunk,pending);out+=clean;replies+=reply
  self.assertEqual(out,b'hello world\x1b[31m');self.assertEqual(pending,b'');self.assertEqual(replies,[b'\x1b[1;1R',b'\x1b[0n'])
  self.assertEqual(console.terminal_queries(b'',b'\x1b[',final=True),(b'\x1b[',b'',[]))
 def test_native_pty_replies_without_waiting_for_newline(self):
  for name in ['steam-template.py','native-console.py']:(self.root/name.replace('-','_')).write_text((root/name).read_text())
  (self.root/'engine.py').write_text("import os,sys,termios,time,select\na=termios.tcgetattr(0);a[3]&=~(termios.ICANON|termios.ECHO);termios.tcsetattr(0,termios.TCSANOW,a)\nos.write(1,b'prefix\\x1b[');time.sleep(.02);os.write(1,b'6n')\nassert select.select([0],[],[],1)[0], 'no cursor reply'\nassert os.read(0,6)==b'\\x1b[1;1R'\nos.write(1,b'\\x1b[5n')\nassert select.select([0],[],[],1)[0], 'no status reply'\nassert os.read(0,4)==b'\\x1b[0n'\nprint('READY private-secret',flush=True)\n")
  (self.root/'launch.py').write_text("from native_console import run\nfrom pathlib import Path\nimport sys,os\nraise SystemExit(run(Path.cwd(),[sys.executable,'engine.py'],dict(os.environ),'quit',credentials=['private-secret'],terminal_input=True,terminal_query_reply=True))\n")
  result=subprocess.run([sys.executable,'launch.py'],cwd=self.root,input=b'',capture_output=True,timeout=5)
  self.assertEqual(result.returncode,0,result.stderr);self.assertIn(b'READY',result.stdout);self.assertNotIn(b'private-secret',result.stdout);self.assertNotIn(b'\x1b[6n',result.stdout)
 def test_proton_confined_files_and_distribution_links(self):
  archive=self.root/'source.tar.gz';stage=self.root/'stage';stage.mkdir()
  with tarfile.open(archive,'w:gz') as target:
   info=tarfile.TarInfo(proton.ARCHIVE_ROOT+'/proton');info.size=3;info.mode=0o755;target.addfile(info,io.BytesIO(b'run'))
   link=tarfile.TarInfo(proton.ARCHIVE_ROOT+'/alias');link.type=tarfile.SYMTYPE;link.linkname='proton';target.addfile(link)
   hard=tarfile.TarInfo(proton.ARCHIVE_ROOT+'/hard');hard.type=tarfile.LNKTYPE;hard.linkname=proton.ARCHIVE_ROOT+'/proton';target.addfile(hard)
  proton.unpack(archive,stage);self.assertEqual((stage/'alias').read_bytes(),b'run');self.assertEqual((stage/'hard').read_bytes(),b'run');self.assertEqual((stage/'proton').stat().st_mode&511,0o755)
 def test_proton_rejects_archive_traversal_and_external_links(self):
  for index,(name,link) in enumerate([(proton.ARCHIVE_ROOT+'/../escape',None),(proton.ARCHIVE_ROOT+'/alias','../../outside'),('/absolute',None)]):
   archive=self.root/('bad'+str(index)+'.tar.gz');stage=self.root/('stage'+str(index));stage.mkdir()
   with tarfile.open(archive,'w:gz') as target:
    info=tarfile.TarInfo(name)
    if link is not None:info.type=tarfile.SYMTYPE;info.linkname=link
    else:info.size=1
    target.addfile(info,None if link else io.BytesIO(b'x'))
   with self.assertRaises(ValueError):proton.unpack(archive,stage)
 def test_windows_install_provisions_reviewed_bridge(self):
  calls=[];old_update,old_provision=install.update,proton.provision
  install.update=lambda *a,**kw:calls.append(kw) or {'buildid':1}
  proton.provision=lambda root:calls.append('provision')
  try:install.install(self.root,'enshrouded',{'WINDOWS_INSTALL':'1'})
  finally:install.update=old_update;proton.provision=old_provision
  self.assertEqual(calls[0]['platform'],'windows');self.assertEqual(calls[1],'provision')

unittest.main()
