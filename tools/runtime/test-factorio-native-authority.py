from unittest.mock import patch
import hashlib,importlib.machinery,importlib.util,json,os,re,shutil,subprocess,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];ART=ROOT/'artifacts/game-parity-20261029';loader=importlib.machinery.SourceFileLoader('factorio_seed',str(ROOT/'internal/panel/game_library/scripts/factorio-settings-seed.py'));spec=importlib.util.spec_from_loader(loader.name,loader);seed=importlib.util.module_from_spec(spec);loader.exec_module(seed)
ENV={'SERVER_NAME':'Seed','SERVER_DESC':'Description','MAX_SLOTS':'20','SERVER_USERNAME':'','SERVER_TOKEN':'','GAME_PASSWORD':'','SAVE_INTERVAL':'10','SAVE_SLOTS':'5','AFK_KICK':'0','PUBLIC_SERVER':'0','LAN_SERVER':'1','FACTORIO_VERSION':'2.0.77','SAVE_NAME':'gamesave','SERVER_PORT':'29101'}
ORIGINAL=json.loads((ROOT/'tools/runtime/factorio-parity-original-controls.json.fixture').read_text());PROFILE=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())['factorio/factorio/egg-factorio.json'];CURRENT=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())['factorio/factorio/egg-factorio.json']
class SeedTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);(self.root/'data').mkdir();(self.root/'data/server-settings.example.json').write_text('{"name":"Publisher","visibility":{"public":true,"lan":true,"unknown_visibility":["opaque"]},"token":"","username":"","unknown":[1,2]}')
 def tearDown(self):self.tmp.cleanup()
 def test_new_native_private_defaults_and_original_creation_values(self):
  self.assertTrue(seed.prepare(self.root,{**ENV,'SERVER_NAME':'literal "quote" \\ text','GAME_PASSWORD':'private literal'},True));p=self.root/'data/server-settings.json';d=json.loads(p.read_text());self.assertEqual(d['visibility'],{'public':False,'lan':True,'unknown_visibility':['opaque']});self.assertEqual(d['name'],'literal "quote" \\ text');self.assertEqual(d['unknown'],[1,2]);self.assertEqual(p.stat().st_mode&0o777,0o600)
 def test_existing_operator_bytes_precision_mode_and_credentials_survive_marker_absence(self):
  p=self.root/'data/server-settings.json';b=b'{\n "name":"Operator", "unknown":900719925474099312345, "visibility":{"public":true}, "username":"owner", "token":"operator-private"\n}\n';p.write_bytes(b);p.chmod(0o640);st=p.stat();self.assertFalse((self.root/'.voltra/factorio-initialized').exists());self.assertFalse(seed.prepare(self.root,{**ENV,'SERVER_NAME':'Changed','GAME_PASSWORD':'changed'},True));self.assertEqual(p.read_bytes(),b);self.assertEqual(p.stat().st_mtime_ns,st.st_mtime_ns);self.assertEqual(p.stat().st_mode&0o777,0o640)
 def test_complete_fresh_publication_failure_leaves_no_partial_or_temp_file(self):
  old=set(self.root.rglob('*'))
  with patch.object(seed.os,'link',side_effect=OSError('fixture publication refusal')):
   with self.assertRaises(OSError):seed.prepare(self.root,ENV,True)
  self.assertEqual(set(self.root.rglob('*')),old)
 def test_dry_preflight_has_no_writes(self):
  old=set(self.root.rglob('*'));self.assertFalse(seed.prepare(self.root,ENV));self.assertEqual(set(self.root.rglob('*')),old)
 def test_public_creation_without_credentials_refuses_before_seed(self):
  with self.assertRaises(ValueError):seed.prepare(self.root,{**ENV,'PUBLIC_SERVER':'1'},True)
  self.assertFalse((self.root/'data/server-settings.json').exists())
 def test_native_public_password_alternative_supported(self):
  p=self.root/'data/server-settings.json';p.write_text('{"visibility":{"public":true},"username":"owner","password":"private"}');self.assertFalse(seed.prepare(self.root,ENV,True))
 def test_duplicate_nonfinite_malformed_or_wrong_native_types_refuse_unchanged(self):
  for text in ['{"name":"one","name":"two"}','{"value":NaN}','[]','{"visibility":{"public":"true"}}','{"max_players":true}','{"password":{"opaque":true}}','{"visibility":{"public":true}}']:
   p=self.root/'data/server-settings.json';p.write_text(text)
   with self.assertRaises(ValueError):seed.prepare(self.root,ENV,True)
   self.assertEqual(p.read_text(),text)
 @unittest.skipUnless(os.name=='posix','Linux symlink fixture')
 def test_symlink_target_refuses_without_operator_mutation(self):
  p=self.root/'operator';p.write_text('{}');(self.root/'data/server-settings.json').symlink_to(p)
  with self.assertRaises(ValueError):seed.prepare(self.root,ENV,True)
  self.assertEqual(p.read_text(),'{}')
 def test_profile_keeps_exact_original_controls_and_installer_and_native_argv(self):
  self.assertEqual(PROFILE['egg']['variables'],ORIGINAL['variables']);self.assertEqual(PROFILE['defaults'],ORIGINAL['defaults']);self.assertEqual(PROFILE['egg']['docker_images'],ORIGINAL['docker_images']);self.assertEqual(PROFILE['egg']['startup'],'exec bash .voltra/factorio-native-start.sh');script=PROFILE['egg']['scripts']['installation']['script'];self.assertNotIn('touch .voltra/factorio-initialized',script);self.assertNotIn('mv "$temp" data/server-settings.json',script);self.assertIn('python3 "$stage/factorio-install.py" --root /mnt/server --version "$FACTORIO_VERSION" --architecture x64',script);self.assertLess(script.index('python3 "$stage/factorio-settings-seed.py" --root /mnt/server\n'),script.index('python3 "$stage/factorio-install.py" --root'));self.assertIn('--config config/config.ini --mod-directory mods --port "$SERVER_PORT" --server-settings data/server-settings.json --start-server "saves/$SAVE_NAME.zip"',script)
 @unittest.skipUnless(os.name=='posix','Linux actual Bash/JQ process')
 def test_actual_launcher_preserves_native_bytes_and_uses_save(self):
  root=self.root;self.assertTrue(seed.prepare(root,ENV,True));p=root/'data/server-settings.json';p.write_text('{"name":"Operator","visibility":{"public":false,"lan":false},"max_players":17,"game_password":"operator-secret","unknown":900719925474099312345}');before=p.read_bytes()
  for d in ['.voltra','data/base','bin/x64','config','saves','mods']:(root/d).mkdir(parents=True,exist_ok=True)
  jq=ROOT/'.local/factorio-version-choice/jq-linux-amd64';self.assertEqual(hashlib.sha256(jq.read_bytes()).hexdigest(),'020468de7539ce70ef1bceaf7cde2e8c4f2ca6c3afb84642aabc5c97d9fc2a0d');shutil.copyfile(jq,root/'.voltra/jq');(root/'.voltra/jq').chmod(0o755)
  (root/'.voltra/factorio-installed.json').write_text('{"version":"2.0.77"}');(root/'data/base/info.json').write_text('{"version":"2.0.77"}');(root/'saves/gamesave.zip').write_bytes(b'operator save');binary=root/'bin/x64/factorio';binary.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > fixture-argv\nprintf "NATIVE_FIXTURE_ONLY\\n"\n');binary.chmod(0o755)
  script=re.search(r"cat > .voltra/factorio-native-start.sh <<'LAUNCH'\n([\s\S]*?)\nLAUNCH",PROFILE['egg']['scripts']['installation']['script']).group(1).replace('cd /home/container','cd "'+str(root)+'"');launcher=root/'launcher.sh';launcher.write_text(script)
  result=subprocess.run(['/bin/bash',str(launcher)],env={**os.environ,**ENV},capture_output=True,timeout=5);self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(p.read_bytes(),before);self.assertEqual((root/'saves/gamesave.zip').read_bytes(),b'operator save');self.assertIn('saves/gamesave.zip',(root/'fixture-argv').read_text());self.assertNotIn(b'operator-secret',result.stdout+result.stderr)
  legacy=(ROOT/'tools/runtime/factorio-parity-legacy-start.sh.fixture').read_text().replace('cd /home/container','cd \"'+str(root)+'\"');launcher.write_text(legacy)
  legacy_result=subprocess.run(['/bin/bash',str(launcher)],env={**os.environ,**ENV},capture_output=True,timeout=5);self.assertEqual(legacy_result.returncode,0,legacy_result.stderr);self.assertNotEqual(p.read_bytes(),before);self.assertEqual(json.loads(p.read_text())['name'],'Seed');self.assertEqual(json.loads(p.read_text())['game_password'],'')
if __name__=='__main__':unittest.main()
