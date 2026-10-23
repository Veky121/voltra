import importlib.util
import sys
from pathlib import Path
import tempfile
import os
import unittest
from unittest.mock import patch

scripts=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,scripts/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
load('steam_template','steam-template.py');load('native_console','native-console.py');query=load('quake_ss14_query','quake-ss14-query.py');runtime=load('qss_runtime','quake-ss14-runtime.py')
load('native_release','native-release.py');load('native_zip_release','native-zip-release.py');source=load('source_install','source-install.py');installer=load('qss_install','quake-ss14-install.py')

class NativeTests(unittest.TestCase):
 def test_ss14_original_controls_native_literal(self):
  with tempfile.TemporaryDirectory() as d:
   _,argv,port=runtime.configure(Path(d),{'SERVER_PORT':'28010','SERVER_NAME':'literal " ; $safe','SERVER_TICK':'30','SERVER_MAX_PLAYERS':'8'},'ss14')
   for value in ['game.hostname=literal " ; $safe','net.tickrate=30','net.max_connections=8','status.bind=*:28010','game.soft_max_players=8']:self.assertIn(value,argv)
   self.assertEqual(port,28010)
   _,unicode_args,_=runtime.configure(Path(d),{'SERVER_NAME':'Ž'*48},'ss14');self.assertIn('game.hostname='+'Ž'*48,unicode_args)
 def test_ss14_limits(self):
  with tempfile.TemporaryDirectory() as d:
   for key,value in [('SERVER_TICK','81'),('SERVER_MAX_PLAYERS','257'),('SERVER_PORT','0')]:
    with self.assertRaises(ValueError):runtime.configure(Path(d),{key:value},'ss14')
 def test_ss14_native_stop_includes_required_reason_and_owned_home(self):
  with tempfile.TemporaryDirectory() as d,patch.object(runtime.Path,'cwd',return_value=Path(d)),patch.dict(os.environ,{},clear=True),patch.object(runtime,'run',return_value=0) as run,patch.object(runtime.threading,'Thread'):
   self.assertEqual(runtime.main('ss14'),0);self.assertEqual(run.call_args.args[3],'shutdown VoltraStop');self.assertEqual(run.call_args.args[2]['HOME'],d)
 def test_quake_original_controls_and_native_home(self):
  with tempfile.TemporaryDirectory() as d:
   _,argv,_=runtime.configure(Path(d),{'SERVER_NAME':'literal $safe','PASSWORD':'fixture','SERVER_TYPE':'1','FPS':'40'},'quakelive')
   text=(Path(d)/'quake-live-user/baseq3/voltra-managed.cfg').read_text()
   for value in ['set sv_hostname "literal $safe"','set g_password "fixture"','set sv_fps "40"','set sv_serverType "1"']:self.assertIn(value,text)
   self.assertIn(str(Path(d)/'quake-live-user'),argv)
   with self.assertRaises(ValueError):runtime.configure(Path(d),{'FPS':'80'},'quakelive')
 def test_quake_native_delimiters_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   for value in ['bad"command','bad\\command','bad;command','bad\ncommand']:
    with self.assertRaises(ValueError):runtime.configure(Path(d),{'SERVER_NAME':value},'quakelive')
 def test_quake_footer_preserves_operator_bytes_and_mode_idempotently(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);target=root/'baseq3/server.cfg';target.parent.mkdir();original=b'// custom\r\nexec operator.cfg\r\n';target.write_bytes(original);target.chmod(0o640)
   runtime.configure(root,{},'quakelive');first=target.read_bytes();runtime.configure(root,{},'quakelive')
   self.assertEqual(target.read_bytes(),first);self.assertTrue(first.startswith(original));self.assertTrue(first.endswith(runtime.QL_FOOTER));self.assertEqual(target.stat().st_mode&0o777,0o640)
 def test_rcon_only_owned_additional_port(self):
  with tempfile.TemporaryDirectory() as d:
   env={'SERVER_PORT':'28010','RCON_ENABLE':'1','RCON_PASSWORD':'fixture','VOLTRA_ALLOCATED_PORTS':'28010,28011'}
   runtime.configure(Path(d),env,'quakelive');self.assertIn('set zmq_rcon_port "28011"',(Path(d)/'quake-live-user/baseq3/voltra-managed.cfg').read_text())
   with self.assertRaises(ValueError):runtime.configure(Path(d),{**env,'RCON_PORT':'28012'},'quakelive')
 def test_quake_native_a2s_fields_and_truncation(self):
  data=b'\xff\xff\xff\xffI\x11Fixture\0campgrounds\0baseq3\0Quake Live\0'+bytes([0,0,1,8,0,100,108,1,0])+b'1069\0'
  result=query.parse_quake(data);self.assertEqual(result['players'],1);self.assertTrue(result['password']);self.assertEqual(result['map'],'campgrounds')
  with self.assertRaises(ValueError):query.parse_quake(data[:20])
  with self.assertRaises(ValueError):query.parse_quake(data[:5])
 def test_ss14_status_bounds_and_schema(self):
  self.assertEqual(query.parse_ss14(b'{"name":"Fixture","players":0}')['players'],0)
  for value in [b'[]',b'{"name":"Fixture","players":true}',b'{"name":"Fixture","players":-1}',b'x'*65537]:
   with self.assertRaises(ValueError):query.parse_ss14(value)
 def test_public_steam_adapter_and_preservation_mapping(self):
  self.assertEqual(source.GAME_DIRECTORIES[349090],'baseq3')
  with tempfile.TemporaryDirectory() as d,patch.object(source,'update') as update:
   installer.install(Path(d),'quakelive');self.assertEqual(update.call_args.args[1],349090);self.assertEqual(update.call_args.kwargs['required'],('qzeroded.x64',))
 def test_pinned_ss14_and_supported_runtime(self):
  self.assertEqual(installer.SS14['bytes'],43600064);self.assertEqual(installer.DOTNET['version'],'10.0.13')
  for release in [installer.SS14,installer.DOTNET]:self.assertRegex(release['sha256'],'^[0-9a-f]{64}$');self.assertTrue(release['url'].startswith('https://'))
 def test_original_arm64_acquisition_has_distinct_pins(self):
  runtime,game=installer.releases('aarch64');self.assertIn('linux-arm64',runtime['url']);self.assertIn('linux-arm64',game['url']);self.assertNotEqual(runtime['sha256'],installer.DOTNET['sha256']);self.assertEqual(game['bytes'],43317903)
  with self.assertRaises(ValueError):installer.releases('riscv64')

if __name__=='__main__':unittest.main(verbosity=2)
