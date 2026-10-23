import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import types
import signal
import sys
import threading

spec=importlib.util.spec_from_file_location('soldat',Path('internal/panel/game_library/scripts/soldat-native.py'))
soldat=importlib.util.module_from_spec(spec);spec.loader.exec_module(soldat)

class Soldat(unittest.TestCase):
 def env(self,game):
  return {'SERVER_PORT':'28040','VOLTRA_ALLOCATED_PORTS':'28040,28050' if game=='soldat' else '28040,28041,28042','SRV_NAME':'Name " $ +','SERVER_NAME':'Name " $ +','ADMIN_PASSWD':'offlinefixture','SRV_PWD':'','RCON_PASSWORD':'offlinefixture','WEBSOCKETS_PORT':'28041','RCON_PORT':'28042','MAX_PLAYERS':'8'}
 def test_soldat_original_controls_and_comments(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);p=root/'soldat.ini';p.write_text('; keep\n[NETWORK]\nPort=23073\nUnknown=retain\n[GAME]\nGameStyle=3\n')
   argv,secret=soldat.configure(root,'soldat',self.env('soldat'));content=p.read_text()
   for expected in ('Port= 28040','Max_Players = 8','Game_Password = ','Admin_Password = offlinefixture','Server_Name = Name " $ +','Unknown=retain','GameStyle=3'):self.assertIn(expected,content)
   self.assertEqual(argv,[str(root/'soldatserver')]);self.assertEqual(secret,'offlinefixture');self.assertTrue(content.startswith('; keep'))
 def test_sparse_port_is_mandatory(self):
  with tempfile.TemporaryDirectory() as temp:
   env=self.env('soldat');env['VOLTRA_ALLOCATED_PORTS']='28040,28041'
   with self.assertRaises(ValueError):soldat.configure(Path(temp),'soldat',env)
   self.assertFalse((Path(temp)/'soldat.ini').exists())
 def test_native_lobby_key_and_low_allocated_ports_preserve_port_contract(self):
  with tempfile.TemporaryDirectory() as temp:
   env=self.env('soldat');env.update(SERVER_PORT='1',VOLTRA_ALLOCATED_PORTS='1,11',PUBLIC_SERVER='0')
   soldat.configure(Path(temp),'soldat',env);content=(Path(temp)/'soldat.ini').read_text()
   self.assertIn('Lobby_Register = 0',content);self.assertNotIn('Register_Lobby',content);self.assertIn('Port = 1',content)
 def test_soldat2_all_original_controls_literal_and_secret_not_argv(self):
  with tempfile.TemporaryDirectory() as temp:
   env=self.env('soldat2');env.update(GREET_MESSAGE='Hello = custom',ADMIN_PLAYFAB_ID='ABC123',SERVER_PASSWORD='offlinejoin')
   root=Path(temp);argv,secret=soldat.configure(root,'soldat2',env);content=(root/'autoconfig.ini').read_text()
   for expected in ('Name=Name " $ +','WebSocketsPort=28041','WebSocketsRconPort=28042','MaxPlayers=8'):self.assertIn(expected,argv)
   self.assertNotIn('offlinejoin',' '.join(argv));self.assertNotIn('offlinefixture',' '.join(argv))
   for expected in ('ServerPassword = offlinejoin','RconPassword = offlinefixture','GreetMessage = Hello = custom','AdminPlayfabId = ABC123'):self.assertIn(expected,content)
   self.assertIn('[ConfigUpdater]\nVersion = 36',content)
 def test_disabled_websockets_need_no_extra_allocations(self):
  with tempfile.TemporaryDirectory() as temp:
   env=self.env('soldat2');env.update(VOLTRA_ALLOCATED_PORTS='28040',WEBSOCKETS_PORT='0',RCON_PORT='0')
   argv,_=soldat.configure(Path(temp),'soldat2',env);self.assertIn('WebSocketsPort=0',argv);self.assertIn('WebSocketsRconPort=0',argv)
 def test_dynamic_ports_reject_collision_and_unallocated_values(self):
  for overrides in ({'RCON_PORT':'28041'},{'WEBSOCKETS_PORT':'28040'},{'RCON_PORT':'28049'},{'RCON_PORT':'-1'}):
   with tempfile.TemporaryDirectory() as temp:
    env=self.env('soldat2');env.update(overrides)
    with self.assertRaises(ValueError):soldat.configure(Path(temp),'soldat2',env)
 def test_generated_private_credential_persists(self):
  with tempfile.TemporaryDirectory() as temp:
   env=self.env('soldat');env['ADMIN_PASSWD']='';root=Path(temp)
   first=soldat.configure(root,'soldat',env)[1];second=soldat.configure(root,'soldat',env)[1]
   self.assertEqual(first,second);self.assertEqual(len(first),20);self.assertEqual((root/'.voltra/soldat/admin-password').stat().st_mode&0o777,0o600)
 def test_injection_and_symlink_escape(self):
  with tempfile.TemporaryDirectory() as temp,tempfile.TemporaryDirectory() as outside:
   root=Path(temp);p=Path(outside)/'soldat.ini';p.write_text('keep');(root/'soldat.ini').symlink_to(p)
   with self.assertRaises(ValueError):soldat.configure(root,'soldat',self.env('soldat'))
   self.assertEqual(p.read_text(),'keep')
  with tempfile.TemporaryDirectory() as temp:
   env=self.env('soldat2');env['SERVER_NAME']='name\nPort=1'
   with self.assertRaises(ValueError):soldat.configure(Path(temp),'soldat2',env)
 def test_steam_validation_restores_operator_files_even_on_failure(self):
  for fails in (False,True):
   with tempfile.TemporaryDirectory() as temp:
    root=Path(temp);(root/'maps').mkdir();p=root/'maps/custom.pms';p.write_bytes(b'operator map');p.chmod(0o640)
    (root/'soldat.ini').write_text('operator config');(root/'soldatserver').write_bytes(b'oldbinary')
    soldat.helper('steam-template');restore=soldat.helper('source-install').restore_file
    def update(*args,**kwargs):
     p.write_bytes(b'publisher map');p.chmod(0o600);(root/'soldat.ini').write_text('publisher config')
     if fails:raise RuntimeError('Steam failed fixture')
     return {'buildid':123}
    original=soldat.helper
    with patch.object(soldat,'helper',side_effect=lambda name:types.SimpleNamespace(update=update) if name=='steam-template' else types.SimpleNamespace(restore_file=restore) if name=='source-install' else original(name)):
     if fails:
      with self.assertRaises(RuntimeError):soldat.install_soldat(root,{'SRCDS_APPID':'638500'})
     else:self.assertEqual(soldat.install_soldat(root,{'SRCDS_APPID':'638500'})['buildid'],123)
    self.assertEqual(p.read_bytes(),b'operator map');self.assertEqual(p.stat().st_mode&0o777,0o640);self.assertEqual((root/'soldat.ini').read_text(),'operator config')
 def test_lifecycle_native_ack_exits_zero_without_signal_normalization(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)
   code="import pathlib,time; p=pathlib.Path('.voltra/soldat2'); print('VOLTRA_LIFECYCLE_READY',flush=True)\nwhile not (p/'stop-request').read_text().startswith('stop:'):time.sleep(.01)\ntoken=(p/'launch-token').read_text().strip(); assert (p/'stop-request').read_text().strip()=='stop:'+token; print('VOLTRA_NATIVE_QUIT_REQUEST '+token,flush=True)"
   timer=threading.Timer(.3,lambda:os.kill(os.getpid(),signal.SIGTERM));timer.start()
   try:result=soldat.run_soldat2(root,[sys.executable,'-c',code],stop_timeout=1)
   finally:timer.cancel()
   data=json.loads((root/'.voltra/soldat2/lifecycle-last.json').read_text());self.assertEqual(result,0);self.assertEqual(data['native_return_code'],0);self.assertTrue(data['acknowledged']);self.assertFalse(data['stop_timed_out']);self.assertIsNone(data['fallback_signal'])
 def test_lifecycle_missing_native_hook_is_reported_as_real_failure(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);timer=threading.Timer(.2,lambda:os.kill(os.getpid(),signal.SIGTERM));timer.start()
   try:result=soldat.run_soldat2(root,[sys.executable,'-c','import time; time.sleep(20)'],stop_timeout=.2)
   finally:timer.cancel()
   data=json.loads((root/'.voltra/soldat2/lifecycle-last.json').read_text());self.assertEqual(result,143);self.assertEqual(data['native_return_code'],-15);self.assertTrue(data['stop_timed_out']);self.assertFalse(data['acknowledged']);self.assertEqual(data['fallback_signal'],'SIGTERM')
 def test_lifecycle_stale_nonce_does_not_acknowledge_current_launch(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);state=root/'.voltra/soldat2';state.mkdir(parents=True);(state/'launch-token').write_text('old-token');(state/'stop-request').write_text('stop:old-token');(state/'stop-ack').write_text('old-token')
   code="import pathlib; p=pathlib.Path('.voltra/soldat2'); assert (p/'stop-request').read_text()==''; assert (p/'launch-token').read_text().strip()!='old-token'; print('VOLTRA_NATIVE_QUIT_REQUEST old-token',flush=True)"
   self.assertEqual(soldat.run_soldat2(root,[sys.executable,'-c',code]),0)
   data=json.loads((state/'lifecycle-last.json').read_text());self.assertFalse(data['acknowledged']);self.assertFalse(data['stop_requested']);self.assertEqual(state.stat().st_mode&0o777,0o700)
 def test_lifecycle_refuses_symlinked_request_outside_private_state(self):
  with tempfile.TemporaryDirectory() as temp,tempfile.TemporaryDirectory() as outside:
   root=Path(temp);state=root/'.voltra/soldat2';state.mkdir(parents=True);target=Path(outside)/'operator.txt';target.write_text('untouched');(state/'stop-request').symlink_to(target)
   with self.assertRaises(ValueError):soldat.run_soldat2(root,[sys.executable,'-c','raise Exception("must not launch")'])
   self.assertEqual(target.read_text(),'untouched')

unittest.main()
