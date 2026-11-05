import importlib.util,json,re,sys,tempfile,unittest,os
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('stage',HERE/'stage-longvinter-wave28.py');stage=importlib.util.module_from_spec(spec);spec.loader.exec_module(stage)
class Fixtures(unittest.TestCase):
 def test_emitted_seed_and_preservation(self):
  p=stage.stage()
  self.assertTrue(p['egg']['startup'].endswith('.voltra/longvinter_wave28.py run'))
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);mod=root/'.voltra';mod.mkdir()
   for name,delimiter,body in re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\r?\n([\s\S]*?)\r?\n\2",p['egg']['scripts']['installation']['script']):
    (mod/name).write_text(body+'\n')
   sys.path.insert(0,str(mod))
   try:
    import longvinter_wave28 as game
    info=game.metadata()['longvinter'];binary=root/info['binary'];binary.parent.mkdir(parents=True);binary.write_bytes(b'fixture only')
    env={'SERVER_PORT':'28003','QUERY_PORT':'28004','VOLTRA_ALLOCATED_PORTS':'28003,28004'}
    argv,_,_,_=game.configure(root,env);target=root/info['config'];self.assertIn(b'CheckVPN = true',target.read_bytes());self.assertIn('-Port=28003',argv)
    original=b'; operator\r\n[Unknown]\r\n+Array=one\r\n+Array=two\r\nSecret=unprinted\r\n'
    target.write_bytes(original);game.configure(root,env);self.assertEqual(original,target.read_bytes())
    for changes in ({'QUERY_PORT':'28003','VOLTRA_STEAM_AUTO_UPDATE':'1'},{'VOLTRA_STEAM_AUTO_UPDATE':'invalid'}):
     before={str(p.relative_to(root)):p.read_bytes() if p.is_file() else None for p in root.rglob('*')}
     with patch.dict(os.environ,{**env,**changes},clear=True),patch.object(sys,'argv',['.voltra/longvinter_wave28.py','run']),patch.object(game.Path,'cwd',return_value=root),patch.object(game,'install') as update:
      with self.assertRaises(ValueError):game.main()
      update.assert_not_called()
     self.assertEqual(before,{str(p.relative_to(root)):p.read_bytes() if p.is_file() else None for p in root.rglob('*')})
    with patch.dict(os.environ,{**env,'VOLTRA_STEAM_AUTO_UPDATE':'1'},clear=True),patch.object(sys,'argv',['.voltra/longvinter_wave28.py','run']),patch.object(game.Path,'cwd',return_value=root),patch.object(game,'install') as update,patch.object(game,'native_run',return_value=17):
     self.assertEqual(game.main(),17)
     update.assert_called_once()
    with self.assertRaises(ValueError):game.configure(root,{**env,'QUERY_PORT':'28003'})
    self.assertEqual(original,target.read_bytes())
    for failure in (False,True):
     def update(*a,**k):
      target.write_bytes(b'publisher replacement')
      if failure:raise RuntimeError('mock update failed')
     with patch.object(sys.modules['unreal_building'],'update',side_effect=update):
      if failure:
       with self.assertRaises(RuntimeError):game.install(root,'longvinter',env)
      else:game.install(root,'longvinter',env)
     self.assertEqual(original,target.read_bytes())
   finally:sys.path.pop(0)
if __name__=='__main__':unittest.main()

