"""The Front exact argv contract; no game/Steam/downloads or shell execution."""
import importlib.util,tempfile,unittest,sys,copy
from pathlib import Path
from unittest.mock import patch
BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name):
 s=importlib.util.spec_from_file_location(name.replace('-','_'),BASE/(name+'.py'));m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);return m
for n in('steam-template','native-config','native-console','enshrouded-proton','unreal-survival-install'):load(n)
r=load('unreal-survival-runtime');p=sys.modules['enshrouded_proton']
class Order(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.env={'SERVER_PORT':'28000','BEACON_PORT':'28001','QUERY_PORT':'28002','SHUTDOWN_PORT':'28003','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,28003','WINDOWS_INSTALL':'0'}
 def argv(self,password,windows=False):
  name='ProjectWar/Binaries/Win64/TheFrontServer.exe'if windows else'ProjectWar/Binaries/Linux/TheFrontServer';b=self.root/name;b.parent.mkdir(parents=True,exist_ok=True);b.write_bytes(b'fixture')
  with patch.object(p,'location',return_value=Path('/private/proton')):return r.configure(self.root,'front',{**self.env,'WINDOWS_INSTALL':'1'if windows else'0','SRV_PW':password})[0]
 def test_nonempty_exactly_once_last(self):
  a=self.argv('test secret');self.assertEqual(a[-1],'-ServerPassword=test secret');self.assertEqual(sum(x.startswith('-ServerPassword=')for x in a),1);self.assertLess(a.index('-OutIPAddress=0.0.0.0'),len(a)-1);self.assertLess(a.index('-GMOverlapRatio=2'),len(a)-1)
 def test_empty_password_remains_one_final_argument(self):
  a=self.argv('');self.assertEqual(a[-1],'-ServerPassword=""');self.assertEqual(sum(x.startswith('-ServerPassword=')for x in a),1)
 def test_literal_text_is_not_shell_or_extra_argv(self):
  secret='x";$(echo not-run) \u2603 -ServerPassword=injected -UseACE=false';a=self.argv(secret);self.assertEqual(a[-1],'-ServerPassword='+secret);self.assertEqual(sum(x.startswith('-ServerPassword=')for x in a),1);self.assertNotIn('-UseACE=false',a)
 def test_every_other_argument_value_and_order_preserved(self):
  a=self.argv('secret');info=r.metadata()['front'];e={**info['defaults'],**self.env,'SRV_PW':'secret'};expected=['-'+k+'='+('\"\"'if k in('ServerTags','ServerAdminAccounts')and e[v]==''else e[v])for k,v in info['args'].items()if k!='ServerPassword'];expected+=['-OutIPAddress=0.0.0.0','-UserDir='+str(self.root/'TheFrontManager/new')+'/'];expected+=info['fixed_args'];expected+=['-ServerPassword=secret'];self.assertEqual(a[1:7],['ProjectWar_Start?DedicatedServer','-server','-game','-log','-stdout','-FullStdOutLogOutput']);self.assertEqual(a[7:],expected)
 def test_explicit_windows_option_password_still_last(self):
  a=self.argv('Windows operator literal',True);self.assertEqual(a[:2],['/private/proton','run']);self.assertEqual(a[-1],'-ServerPassword=Windows operator literal')
 def test_duplicate_fixed_password_fails_before_launch(self):
  info=copy.deepcopy(r.metadata());info['front']['fixed_args'].append('-ServerPassword=bad')
  with patch.object(r,'metadata',return_value=info),self.assertRaisesRegex(ValueError,'exactly one'):self.argv('real')
 def test_three_optional_empty_fields_are_explicit_clear_tokens(self):
  a=self.argv('');self.assertIn('-ServerTags=""',a);self.assertIn('-ServerAdminAccounts=""',a);self.assertEqual(a[-1],'-ServerPassword=""');self.assertNotIn('-ServerTags=',a);self.assertNotIn('-ServerAdminAccounts=',a)
 def test_nonempty_tags_admin_name_remain_exact(self):
  self.env.update(SRV_TAGS='0,1',SRV_ADMIN='literal-admin;entry',SRV_NAME='Name with spaces')
  a=self.argv('pw');self.assertIn('-ServerTags=0,1',a);self.assertIn('-ServerAdminAccounts=literal-admin;entry',a);self.assertIn('-ServerName=Name with spaces',a)
 def test_clear_encoding_is_scoped_not_general_string_rewrite(self):
  self.assertEqual(r.front_argument('ServerName',''),'-ServerName=');self.assertEqual(r.front_argument('ServerTags','literal"quote'),'-ServerTags=literal"quote')
if __name__=='__main__':unittest.main()
