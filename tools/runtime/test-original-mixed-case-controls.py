"""Offline original-control fixtures. Never acquire or launch game payloads."""
import importlib.util
import json
import configparser
from pathlib import Path
import os
import stat
import sys
import tempfile
import unittest
BASE=Path('internal/panel/game_library/scripts').resolve()
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,BASE/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
load('steam_template','steam-template.py');load('additional_survival_install','additional-survival-install.py')
automation=load('parity_automation','automation-sims.py');fantasy=load('parity_fantasy','fantasy-survival-servers.py');frontier=load('parity_frontier','frontier-native.py')
def put(root,name,data):
 p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(data);p.chmod(0o640);return p
def snapshot(root):
 return {str(p.relative_to(root)):(p.read_bytes(),stat.S_IMODE(p.stat().st_mode),p.stat().st_uid,p.stat().st_gid,p.stat().st_mtime_ns)for p in root.rglob('*')if p.is_file()}
class OriginalCaseControls(unittest.TestCase):
 def fixture(self,root,game):
  if game=='fortress':
   put(root,'Default/firstrun.ini','[config]\nRushMode=false\nOperatorUnknown=keep\n');put(root,'Default/serveroverrides.ini','[config]\nOperatorOverride=keep\n')
  elif game=='nightingale':put(root,'NWX/Config/ExampleServerSettings.ini','; publisher fixture\n[PublisherOwnedSettings]\nPassword=old\nUnknownNative=preserve\n')
  else:put(root,'WS/Saved/GameplaySettings/GameXishu.json','{"0":{"OperatorUnknown":42}}')
  return {'SERVER_PORT':'28000','QUERY_PORT':'28001','RCON_PORT':'28001','ECHO_PORT':'28002','CLUSTER_MAIN_PORT':'28003','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,28003'}
 def configure(self,root,game,env):
  value={'fortress':automation.configure,'nightingale':fantasy.configure,'soulmask':frontier.configure}[game](root,game,env)
  return value if value is not None else ([],[])
 def assert_effect(self,root,game,argv):
  if game=='fortress':
   parser=configparser.ConfigParser();parser.read(root/'Default/firstrun.ini');self.assertTrue(parser.getboolean('config','RushMode'));self.assertEqual(parser.get('config','OperatorUnknown'),'keep')
  elif game=='nightingale':self.assertIn('StartingDifficulty = extreme',(root/'NWX/Config/ServerSettings.ini').read_text());self.assertIn('UnknownNative=preserve',(root/'NWX/Config/ServerSettings.ini').read_text())
  else:self.assertIn('-gamedistindex=7',argv);self.assertEqual(json.loads((root/'WS/Saved/GameplaySettings/GameXishu.json').read_text())['0']['OperatorUnknown'],42)
 def test_actual_wings_uppercase_nondefaults_drive_real_generated_config_or_argv(self):
  for game,key,value in [('fortress','G_RUSHMODE','true'),('nightingale','DIFFICULTY','extreme'),('soulmask','REGION','7')]:
   with self.subTest(game=game),tempfile.TemporaryDirectory()as tmp:
    root=Path(tmp);env={**self.fixture(root,game),key:value};original=dict(env);argv,_=self.configure(root,game,env);self.assert_effect(root,game,argv);self.assertEqual(env,original)
 def test_original_api_case_remains_usable_and_equal_dual_inputs_are_allowed(self):
  for game,original,upper,value in [('fortress','G_RushMode','G_RUSHMODE','true'),('nightingale','Difficulty','DIFFICULTY','extreme'),('soulmask','region','REGION','7')]:
   for dual in [False,True]:
    with self.subTest(game=game,dual=dual),tempfile.TemporaryDirectory()as tmp:
     root=Path(tmp);env={**self.fixture(root,game),original:value};env.update({upper:value}if dual else {});argv,_=self.configure(root,game,env);self.assert_effect(root,game,argv)
 def test_conflicting_aliases_reject_before_any_file_mutation_or_creation(self):
  for game,original,upper,first,second in [('fortress','G_RushMode','G_RUSHMODE','false','true'),('nightingale','Difficulty','DIFFICULTY','easy','extreme'),('soulmask','region','REGION','0','7')]:
   with self.subTest(game=game),tempfile.TemporaryDirectory()as tmp:
    root=Path(tmp);env={**self.fixture(root,game),original:first,upper:second};before=snapshot(root)
    with self.assertRaisesRegex(ValueError,'Conflicting original and Wings variable'):self.configure(root,game,env)
    self.assertEqual(snapshot(root),before)
 def test_aliases_are_not_applied_to_unrelated_game_branches(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);put(root,'App.cfg','# operator\n')
   automation.configure(root,'foundry',{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001','QUERY_PORT':'28001','G_RushMode':'false','G_RUSHMODE':'true'})
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);put(root,'Vein/Saved/Config/LinuxServer/Game.ini','[Operator]\nValue=keep\n')
   frontier.configure(root,'vein',{'SERVER_PORT':'28000','QUERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001','region':'0','REGION':'7'})
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);fantasy.configure(root,'moria',{'SERVER_PORT':'28000','Difficulty':'easy','DIFFICULTY':'hard'})
if __name__=='__main__':unittest.main()
