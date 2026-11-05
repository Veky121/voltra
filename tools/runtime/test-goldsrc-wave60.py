"""Exercise emitted helper filenames with every external boundary denied."""
import importlib.util, pathlib, sys, unittest, os, runpy, tempfile
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave60-goldsrc-admission'
def boundary(event,args):
 if event in ('subprocess.Popen','os.system','os.exec','socket.connect','socket.getaddrinfo'):raise AssertionError('Unmocked boundary: '+event)
sys.addaudithook(boundary)
original=importlib.util.spec_from_file_location
for i in (0,1):
 emitted=OUT/f'emitted-{i}'
 def loader(name,path,*args,**kwargs):
  path=pathlib.Path(path)
  candidate=emitted/path.name.replace('-','_')
  if path.parent.name=='scripts' and candidate.exists():path=candidate
  return original(name,path,*args,**kwargs)
 with patch.object(importlib.util,'spec_from_file_location',loader):
  path=ROOT/'tools/runtime/test-goldsrc-wave58.py'
  ns={'__file__':str(path),'__name__':'wave60'}
  exec(compile(path.read_text(encoding="utf-8-sig"),str(path),'exec'),ns)
 suite=unittest.defaultTestLoader.loadTestsFromTestCase(ns['PreflightTests'])
 result=unittest.TextTestRunner(verbosity=2).run(suite)
 assert result.wasSuccessful() and result.testsRun==17
 for name in ('goldsrc_install.py','goldsrc_runtime.py'):
  with tempfile.TemporaryDirectory() as tmp:
   before=os.getcwd();os.chdir(tmp)
   try:
    with patch.dict(os.environ,{'VOLTRA_GOLDSRC_RECIPE':'rehlds' if i else 'generic','HLDS_GAME':'valve','SERVER_PORT':'0','VOLTRA_ALLOCATED_PORTS':'28100,28101','AUTO_UPDATE':'1'},clear=True):
     try:runpy.run_path(str(emitted/name),run_name='__main__')
     except ValueError:pass
     else:raise AssertionError('entrypoint accepted malformed port')
    assert not list(pathlib.Path(tmp).iterdir())
   finally:os.chdir(before)
print('34 inherited cases and 4 emitted entrypoint refusal checks passed')

