import importlib.util
from pathlib import Path
import os,sys,tempfile,unittest,socket,subprocess
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('fixtures',Path(__file__).with_name('test-open-world-servers.py'));f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
g=f.game
ENV={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012,28013'}
class JC3Tests(unittest.TestCase):
 def test_boot_operator_values_and_raw_bytes(self):
  previous=Path.cwd()
  try:
   with tempfile.TemporaryDirectory() as d,patch.object(g,'update',return_value={'mock':True}),patch.object(g.os,'execvpe') as execute:
    root=Path(d);g.launch(root,'jc3',ENV)
    p=root/'config.json';p.write_bytes(b'{ "name":"operator", "password":"private", "maxPlayers":19,"maxTickRate":27,"announce":false,"packages":["custom"],"unknown":9007199254740993 }\r\n')
    g.launch(root,'jc3',ENV);first=p.read_bytes();g.launch(root,'jc3',ENV);self.assertEqual(p.read_bytes(),first)
    self.assertIn(b'"password":"private"',first);self.assertIn(b'"unknown":9007199254740993',first);self.assertIn(b'"packages":["custom"]',first)
    self.assertEqual(execute.call_args.args[1],[str(root/'Server')])
  finally:os.chdir(previous)
 def test_refusal_before_write_or_acquisition(self):
  for extra,body in [({'MAX_PLAYER':'bad'},b'{}'),({},b'{"maxPlayers":true}'),({},b'{"Name":"alias"}'),({},b'{"requiredDLC":[true]}'),({},b'{"a":1,"a":2}'),({'AUTO_UPDATE':'bad'},b'{}')]:
   with tempfile.TemporaryDirectory() as d,patch.object(g,'update') as update:
    root=Path(d);p=root/'config.json';p.write_bytes(body)
    with self.assertRaises(ValueError):g.launch(root,'jc3',dict(ENV,**extra))
    self.assertEqual(p.read_bytes(),body);self.assertEqual(sorted(x.name for x in root.iterdir()),['config.json']);update.assert_not_called()
 def test_emitted_entrypoints(self):
  import json,re,runpy
  profiles=json.loads((Path(__file__).resolve().parents[2]/'.local/open-world-servers/profiles.json').read_text())
  previous=Path.cwd()
  try:
   for recipe,profile in profiles.items():
    with tempfile.TemporaryDirectory() as d:
     root=Path(d);scripts=root/'.voltra';scripts.mkdir()
     for name,body in re.findall(r"cat > \.voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE\n",profile['egg']['scripts']['installation']['script'],re.S):
      (scripts/name).write_text(body)
     self.assertEqual((scripts/'open_world_servers.py').read_bytes(),(f.BASE/'open-world-servers.py').read_bytes())
     old={k:sys.modules.pop(k,None) for k in ('steam_template','additional_survival_install')}
     sys.path.insert(0,str(scripts));os.chdir(root)
     try:
      module=runpy.run_path(str(scripts/'open_world_servers.py'))
      if recipe.startswith('just_cause/'):
       with patch.dict(os.environ,dict(ENV,AUTO_UPDATE='0'),clear=True),patch.object(sys,'argv',['helper','run','jc3']),patch.object(os,'execvpe') as execute:
        with self.assertRaises(SystemExit):runpy.run_path(str(scripts/'open_world_servers.py'),run_name='__main__')
        self.assertEqual(execute.call_args.args[1],[str(root/'Server')])
     finally:
      sys.path.pop(0)
      for k,v in old.items():
       sys.modules.pop(k,None)
       if v is not None:sys.modules[k]=v
      os.chdir(previous)
  finally:os.chdir(previous)
 def test_update_retention(self):
  for fail in (False,True):
   with tempfile.TemporaryDirectory() as d:
    root=Path(d);p=root/'config.json';p.write_bytes(b'{ "password":"operator", "packages":["mod"] }');before=p.read_bytes();q=root/'packages/mod';q.parent.mkdir();q.write_bytes(b'operator')
    def updater(*a,**kw):
     p.write_bytes(b'{}');q.write_bytes(b'publisher')
     if fail:raise RuntimeError('mock failure')
     return {}
    with patch.object(g,'update',side_effect=updater):
     if fail:
      with self.assertRaises(RuntimeError):g.install(root,'jc3',ENV)
     else:g.install(root,'jc3',ENV)
    self.assertEqual(p.read_bytes(),before);self.assertEqual(q.read_bytes(),b'operator')
if __name__=='__main__':
 with patch.object(socket,'socket',side_effect=AssertionError('network forbidden')),patch.object(subprocess,'Popen',side_effect=AssertionError('process forbidden')):
  suite=unittest.defaultTestLoader.loadTestsFromTestCase(JC3Tests)
  for name in ['test_successful_update_preserves_operator_packages_and_metadata','test_failed_update_preserves_operator_packages_and_metadata','test_onset_offsets_literal_json_and_unknown_controls','test_onset_missing_or_shifted_ports_reject','test_lac_native_text_and_editor_data_are_confined','test_lac_version_pin_and_no_legacy_substitution','test_native_exec_preserves_noinput_sigint_and_password_out_of_argv','test_jc3_native_exec_isolates_private_python_openssl','test_jc3_all_original_config_controls_and_distinct_roles','test_first_jc3_install_retains_generated_configuration_api']:
   suite.addTest(f.OpenWorldTests(name))
  result=unittest.TextTestRunner(verbosity=2).run(suite);sys.exit(not result.wasSuccessful())
