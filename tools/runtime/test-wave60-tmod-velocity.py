"""Run retained mocked entrypoint fixtures against the current canonical emission."""
import importlib.util, json, os, runpy, sys, tempfile, unittest
from pathlib import Path
from unittest import mock
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave60-tmod-velocity-integration'
profile=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())
source=(ROOT/'tools/runtime/test-tmodloader-wave59.py').read_text(encoding='utf-8-sig')
source=source.replace("OUT=ROOT/'artifacts/game-parity-20261029/wave59-tmodloader-preservation'",'OUT=Path('+repr(str(OUT))+')')
namespace={'__file__':str(ROOT/'tools/runtime/test-tmodloader-wave59.py'),'__name__':'wave60_tmod'}
exec(compile(source,'retained-wave59-fixtures','exec'),namespace)

class Integration(unittest.TestCase):
 def test_all_emitted_python_imports(self):
  import subprocess
  for directory in ('tmodloader','velocity'):
   for file in (OUT/directory).glob('*.py'):
    code='import sys,importlib.util;sys.path.insert(0,sys.argv[1]);s=importlib.util.spec_from_file_location("emitted_check",sys.argv[2]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)'
    subprocess.run([sys.executable,'-B','-c',code,str(file.parent),str(file)],check=True,capture_output=True)
 def test_tmod_start_refusal_before_process(self):
  with tempfile.TemporaryDirectory() as tmp:
   cwd=Path.cwd();os.chdir(tmp);sys.path.insert(0,str(OUT/'tmodloader'))
   try:
    with mock.patch.dict(os.environ,{'SERVER_PORT':'0'},clear=True),mock.patch('subprocess.run',side_effect=AssertionError('process')),mock.patch('os.execve',side_effect=AssertionError('exec')):
     with self.assertRaises(ValueError):runpy.run_path(str(OUT/'tmodloader/tmodloader_runtime.py'),run_name='__main__')
    self.assertEqual(list(Path(tmp).iterdir()),[])
   finally:os.chdir(cwd)
 def test_stager_idempotent_and_scoped(self):
  spec=importlib.util.spec_from_file_location('stage60',ROOT/'tools/runtime/wave60-tmod-velocity-integration.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  self.assertEqual(m.stage(profile),{k:profile[k] for k in (m.T,m.V)})
  self.assertEqual(json.loads(profile[m.T]['egg']['config']['files'])['serverconfig.txt']['find'],{'port':'{{server.build.default.port}}'})
 def test_velocity_literal_entrypoint_refusal_and_mocked_success(self):
  sys.path.insert(0,str(OUT/'velocity'))
  import proxy_family_install as p
  script=profile['minecraft/proxy/java/velocity/egg-velocity.json']['egg']['scripts']['installation']['script']
  self.assertIn('python3 .voltra/proxy_family_install.py velocity',script)
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'velocity.toml').write_text('invalid = [')
   cwd=Path.cwd();os.chdir(root)
   try:
    with mock.patch.dict(os.environ,{'SERVER_JARFILE':'velocity.jar'},clear=True),mock.patch.object(sys,'argv',['proxy_family_install.py','velocity']),mock.patch('urllib.request.urlopen',side_effect=AssertionError('network')):
     with self.assertRaises(Exception) as failure:runpy.run_path(str(OUT/'velocity/proxy_family_install.py'),run_name='__main__')
     self.assertIsInstance(failure.exception,ValueError)
    self.assertEqual((root/'velocity.toml').read_text(),'invalid = [');self.assertFalse((root/'velocity.jar').exists())
   finally:os.chdir(cwd)

if __name__=='__main__':
 suite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(namespace['Emitted']),unittest.defaultTestLoader.loadTestsFromTestCase(Integration)])
 result=unittest.TextTestRunner(verbosity=2).run(suite);sys.exit(not result.wasSuccessful())

