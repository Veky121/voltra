import importlib.util,json,unittest,tempfile,re,subprocess,sys
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('wine_next',ROOT/'internal/panel/game_library/scripts/mordhau-wine-next.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ENV={'SERVER_PORT':'7777','QUERY_PORT':'27015','BEACON_PORT':'15000','VOLTRA_ALLOCATED_PORTS':'7777,27015,15000','SERVER_NAME':'seed','ADMIN_PASSWORD':'seed','MAX_PLAYERS':'24'}
class Wine(unittest.TestCase):
 def test_installer_embeds_literal_helper_and_imports(self):
  fragment=ROOT/'artifacts/game-parity-20261029/mordhau-wine-owner-next/profile.pending.json'
  profile=json.loads(fragment.read_text(encoding='utf-8'))['mordhau/egg-mordhau-wine.json']
  script=profile['egg']['scripts']['installation']['script']
  embeds=re.findall(r"cat > (\S+) <<'([^']+)'\r?\n([\s\S]*?)\r?\n\2(?:\r?\n|$)",script)
  body=next(body for target,_,body in embeds if target=='.voltra/mordhau-wine-next.py')
  original=(ROOT/'internal/panel/game_library/scripts/mordhau-wine-next.py').read_text(encoding='utf-8')
  self.assertEqual(body.replace('\r\n','\n'),original)
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)
   for target,_,source in embeds:
    path=root/target
    self.assertTrue(path.resolve().is_relative_to(root.resolve()))
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(source.encode('utf-8'))
   code="import runpy; runpy.run_path('.voltra/mordhau-wine-next.py'); print('packaged-import-ok')"
   result=subprocess.run([sys.executable,'-I','-B','-c',code],cwd=root,capture_output=True,text=True,timeout=15)
   self.assertEqual(result.returncode,0,result.stderr)
   self.assertIn('packaged-import-ok',result.stdout)
 def test_preserves_duplicate_case_and_unknown_rows(self):
  raw='\ufeff[/script/mordhau.mordhaugamesession]\r\nServerName=operator\r\nservername=last\r\nMods=1\r\nMods=2\r\n;comment\r\n'
  out=m.seed_session(raw,{'ServerName':'wrong','AdminPassword':'seed'})
  self.assertTrue(out.startswith(raw));self.assertNotIn('wrong',out);self.assertEqual(m.seed_session(out,{'ServerName':'wrong','AdminPassword':'seed'}),out)
 def test_native_file_authority_and_secrets(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p=root/'Mordhau/Saved/Config/WindowsServer/Game.ini';p.parent.mkdir(parents=True);p.write_bytes(b'[/Script/Mordhau.MordhauGameSession]\r\nServerName=operator\r\nServerPassword=private\r\nAdminPassword=admin\r\nMaxSlots=17\r\n')
   before=p.read_bytes();_,argv,secrets=m.configure(root,'mordhau-wine',ENV)
   self.assertEqual(before,p.read_bytes());self.assertFalse(any('MaxSlots=' in a for a in argv));self.assertIn('private',secrets);self.assertIn('admin',secrets)
 def test_invalid_preflight_never_updates_or_writes(self):
  for change in ({'SERVER_NAME':'bad\nline'},{'QUERY_PORT':'7777'},{'MAX_PLAYERS':'99'},{'SRCDS_APPID':'629760'}):
   with tempfile.TemporaryDirectory() as d,patch.object(m.steam,'update',side_effect=AssertionError('update reached')):
    with self.assertRaises(ValueError):m.install(Path(d),'mordhau-wine',ENV|change)
    self.assertEqual(list(Path(d).iterdir()),[])
 def test_seed_no_trailing_newline(self):
  raw='[Other]\nArray=1\nArray=2';out=m.seed_session(raw,{'ServerName':'seed'});self.assertTrue(out.startswith(raw+'\n'));self.assertEqual(out.count('ServerName=seed'),1)
if __name__=='__main__':unittest.main()
