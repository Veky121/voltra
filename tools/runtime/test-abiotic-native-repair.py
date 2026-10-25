"""Offline Abiotic regression evidence; no game download or compatibility claim."""
import importlib.util,io,os,signal,subprocess,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name):
 s=importlib.util.spec_from_file_location(name.replace('-','_'),BASE/(name+'.py'));m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);return m
for name in ('steam-template','native-config','native-console','enshrouded-proton','unreal-survival-install'):load(name)
r=load('unreal-survival-runtime')
class Capture:
 def __init__(self):self.buffer=io.BytesIO()
class Repair(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.log=self.root/'Saved/Logs/native.log';self.log.parent.mkdir(parents=True);self.output=Capture()
 def pause(self):time.sleep(.12)
 def test_fresh_redacts_split_secret_and_closes(self):
  with patch.object(r.sys,'stdout',self.output):
   log=r.AbioticLog(self.root,self.log,['private-secret']);log.start();self.log.write_bytes(b'ready private-');self.pause()
   with self.log.open('ab')as f:f.write(b'secret shutdown\n')
   self.pause();log.finish()
  self.assertFalse(log.thread.is_alive());data=self.output.buffer.getvalue();self.assertIn(b'ready',data);self.assertNotIn(b'private-secret',data);self.assertIn(b'shutdown',data)
 def test_old_bytes_not_replayed(self):
  self.log.write_bytes(b'OLD readiness\n')
  with patch.object(r.sys,'stdout',self.output):
   log=r.AbioticLog(self.root,self.log,[]);log.start();self.pause()
   with self.log.open('ab')as f:f.write(b'new bytes\n')
   self.pause();log.finish()
  self.assertNotIn(b'OLD',self.output.buffer.getvalue());self.assertIn(b'new bytes',self.output.buffer.getvalue())
 def test_rotation_and_truncation(self):
  self.log.write_bytes(b'previous-long-line\n')
  with patch.object(r.sys,'stdout',self.output):
   log=r.AbioticLog(self.root,self.log,[]);log.start();self.log.rename(self.log.with_suffix('.old'));self.log.write_bytes(b'rotated\n');self.pause();self.log.write_bytes(b'trunc\n');self.pause();log.finish()
  self.assertIn(b'rotated',self.output.buffer.getvalue());self.assertIn(b'trunc',self.output.buffer.getvalue());self.assertNotIn(b'previous',self.output.buffer.getvalue())
 def test_symlink_and_fifo_fail_closed(self):
  other=self.root/'outside';other.write_bytes(b'secret');self.log.symlink_to(other)
  with self.assertRaises(OSError):r.AbioticLog(self.root,self.log,[])
  self.log.unlink();os.mkfifo(self.log)
  with self.assertRaises(ValueError):r.AbioticLog(self.root,self.log,[])
 def test_parent_symlink_rejected(self):
  self.log.parent.rmdir();self.log.parent.symlink_to(self.root)
  with self.assertRaises(OSError):r.AbioticLog(self.root,self.log,[])
 def main_case(self,game,result=None,error=None):
  binary=self.root/'AbioticFactor/Binaries/Win64/server.exe';binary.parent.mkdir(parents=True);binary.write_bytes(b'fixture');(binary.parent/'steam_appid.txt').write_text('427410')
  cwd=Path.cwd();os.chdir(self.root)
  try:
   with patch.object(r.sys,'argv',['runtime',game]),patch.dict(os.environ,{'VOLTRA_STEAM_AUTO_UPDATE':'0'}),patch.object(r,'configure',return_value=([str(self.root/'proton'),'run',str(binary)],dict(os.environ),[],b'ready')),patch.object(r,'run',return_value=result,side_effect=error)as run:
    if error:
     with self.assertRaisesRegex(RuntimeError,'original'):r.main()
    else:self.assertEqual(r.main(),result)
    self.assertEqual(run.call_args.args[0],binary.parent if game=='abiotic' else self.root)
    if game=='abiotic':self.assertEqual((run.call_args.args[0]/'steam_appid.txt').read_text(),'427410')
  finally:os.chdir(cwd)
 def test_abiotic_cwd_appid_raw254(self):self.main_case('abiotic',254)
 def test_exception_cleanup_preserves_exception(self):self.main_case('abiotic',error=RuntimeError('original'))
 def test_other_branch_cwd_unchanged(self):self.main_case('humanitz',130)
 def test_actual_child_stop_raw37_log_and_thread_cleanup(self):
  binary=self.root/'AbioticFactor/Binaries/Win64/native.py';binary.parent.mkdir(parents=True);(binary.parent/'steam_appid.txt').write_text('427410')
  binary.write_text("import pathlib,signal,time,sys\np=pathlib.Path('../../Saved/Logs/AbioticFactor.log');p.parent.mkdir(parents=True,exist_ok=True)\ndef stop(*_):\n p.open('a').write('native shutdown fixture-secret\\n');sys.exit(37)\nsignal.signal(signal.SIGINT,stop)\np.write_text('cwd-appid='+pathlib.Path('steam_appid.txt').read_text()+' ready fixture-secret\\n')\ntime.sleep(20)\n")
  code='import importlib.util,sys,os;from pathlib import Path;'
  code+='base=Path('+repr(str(BASE))+');'
  for name in ('steam-template','native-config','native-console','enshrouded-proton','unreal-survival-install','unreal-survival-runtime'):
   code+="s=importlib.util.spec_from_file_location("+repr(name.replace('-','_'))+",base/"+repr(name+'.py')+");m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);"
  code+='m.configure=lambda *a:([sys.executable,"-u",'+repr(str(binary))+'],dict(os.environ),["fixture-secret"],b"ready");sys.argv=["runtime","abiotic"];sys.exit(m.main())'
  environment=dict(os.environ,VOLTRA_STEAM_AUTO_UPDATE='0')
  child=subprocess.Popen([sys.executable,'-B','-c',code],cwd=self.root,env=environment,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  try:
   deadline=time.monotonic()+5;native_log=self.root/'AbioticFactor/Saved/Logs/AbioticFactor.log'
   while time.monotonic()<deadline and not native_log.exists():time.sleep(.02)
   self.assertIn('cwd-appid=427410 ready',native_log.read_text());child.send_signal(signal.SIGTERM);rest,_=child.communicate(timeout=5);first=b''
   self.assertEqual(child.returncode,37,first+rest);self.assertIn(b'native shutdown',first+rest);self.assertNotIn(b'fixture-secret',first+rest)
  finally:
   if child.poll()is None:child.kill();child.wait()
if __name__=='__main__':unittest.main()
