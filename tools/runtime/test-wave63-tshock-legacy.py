import hashlib, importlib.util, json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import Mock, patch
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave63-tshock-legacy'
spec=importlib.util.spec_from_file_location('terraria_release_install',OUT/'terraria_release_install.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ENV={'VOLTRA_TERRARIA_KIND':'legacy','TSHOCK_VERSION':'v4.5.18','WORLD_NAME':'Chosen','WORLD_SIZE':'2','WORLD_DIFFICULTY':'1','MAX_PLAYERS':'11'}
class Legacy(unittest.TestCase):
 def test_early_refusal(self):
  for mode in ('saves','config','link','players','version','arch','world','checksum'):
   with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);env=dict(ENV);machine='x86_64'
    if mode=='saves':(root/'saves').write_text('keep')
    if mode=='config':(root/'serverconfig.txt').mkdir()
    if mode=='link':(root/'tshock').symlink_to(root/'absent')
    if mode=='players':env['MAX_PLAYERS']='256'
    if mode=='version':env['TSHOCK_VERSION']='6.2.1'
    if mode=='arch':machine='aarch64'
    if mode=='world':env['WORLD_NAME']='../escape'
    if mode=='checksum':env['RELEASE_SHA256']='0'*64
    before=sorted(str(p.relative_to(root)) for p in root.rglob('*'))
    metadata=Mock(side_effect=AssertionError('metadata'));download=Mock(side_effect=AssertionError('download'))
    with self.assertRaises(ValueError):m.install(root,env,metadata,download,machine)
    metadata.assert_not_called();download.assert_not_called();self.assertEqual(before,sorted(str(p.relative_to(root)) for p in root.rglob('*')))
 def test_seed_once_preserves_native_bytes(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);m.legacy_preflight(root,ENV,'x86_64');m.initialize(root,'legacy',ENV)
   text=(root/'serverconfig.txt').read_text();self.assertIn('worldname=Chosen\n',text);self.assertIn('maxplayers=11\n',text)
   (root/'tshock/tshock.sqlite').write_bytes(b'opaque account database')
   before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
   m.initialize(root,'legacy',{**ENV,'WORLD_NAME':'Changed','SERVER_PASSWORD':'replacement'})
   self.assertEqual(before,{str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()})
 def test_mocked_installer_publication(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);content=root/'fixture';content.mkdir();(content/'TerrariaServer.exe').write_bytes(b'MZfixture')
   download=Mock(return_value='fixture-sha')
   with patch.object(m,'unpack'),patch.object(m,'payload',return_value=content):m.install(root,ENV,Mock(side_effect=AssertionError('metadata')),download,'x86_64')
   self.assertEqual((root/'TerrariaServer.exe').read_bytes(),b'MZfixture');self.assertFalse(json.loads((root/'.voltra/terraria-release/release.json').read_text())['native_runtime_verified'])
 def test_profile_and_start(self):
  egg=json.loads((OUT/'profiles.unapplied.json').read_text())['terraria/tshock/egg-tshock-legacy.json']['egg']
  mappings=json.loads(egg['config']['files']);self.assertEqual(mappings['serverconfig.txt']['find'],{'port':'{{server.build.default.port}}'})
  self.assertEqual(mappings['tshock/config.json']['find'],{'Settings.ServerPort':'{{server.build.default.port}}'})
  start=egg['startup'].replace('{{SERVER_PORT}}','29150'); calls=[]
  # Shell parses the exact startup; executable boundary is a shell function fixture.
  command='mono() { printf "%s\\n" "$@"; }; '+start.replace('exec mono','mono',1)
  result=subprocess.run(['/bin/sh','-c',command],capture_output=True,text=True,check=True)
  self.assertEqual(result.stdout.splitlines(),['TerrariaServer.exe','-config','serverconfig.txt','-configpath','/home/container/tshock','-logpath','/home/container/logs','-worldselectpath','/home/container/saves/Worlds','-ip','0.0.0.0','-port','29150','-noupnp'])
 def test_nonlegacy_bytes(self):
  import ast
  old=ast.parse((OUT/'helper-before.py').read_text());new=ast.parse((OUT/'terraria_release_install.py').read_text())
  for node in old.body:
   if isinstance(node,(ast.FunctionDef,ast.ClassDef)) and node.name not in ('install','initialize'):
    other=next(n for n in new.body if getattr(n,'name',None)==node.name);self.assertEqual(ast.dump(node),ast.dump(other),node.name)
if __name__=='__main__':unittest.main(verbosity=2)
