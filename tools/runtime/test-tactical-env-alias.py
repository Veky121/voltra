"""Offline POSIX case-sensitive environment fixtures. No game/Steam execution."""
import contextlib,io,json,os,signal,sys,tempfile,types,unittest
from pathlib import Path
from unittest import mock
for name,source in SOURCES:
 module=types.ModuleType(name);exec(source,module.__dict__);sys.modules[name]=module
runtime=sys.modules['tactical_runtime'];installer=sys.modules['tactical_install'];steam=sys.modules['steam_template']

class TacticalEnvironmentAliases(unittest.TestCase):
 def fixture(self,root,kind):
  app,game,exe=installer.GAMES[kind];binary=root/exe;binary.parent.mkdir(parents=True);binary.write_bytes(b'harmless fixture; never executed')
  cfg=root/game/'ServerConfig/Server.cfg';cfg.parent.mkdir();cfg.write_bytes(b'// operator\r\nUnmanaged=keep\r\n');cfg.chmod(0o640)
  env={'VOLTRA_TACTICAL':kind,'SRCDS_APPID':str(app),'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012,28013,28014,28015','AUTO_UPDATE':'0','RCON_PASSWORD':'fixture-private-rcon'}
  fields={key:('Literal fixture name' if key in ['servername','hostname'] else '51' if key=='maxplayers' else '7' if key=='reservedslots' else 'false') for key in runtime.ORIGINAL_CASE_FIELDS[kind]}
  expected={'ServerName':'"Literal fixture name"' if kind=='squad' else 'Literal fixture name','MaxPlayers':'51','NumReservedSlots':'7','AllowTeamChanges':'false','ShouldAdvertise':'false','PreventTeamChangeIfUnbalanced':'false','EnforceTeamBalance':'false','RecordDemos':'false'}
  return env,fields,cfg,expected
 def snapshot(self,root):
  return {str(p.relative_to(root)):(p.read_bytes(),p.stat().st_mode&0o777,p.stat().st_uid,p.stat().st_gid) for p in root.rglob('*') if p.is_file()}
 def test_scope_exact_original_sixteen_controls(self):
  canonical=json.loads(Path('internal/panel/game_library/overrides.json').read_text())
  for kind,key in [('squad','squad/egg-squad.json'),('postscriptum','post_scriptum/egg-post-scriptum.json')]:
   original={v['env_variable'] for v in canonical[key]['egg']['variables'] if any(c.islower() for c in v['env_variable'])}
   self.assertEqual(set(runtime.ORIGINAL_CASE_FIELDS[kind]),original);self.assertEqual(len(original),8)
 def test_all_uppercase_posix_environ_controls_match_original_and_identical_duals(self):
  for kind in runtime.ORIGINAL_CASE_FIELDS:
   with tempfile.TemporaryDirectory() as folder:
    root=Path(folder);base,fields,cfg,expected=self.fixture(root,kind)
    original={**base,**fields};argv,child,secrets,ready=runtime.configure(root,original);contents=cfg.read_bytes();identity=(cfg.stat().st_mode&0o777,cfg.stat().st_uid,cfg.stat().st_gid)
    for key,value in expected.items():self.assertIn((key+'='+value+'\r\n').encode(),contents)
    self.assertIn(b'Unmanaged=keep\r\n',contents)
    upper={**base,**{k.upper():v for k,v in fields.items()}};before=dict(upper)
    with mock.patch.dict(os.environ,upper,clear=True):
     for key in fields:self.assertNotIn(key,os.environ)
     actual=runtime.configure(root,dict(os.environ))
    self.assertEqual(actual[0],argv);self.assertEqual(actual[2:],(secrets,ready));self.assertEqual(upper,before);self.assertEqual(cfg.read_bytes(),contents)
    self.assertEqual((cfg.stat().st_mode&0o777,cfg.stat().st_uid,cfg.stat().st_gid),identity)
    dual={**upper,**fields};self.assertEqual(runtime.configure(root,dual)[0],argv);self.assertEqual(cfg.read_bytes(),contents)
 def test_each_conflicting_alias_denied_before_publisher_config_or_launch(self):
  for kind in runtime.ORIGINAL_CASE_FIELDS:
   with tempfile.TemporaryDirectory() as folder:
    root=Path(folder);base,fields,cfg,_=self.fixture(root,kind)
    for key in fields:
     env={**base,**fields,key.upper():'fixture-sensitive-conflict', 'AUTO_UPDATE':'1'};before=dict(env);snapshot=self.snapshot(root)
     for call in [runtime.configure,runtime.main]:
      with self.subTest(kind=kind,key=key,call=call.__name__),mock.patch.object(runtime,'install') as update,mock.patch.object(runtime,'flat_config') as write,mock.patch.object(runtime,'run') as native,self.assertRaisesRegex(ValueError,'Conflicting original and uppercase variable') as error:
       call(root,env)
      update.assert_not_called();write.assert_not_called();native.assert_not_called();self.assertNotIn('fixture-sensitive-conflict',str(error.exception));self.assertNotIn(base['RCON_PASSWORD'],str(error.exception));self.assertEqual(env,before);self.assertEqual(self.snapshot(root),snapshot)
 def test_each_invalid_uppercase_control_keeps_existing_config(self):
  for kind in runtime.ORIGINAL_CASE_FIELDS:
   with tempfile.TemporaryDirectory() as folder:
    root=Path(folder);base,fields,cfg,_=self.fixture(root,kind)
    for key in fields:
     invalid='bad\nname' if key in ['servername','hostname'] else '0' if key=='maxplayers' else '99' if key=='reservedslots' else 'yes'
     env={**base,**{k.upper():v for k,v in fields.items()},key.upper():invalid};snapshot=self.snapshot(root)
     with self.subTest(kind=kind,key=key),self.assertRaises(ValueError):runtime.configure(root,env)
     self.assertEqual(self.snapshot(root),snapshot)
 def test_auto_update_receives_normalized_values_without_mutating_input(self):
  for kind in runtime.ORIGINAL_CASE_FIELDS:
   with tempfile.TemporaryDirectory() as folder:
    root=Path(folder);base,fields,cfg,_=self.fixture(root,kind);env={**base,**{k.upper():v for k,v in fields.items()},'AUTO_UPDATE':'1'};before=dict(env)
    with mock.patch.object(runtime,'install') as update,mock.patch.object(runtime,'run',return_value=42) as native:
     self.assertEqual(runtime.main(root,env),42)
    for key,value in fields.items():self.assertEqual(update.call_args.args[1][key],value)
    self.assertEqual(env,before);self.assertEqual(native.call_args.kwargs['stop_signal'],signal.SIGINT);self.assertTrue(native.call_args.kwargs['terminal_input'])
 def test_secret_credentials_redaction_unchanged(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);base,fields,cfg,_=self.fixture(root,'postscriptum');env={**base,**{k.upper():v for k,v in fields.items()},'STEAM_PASS':'fixture-private-steam'}
   with mock.patch.object(runtime,'run',return_value=250) as native:self.assertEqual(runtime.main(root,env),250)
   secrets=native.call_args.kwargs['credentials'];self.assertIn(base['RCON_PASSWORD'],secrets);self.assertIn(env['STEAM_PASS'],secrets)
   redactor=steam.Redactor(secrets);output=b''
   for value in secrets:
    if value:
     encoded=value.encode();output+=redactor.feed(encoded[:3])+redactor.feed(encoded[3:]+b'\n')
   output+=redactor.feed(b'',final=True)
   for value in secrets:
    if value:self.assertNotIn(value.encode(),output)
 def test_other_games_and_unrelated_fields_are_not_normalized(self):
  env={'VOLTRA_TACTICAL':'sandstorm','servername':'a','SERVERNAME':'b','maxplayers':'x','MAXPLAYERS':'y','OTHER_Mixed':'kept'}
  self.assertEqual(runtime.environment_aliases(env),env);self.assertIsNot(runtime.environment_aliases(env),env)
  for kind in runtime.ORIGINAL_CASE_FIELDS:
   env={'VOLTRA_TACTICAL':kind,'OTHER_Mixed':'kept','OTHER_MIXED':'different'};self.assertEqual(runtime.environment_aliases(env),env)

unittest.main()
