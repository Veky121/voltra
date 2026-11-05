import json,re,sys,tempfile,unittest,os,runpy
from pathlib import Path
from unittest.mock import patch
repo=Path(__file__).resolve().parents[2];out=repo/'artifacts/game-parity-20261029/wave63-rising-legacy'
script=next(iter(json.loads((out/'recipe-fragment.json').read_text()).values()))['egg']['scripts']['installation']['script']
with tempfile.TemporaryDirectory(prefix='rising-emitted-') as d:
 stage=Path(d)
 for name,source in re.findall(r"cat > .voltra/([\w.]+) <<'VOLTRA_JAVA_SOURCE'\n(.*?)\nVOLTRA_JAVA_SOURCE",script,re.S):(stage/name).write_text(source)
 sys.path.insert(0,d)
 import java_games_runtime as r,java_games_install as i
 env={'SERVER_PORT':'28021','VOLTRA_ALLOCATED_PORTS':','.join(map(str,range(28020,28027))),'RCON_PASSWORD':'fixture-secret'}
 class Tests(unittest.TestCase):
  def test_preflight_both_entrypoints(self):
   for change in ({'SERVER_PORT':'1'},{'SERVER_MEMORY':'bad'},{'SRCDS_BETAID':'unity'},{'RCON_PASSWORD':'x'},{'VOLTRA_ALLOCATED_PORTS':'bad'},{'VOLTRA_GAME_LD_LIBRARY_PATH':'../escape'}):
    for entry in ('java_games_runtime.py','java_games_install.py'):
     with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{**env,**change,'AUTO_UPDATE':'1'},clear=True),patch.object(i,'update',side_effect=AssertionError('publisher')),patch.object(i,'download',side_effect=AssertionError('download')),patch.object(sys.modules['native_console'],'run',side_effect=AssertionError('process')),patch.object(sys,'argv',[entry,'rising-world-java']):
      old=Path.cwd();os.chdir(root)
      try:
       with self.assertRaises(ValueError):runpy.run_path(str(stage/entry),run_name='__main__')
       self.assertEqual(list(Path(root).iterdir()),[])
      finally:os.chdir(old)
  def test_native_authority_launch(self):
   with tempfile.TemporaryDirectory() as d:
    root=Path(d)
    for name in ('.voltra/java8/bin/java','server.jar'):
     p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('fixture')
    (root/'linux64').mkdir();p=root/'server.properties';p.write_text('server_password=native-secret\nrcon_password=native-rcon\nrcon_enabled=true\nordinary=keep\n');before=p.read_bytes()
    argv,child,stop,ready,secrets=r.launch(root,'rising-world-java',env)
    self.assertEqual(p.read_bytes(),before);self.assertIn('native-secret',secrets);self.assertFalse(any('servername' in a or 'maxplayer' in a for a in argv));self.assertIn('+serverport=28021',argv);self.assertEqual(stop,'shutdown')
  def test_preservation_success_and_failure(self):
   for fail in (False,True):
    with tempfile.TemporaryDirectory() as d:
     root=Path(d); snapshots={}
     for name in ('Worlds/world.db','plugins/mod.jar','server.properties'):
      p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('rcon_password=native-rcon\n' if name=='server.properties' else 'operator');p.chmod(0o640);snapshots[name]=(p.read_bytes(),p.stat())
     def publisher(stage,*args,**kwargs):
      for name in ('Worlds/world.db','plugins/mod.jar','server.properties','server.jar'):
       p=stage/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('publisher')
      if fail:raise ValueError('publisher failed')
     with patch.object(i,'update',side_effect=publisher),patch.object(i,'java8'):
      if fail:
       with self.assertRaises(ValueError):i.install(root,'rising-world-java',env)
      else:i.install(root,'rising-world-java',env)
     for name,(data,st) in snapshots.items():
      p=root/name;self.assertEqual(p.read_bytes(),data);self.assertEqual(p.stat().st_mtime_ns,st.st_mtime_ns);self.assertEqual(p.stat().st_mode,st.st_mode)
  def test_sibling_validators(self):
   self.assertEqual(r.validate_starmade(Path(d),{'SERVER_PORT':'1234','VOLTRA_ALLOCATED_PORTS':'1234'}),'StarMade.jar')
   self.assertEqual(r.validate_necesse({'SERVER_PORT':'1234','VOLTRA_ALLOCATED_PORTS':'1234'})[0],'Save1')
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests));sys.exit(not result.wasSuccessful())
