#!/usr/bin/env python3
import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];SCRIPTS=ROOT/'internal/panel/game_library/scripts'
spec=importlib.util.spec_from_file_location('private_wine_prerequisites',SCRIPTS/'private-wine-prerequisites.py');wine=importlib.util.module_from_spec(spec);spec.loader.exec_module(wine)
PINS=json.loads((SCRIPTS/'engineering-servers-pins.json').read_text());ALLOWED=('win11','vcrun2022','vcrun2019','mono','corefonts','dotnet48','sound=disabled')
class Prerequisites(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
 def test_license_and_verb_gate_before_any_subprocess(self):
  for values in [{},{'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','WINETRICKS_RUN':'mono; touch bad'},{'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','WINETRICKS_RUN':'mono mono'}]:
   with self.subTest(values=values),patch.object(wine.subprocess,'run') as run,self.assertRaises(ValueError):wine.prepare(self.root,values,'mono',PINS,ALLOWED)
   run.assert_not_called()
 def test_original_derived_selection_and_receipt_skip(self):
  values={'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','VOLTRA_WINETRICKS_RUN':'sound=disabled','WINETRICKS_RUN':''}
  with patch.object(wine.subprocess,'run') as run:
   env=wine.prepare(self.root,values,'mono',PINS,ALLOWED);self.assertEqual(run.call_count,2);self.assertEqual(run.call_args.args[0],['xvfb-run','-a','winetricks','-q','sound=disabled']);self.assertEqual(env['WINEPREFIX'],str(self.root/'.wine'))
   run.reset_mock();wine.prepare(self.root,values,'mono',PINS,ALLOWED);run.assert_not_called()
 def test_prefix_escape_win32_and_symlink_reject_without_process(self):
  outside=self.root/'outside';outside.mkdir();(self.root/'.wine').symlink_to(outside,target_is_directory=True)
  with patch.object(wine.subprocess,'run') as run,self.assertRaises(ValueError):wine.prepare(self.root,{'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true'},'mono',PINS,ALLOWED)
  run.assert_not_called()
 def test_failed_prerequisite_does_not_receipt_success(self):
  values={'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','WINETRICKS_RUN':'vcrun2019'}
  with patch.object(wine.subprocess,'run',side_effect=[None,RuntimeError('failed prerequisite')]),self.assertRaises(RuntimeError):wine.prepare(self.root,values,'mono',PINS,ALLOWED)
  self.assertFalse((self.root/'.wine/.voltra-prerequisites.json').exists())
 def test_credentials_and_injection_environment_removed(self):
  with patch.dict(wine.os.environ,{'STEAM_PASS':'private','PYTHONPATH':'injection','LD_PRELOAD':'injection'}),patch.object(wine.subprocess,'run'):
   env=wine.prepare(self.root,{'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','WINETRICKS_RUN':'vcrun2022'},'mono',PINS,ALLOWED)
  self.assertNotIn('STEAM_PASS',env);self.assertNotIn('PYTHONPATH',env);self.assertNotIn('LD_PRELOAD',env)
if __name__=='__main__':unittest.main()
