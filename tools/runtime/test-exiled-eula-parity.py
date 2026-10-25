import importlib.util,sys,tempfile,unittest
from unittest.mock import patch
from pathlib import Path
SCRIPTS=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
for name in ['steam_template','native_console','native_config','session_servers_runtime']:
 spec=importlib.util.spec_from_file_location(name,SCRIPTS/(name.replace('_','-')+'.py'));m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m)
runtime=sys.modules['session_servers_runtime']
class AgreementParity(unittest.TestCase):
 def test_both_localadmin_paths_explicit_and_default_consent(self):
  for game in ['scp','exiled']:
   for value in [None,'0','false','1','true']:
    for inherited in [None,'TRUE','1','false','malformed']:
     with self.subTest(game=game,value=value,inherited=inherited),tempfile.TemporaryDirectory()as d:
      env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000'}
      if value is not None:env['SCPSL_ACCEPT_EULA']=value
      if inherited is not None:env['ACCEPT_SCPSL_EULA']=inherited
      argv,result,stop,ready=runtime.launch(Path(d),game,env)
      if value in ['1','true']:self.assertEqual(result['ACCEPT_SCPSL_EULA'],'TRUE')
      else:self.assertNotIn('ACCEPT_SCPSL_EULA',result)
      self.assertNotIn('--acceptEULA',argv);self.assertEqual(stop,'EXIT');self.assertEqual(list(Path(d).iterdir()),[])
 def test_both_paths_reject_malformed_before_writes(self):
  for game in ['scp','exiled']:
   for value in ['yes','TRUE','False','', ' 1','2']:
    with self.subTest(game=game,value=value),tempfile.TemporaryDirectory()as d:
     with self.assertRaisesRegex(ValueError,'SCPSL_ACCEPT_EULA'):runtime.launch(Path(d),game,{'SERVER_PORT':'28000','SCPSL_ACCEPT_EULA':value,'ACCEPT_SCPSL_EULA':'TRUE'})
     self.assertEqual(list(Path(d).iterdir()),[])
 def test_kf2_agreement_keys_remain_unchanged(self):
  with tempfile.TemporaryDirectory()as d:
   argv,env,stop,ready=runtime.launch(Path(d),'kf2',{'SERVER_PORT':'28000','QUERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001,40783','SCPSL_ACCEPT_EULA':'malformed','ACCEPT_SCPSL_EULA':'inherited','ADMIN_PASS':'fixture'})
   self.assertEqual(env['SCPSL_ACCEPT_EULA'],'malformed');self.assertEqual(env['ACCEPT_SCPSL_EULA'],'inherited');self.assertEqual(stop,'\x03');self.assertIn('-QueryPort=28001',argv)
 def test_both_paths_fresh_initializer_is_consent_independent(self):
  for game in ['scp','exiled']:
   with self.subTest(game=game),tempfile.TemporaryDirectory()as d:
    argv,env,_,_=runtime.launch(Path(d),game,{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000'})
    self.assertIn('--useDefault',argv);self.assertNotIn('ACCEPT_SCPSL_EULA',env);self.assertEqual(list(Path(d).iterdir()),[])
 def test_both_paths_existing_per_port_global_and_appdata_preserved(self):
  for game in ['scp','exiled']:
   for appdata in [False,True]:
    for leaf in ['28000/config_localadmin.txt','config_localadmin_global.txt']:
     with self.subTest(game=game,appdata=appdata,leaf=leaf),tempfile.TemporaryDirectory()as d:
      r=Path(d)
      if appdata:(r/'hoster_policy.txt').write_text('GAMEDIR_FOR_CONFIGS: TRUE\n')
      p=r/('AppData/config' if appdata else '.config/SCP Secret Laboratory/config')/leaf;p.parent.mkdir(parents=True);p.write_bytes(b'operator exact\r\n');p.chmod(0o640);st=p.stat();before=(p.read_bytes(),st.st_mode,st.st_uid,st.st_gid,st.st_mtime_ns)
      argv,_,_,_=runtime.launch(r,game,{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000'})
      self.assertNotIn('--useDefault',argv);st=p.stat();self.assertEqual(before,(p.read_bytes(),st.st_mode,st.st_uid,st.st_gid,st.st_mtime_ns))
 def test_both_paths_unsafe_or_unreadable_config_never_initializes(self):
  for game in ['scp','exiled']:
   for kind in ['symlink','nondir','nonfile','readfailure']:
    with self.subTest(game=game,kind=kind),tempfile.TemporaryDirectory()as d:
     r=Path(d);env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000'}
     if kind=='symlink':(r/'.config').symlink_to(r/'missing')
     elif kind=='nondir':(r/'.config').write_bytes(b'operator')
     elif kind=='nonfile':(r/'.config/SCP Secret Laboratory/config/28000/config_localadmin.txt').mkdir(parents=True)
     if kind=='readfailure':
      with patch.object(Path,'lstat',side_effect=PermissionError('denied')),self.assertRaises(PermissionError):runtime.launch(r,game,env)
     else:
      with self.assertRaises(ValueError):runtime.launch(r,game,env)
if __name__=='__main__':unittest.main()
