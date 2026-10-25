import runpy,unittest,os,shutil
from pathlib import Path
from unittest.mock import patch
namespace=runpy.run_path(str(Path(__file__).with_name('test-wasteland-servers.py')))
Base=namespace['Wasteland'];adapter=namespace['adapter']
class PlainsActualPathRetention(unittest.TestCase):
 setUp=Base.setUp;put=Base.put;identity=Base.identity;env=Base.env;plains=Base.plains
 def exercise(self,failed):
  self.plains()
  prefix='.config/unity3d/CobraByteDigital/PlainsOfPain/'
  names=[prefix+'main/worlds/12345.observed/state/world_metadata.data',prefix+'main/worlds/12345.observed/state/population_data.data',prefix+'main/worlds/worlds.dat','configs/server.json','.config/unity3d/Flying Rat Studio/legacy.sav','.config/unity3d/PlainsOfPain/legacy.sav']
  expected={}
  for index,name in enumerate(names):
   p=self.put(name,(b'{"operator_unknown":73}' if name.endswith('.json') else bytes([0,255,index])+b'owned actual native state'))
   p.chmod(0o640 if index%2 else 0o600);os.chown(p,988 if index%2 else 1000,988 if index%2 else 1000);expected[name]=self.identity(p)
  def publisher(*args,**kwargs):
   for name in names:
    p=self.root/name;p.unlink();p.write_bytes(b'publisher replaced');p.chmod(0o644)
   self.put(prefix+'publisher_new_file.data',b'fresh update')
   if failed:raise RuntimeError('first publisher failure')
   return {'appid':2227360,'build':'fixture'}
  with patch.object(adapter.steam,'update',side_effect=publisher):
   if failed:
    with self.assertRaisesRegex(RuntimeError,'first publisher failure'):adapter.install(self.root,'plains',self.env())
   else:self.assertEqual(adapter.install(self.root,'plains',self.env())['appid'],2227360)
  for name,identity in expected.items():self.assertEqual(self.identity(self.root/name),identity,name)
  self.assertEqual((self.root/(prefix+'publisher_new_file.data')).read_bytes(),b'fresh update')
  self.assertFalse(list(self.root.glob('.wasteland-preserve-*')))
 def test_success_preserves_actual_world_operator_and_legacy_bytes_metadata(self):self.exercise(False)
 def test_failure_preserves_actual_world_operator_and_legacy_bytes_metadata(self):self.exercise(True)
 def test_other_games_preserved_lists_and_terms_gate_unchanged(self):
  self.assertNotIn('.config/unity3d/CobraByteDigital/PlainsOfPain',adapter.preserved('night'))
  self.assertNotIn('.config/unity3d/CobraByteDigital/PlainsOfPain',adapter.preserved('noone'))
  with patch.object(adapter.steam,'update')as update,self.assertRaises(ValueError):adapter.install(self.root,'plains',self.env(PLAINS_ACCEPT_EULA='0'))
  update.assert_not_called()
suite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(Base),unittest.defaultTestLoader.loadTestsFromTestCase(PlainsActualPathRetention)])
result=unittest.TextTestRunner(verbosity=1).run(suite)
raise SystemExit(not result.wasSuccessful())
