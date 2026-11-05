"""Exercise exact installer-emitted files in a fresh isolated Python subprocess."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/risk-runtime-authority'
profile=json.loads((OUT/'profile-proposal.json').read_text())['risk_of_rain_2/egg-risk-of-rain2.json']
script=profile['egg']['scripts']['installation']['script']
with tempfile.TemporaryDirectory(prefix='risk-emitted-') as folder:
    root=Path(folder)
    files={}
    for match in re.finditer(r"cat\s+>\s*(\S+)\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\2(?:\r?\n|$)",script):
        name=match[1];path=root/name
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(match[3].encode())
        files[name]=hashlib.sha256(path.read_bytes()).hexdigest()
    test=r'''
import importlib.util, pathlib, tempfile, unittest
from unittest import mock
p=pathlib.Path('.voltra/risk-of-rain-owner.py').resolve()
s=importlib.util.spec_from_file_location('candidate',p);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
env={'SERVER_PORT':'28020','VOLTRA_ALLOCATED_PORTS':'28020,28021,28022','ACCEPT_WINDOWS_RUNTIME_LICENSES':'true'}
class Tests(unittest.TestCase):
 def test_refusal_no_acquisition_or_writes(self):
  for change in ({'ACCEPT_WINDOWS_RUNTIME_LICENSES':'false'},{'PLAYERS':'bad'},{'STEAM_PASS':'private'},{'VOLTRA_ALLOCATED_PORTS':'28020'},{'WINETRICKS_RUN':'mono;bad'}):
   with tempfile.TemporaryDirectory() as d:
    root=pathlib.Path(d)
    with mock.patch.object(a.base.steam,'update',side_effect=AssertionError('acquired')) as acquire:
     with self.assertRaises(ValueError):a.install(root,'risk',{**env,**change})
     acquire.assert_not_called();self.assertEqual(list(root.iterdir()),[])
 def test_existing_bytes_and_native_secret_on_boot(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);path=root/a.CONFIG;path.parent.mkdir(parents=True)
   data=b'\xef\xbb\xbf// operator\r\nsv_port 28020; steam_server_query_port 28021; steam_server_steam_port 28022;\r\nsv_hostname "operator"; sv_password "native-secret";\r\n'
   path.write_bytes(data)
   argv,secrets,log=a.configure(root,'risk',{**env,'HOSTNAME':'stale','PASSWORD':'stale'})
   self.assertEqual(path.read_bytes(),data);self.assertIn('native-secret',secrets);self.assertEqual(argv[-2:],['+exec','server.cfg'])
   with self.assertRaises(ValueError):a.configure(root,'risk',{**env,'SERVER_PORT':'29000','VOLTRA_ALLOCATED_PORTS':'29000,29001,29002'})
   self.assertEqual(path.read_bytes(),data)
 def test_seed_then_preserve_operator_edits(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);path=root/a.CONFIG;path.parent.mkdir(parents=True);path.with_name('server_startup.cfg').write_text('exec server;\nhost;\n')
   a.configure(root,'risk',env);data=path.read_bytes().replace(b'sv_maxplayers 4',b'sv_maxplayers 7');path.write_bytes(data)
   a.configure(root,'risk',{**env,'PLAYERS':'2'});self.assertEqual(path.read_bytes(),data)
 def test_simulated_update_success_and_failure_preserve_files(self):
  import os
  for failed in (False,True):
   with tempfile.TemporaryDirectory() as d:
    root=pathlib.Path(d);paths=[root/a.CONFIG,root/'BepInEx/plugins/operator.dll',root/'profiles/operator.sav']
    for path in paths:path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'operator bytes\x00')
    # Windows cannot perform Linux uid/mode restoration. Only those OS calls are emulated.
    with mock.patch.object(os,'fchown',create=True),mock.patch.object(os,'fchmod',create=True):
     try:
      with a.base.shared.preserve(root):
       for path in paths:path.write_bytes(b'simulated updater overwrite')
       if failed:raise RuntimeError('simulated failed acquisition')
     except RuntimeError:
      self.assertTrue(failed)
    for path in paths:self.assertEqual(path.read_bytes(),b'operator bytes\x00')
 def test_script_and_native_authority_refuse_before_acquisition(self):
  for name,content in [('server_startup.cfg','exec other; host;'),('server_startup.cfg','sv_hostname "override"; exec server; host;'),('server_startup.cfg','exec server; host; host;'),('server_pregame.cfg','sv_hostname "override";'),('server.cfg','exec other;'),('server.cfg','alias foo "sv_hostname override";'),('server.cfg','sv_hostname "one"; sv_hostname "two";'),('server.cfg','SV_PORT 28020;'),('server.cfg','sv_hostname "bad\\nname";'),('server.cfg','sv_hostname "name" && host;')]:
   with tempfile.TemporaryDirectory() as d:
    root=pathlib.Path(d);path=root/a.CONFIG;path.parent.mkdir(parents=True)
    a.configure(root,'risk',env)
    path=path.with_name(name);path.write_text(content);before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
    with mock.patch.object(a.base.steam,'update') as acquire:
     with self.assertRaises(ValueError): a.install(root,'risk',env)
     acquire.assert_not_called()
    self.assertEqual(before,{str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()})
 def test_emitted_strings_and_actual_mocked_install(self):
  import os
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);path=root/a.CONFIG
   name='quoted "name"; slash\\tail // data'
   argv,secrets,_=a.configure(root,'risk',{**env,'HOSTNAME':name,'PASSWORD':'  keep "\\secret  '})
   self.assertEqual(argv,['xvfb-run','-a','wine',str(root/a.base.PINS['risk']['binary']),'+exec','server.cfg'])
   values=a.native_values(path.read_text());self.assertEqual(values['sv_hostname'],name);self.assertEqual(values['sv_password'],'  keep "\\secret  ')
   path.write_bytes(path.read_bytes().replace(b'sv_maxplayers 4',b'sv_maxplayers 8'))
   startup=path.with_name('server_startup.cfg');startup.write_text('// bootstrap\nexec server.cfg; host; remove_all_local_users;\n')
   pregame=path.with_name('server_pregame.cfg');pregame.write_text('// no overrides\n')
   extra=[root/'profiles/operator.sav',root/'BepInEx/plugins/operator.dll',path.with_name('unknown-operator.cfg')]
   for p in extra:p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'operator data')
   protected=[path,startup,pregame,*extra];before={p:p.read_bytes() for p in protected}
   for failed in (False,True):
    def update(*args,**kwargs):
     for p in protected:p.write_bytes(b'updater overwrite')
     if failed:raise RuntimeError('mock update failure')
    with mock.patch.object(a.base.steam,'update',side_effect=update),mock.patch.object(a.base,'sdk'),mock.patch.object(os,'fchown',create=True),mock.patch.object(os,'fchmod',create=True):
     if failed:
      with self.assertRaises(RuntimeError):a.install(root,'risk',env)
     else:a.install(root,'risk',env)
    self.assertEqual(before,{p:p.read_bytes() for p in protected})
    a.configure(root,'risk',{**env,'HOSTNAME':'stale','PASSWORD':'stale','PLAYERS':'2'})
    self.assertEqual(before,{p:p.read_bytes() for p in protected})
 def test_malformed_refuses_unchanged(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);path=root/a.CONFIG;path.parent.mkdir(parents=True);path.write_bytes(b'custom "unterminated')
   with self.assertRaises(ValueError):a.configure(root,'risk',env)
   self.assertEqual(path.read_bytes(),b'custom "unterminated')
unittest.main()
'''
    result=subprocess.run([sys.executable,'-I','-B','-c',test],cwd=root,capture_output=True,text=True)
    (OUT/'offline-tests.json').write_text(json.dumps({'command':[sys.executable,'-I','-B','-c','<embedded fixture>'],'emitted_files_sha256':files,'exit_code':result.returncode,'stdout':result.stdout,'stderr':result.stderr,'native_acceptance':False},indent=2)+'\n')
    print(result.stderr)
    sys.exit(result.returncode)
