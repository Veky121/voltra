"""Exact emitted modules, offline install/start boundaries, Linux subprocess runner."""
import importlib.util,json,os,sys,tempfile,unittest,subprocess,runpy
from pathlib import Path
from unittest import mock
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave59-tmodloader-preservation'
profile=json.loads((OUT/'profiles.pending.json').read_text())['terraria/tmodloader/egg-t-modloader.json']
script=profile['egg']['scripts']['installation']['script']
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
class Emitted(unittest.TestCase):
 def test_emitted_entrypoints(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);helpers=root/'.voltra';helpers.mkdir()
   for name,marker in [('terraria_release_install','VOLTRA_TERRARIA_RELEASE'),('tmodloader_runtime','VOLTRA_TMODLOADER_RUNTIME'),('tshock_runtime','VOLTRA_TSHOCK_RUNTIME')]:
    source=script.split("<<'"+marker+"'\n",1)[1].split('\n'+marker+'\n',1)[0];(helpers/(name+'.py')).write_text(source)
   installer=load('terraria_release_install',helpers/'terraria_release_install.py');runtime=load('tmodloader_runtime',helpers/'tmodloader_runtime.py')
   f=load('fixtures59',ROOT/'tools/runtime/test-tmodloader-runtime.py')
   # Fixture loader replaces module names; restore exact emitted modules.
   sys.modules.update(terraria_release_install=installer,tmodloader_runtime=runtime)
   env={'VOLTRA_TERRARIA_KIND':'tmodloader','VERSION':'v2026.08.3.0','SERVER_PORT':'28000','WORLD_NAME':'seed'}
   config=root/'serverconfig.txt';config.write_text('# operator\nworldname=chosen\nmaxplayers=12\npassword=keep\nworld=/home/container/saves/Worlds/chosen.wld\nunknown=keep\nport=7777\n');config.chmod(0o640)
   import zipfile
   with tempfile.TemporaryDirectory() as payload:
    content=Path(payload);f.fixture(content)
    def download(release,destination,cache):
     with zipfile.ZipFile(destination,'w') as z:
      for p in content.rglob('*'):
       if p.is_file() and '.voltra' not in p.relative_to(content).parts:z.write(p,p.relative_to(content))
     return installer.digest(destination)
    deny=mock.Mock(side_effect=AssertionError('external boundary'))
    with mock.patch.object(installer.urllib.request,'build_opener',deny),mock.patch.object(runtime.subprocess,'run',deny):
     for key,value in [('SERVER_PORT','0'),('WORLD_NAME','../escape'),('MAX_PLAYERS','256'),('LANGUAGE','0'),('MOTD','bad\nport=1'),('RELEASE_SHA256','x'),('VERSION','vlatest')]:
      before=config.read_bytes()
      with self.subTest(key=key),self.assertRaises(ValueError):runtime.install(root,{**env,key:value},read_metadata=deny,download=deny,machine='x86_64')
      self.assertEqual(before,config.read_bytes())
     # Execute the emitted installer Python body with its literal import.
     body=script.split("<<'VOLTRA_INSTALL'\n",1)[1].split('\nVOLTRA_INSTALL',1)[0]
     original=runtime.install
     def offline(r,e):return original(r,e,read_metadata=deny,download=download,machine='x86_64')
     cwd=Path.cwd();os.chdir(root)
     try:
      with mock.patch.dict(os.environ,env,clear=True),mock.patch.object(runtime,'install',offline):exec(compile(body,'emitted-install','exec'),{})
     finally:os.chdir(cwd)
     before=config.read_bytes()
     with self.assertRaisesRegex(ValueError,'failed'):original(root,env,download=lambda *a:(_ for _ in ()).throw(ValueError('failed')),machine='x86_64')
     self.assertEqual(before,config.read_bytes())
     original(root,env,download=download,machine='x86_64');self.assertEqual(before,config.read_bytes())
    for _ in range(2):
     with mock.patch.object(runtime.shutil,'which',return_value='/mock/dotnet'):
      args,child,identity=runtime.plan(root,env,run=lambda *a,**kw:subprocess.CompletedProcess(a,0,'Microsoft.NETCore.App 8.0.1 [/mock]\n',''),machine='x86_64')
     self.assertIn('serverconfig.txt',args);self.assertIn('/home/container/saves',args)
    text=config.read_text();self.assertIn('worldname=chosen',text);self.assertIn('password=keep',text);self.assertIn('maxplayers=12',text);self.assertIn('port=28000',text);self.assertEqual(0o640,config.stat().st_mode&0o777)
    # Actual __main__ start entrypoint with both process boundaries mocked.
    cwd=Path.cwd();os.chdir(root)
    try:
     with mock.patch.dict(os.environ,env,clear=True),mock.patch('shutil.which',return_value='/mock/dotnet'),mock.patch('subprocess.run',return_value=subprocess.CompletedProcess([],0,'Microsoft.NETCore.App 8.0.1 [/mock]\n','')),mock.patch('os.execve') as execute:
      runpy.run_path(str(helpers/'tmodloader_runtime.py'),run_name='__main__')
     execute.assert_called_once()
    finally:os.chdir(cwd)
if __name__=='__main__':unittest.main()
