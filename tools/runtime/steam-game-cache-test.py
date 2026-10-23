import importlib.util,json,os,pathlib,tempfile,unittest,subprocess,sys,time
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('cache',pathlib.Path(__file__).with_name('steam-game-cache.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class Cache(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.cache=self.root/'cache';self.cache.mkdir();self.id='11111111-1111-4111-8111-111111111111';self.work=self.cache/'steam-games/work'/self.id;self.payload=self.work/'payload';(self.payload/'steamapps').mkdir(parents=True)
  self.request={'appid':90,'branch':'public','platform':'linux','mod':'cstrike'}
  self.state={'appid':'90','Universe':'1','name':'Dedicated Server','StateFlags':'4','installdir':'Half-Life','LastOwner':'0','buildid':'123','SizeOnDisk':'6','InstalledDepots':{'1':{'manifest':'456','size':'6'}},'UserConfig':{'mod':'cstrike'}}
  self.acf=self.payload/'steamapps/appmanifest_90.acf';self.write_state();(self.payload/'server.so').write_bytes(b'public');(self.payload/'server.so').chmod(0o755)
  (self.payload/'default.cfg').write_text('publisher default\n')
  proof={'request':self.request,'anonymous':True,'game_booted':False,'pristine':True,'exit_code':0,'appmanifest':'payload/steamapps/appmanifest_90.acf'};(self.work/'proof.json').write_text(json.dumps(proof))
 def tearDown(self):self.temp.cleanup()
 def write_state(self):self.acf.write_text(c.vdf.dumps({'AppState':self.state},pretty=True))
 def publish(self):
  with c.locked(self.cache):return c.publish(self.cache,self.id)
 def test_two_copies_are_independent_and_cache_unchanged(self):
  published=self.publish();identity=published['object'];obj=self.cache/'steam-games/objects'/identity
  first=self.root/'one';second=self.root/'two';first.mkdir();second.mkdir()
  with c.locked(self.cache):c.seed(self.cache,identity,first);c.seed(self.cache,identity,second)
  self.assertEqual((first/'server.so').stat().st_mode&511,0o755)
  self.assertEqual(len({(first/'server.so').stat().st_ino,(second/'server.so').stat().st_ino,(obj/'payload/server.so').stat().st_ino}),3)
  (first/'server.so').write_bytes(b'operator edit');self.assertEqual((second/'server.so').read_bytes(),b'public');self.assertEqual(c.verify(obj)['key']['mod'],'cstrike')
 def test_vdf_duplicate_private_owner_and_state_rejected(self):
  for key,value in [('LastOwner','7656119'),('StateFlags','6'),('PrivateToken','secret')]:
   old=dict(self.state);self.state[key]=value;self.write_state()
   with self.assertRaises(ValueError):c.metadata(self.acf,self.request)
   self.state=old
  self.acf.write_text('"AppState"\n{\n"appid" "90"\n"APPID" "90"\n}\n')
  with self.assertRaises(ValueError):c.metadata(self.acf,self.request)
 def test_paths_links_special_and_case_collisions_rejected(self):
  for name in ['../outside','/absolute','a\\b','drive:c','dot/../escape','bad\npath']:
   with self.assertRaises(ValueError):c.safe(name)
  (self.payload/'Alias').symlink_to(self.root,target_is_directory=True)
  with self.assertRaises(ValueError):c.inventory(self.payload)
  (self.payload/'Alias').unlink();(self.payload/'SERVER.SO').write_bytes(b'duplicate')
  with self.assertRaises(ValueError):c.inventory(self.payload)
 def test_hardlinks_and_private_trees_never_published(self):
  os.link(self.payload/'server.so',self.payload/'other.so')
  with self.assertRaises(ValueError):self.publish()
  (self.payload/'other.so').unlink();(self.payload/'logs').mkdir();(self.payload/'logs/private.log').write_text('never publish')
  result=self.publish();obj=self.cache/'steam-games/objects'/result['object'];self.assertFalse((obj/'payload/logs').exists());self.assertIn('logs/private.log',c.verify(obj)['excluded'])
 def test_failed_publication_never_creates_key_or_complete_object(self):
  with patch.object(c.shutil,'copyfile',side_effect=OSError('incomplete copy')):
   with self.assertRaises(OSError):self.publish()
  self.assertFalse((self.cache/'steam-games/keys').exists());self.assertFalse(any((self.cache/'steam-games/.staging').iterdir()))
 def test_quota_counts_other_namespaces_and_preserves_public_blobs(self):
  public=self.cache/'sha256';public.mkdir();(public/'existing').write_bytes(b'x'*1024)
  with patch.object(c,'CAPACITY',512):
   with self.assertRaises(ValueError):self.publish()
  self.assertEqual((public/'existing').read_bytes(),b'x'*1024)
 def test_gc_only_own_unreferenced_and_immutable_hash_checked(self):
  result=self.publish();obj=self.cache/'steam-games/objects'/result['object'];public=self.cache/'sha256';public.mkdir();(public/'other').write_bytes(b'keep')
  manifest=obj/'manifest.json';manifest.chmod(0o600);manifest.write_text('{}')
  with self.assertRaises(ValueError):c.verify(obj)
  c.gc(self.cache,age=-1);self.assertFalse(obj.exists());self.assertEqual((public/'other').read_bytes(),b'keep')
 def test_booted_or_mutated_input_is_not_an_acquisition(self):
  path=self.work/'proof.json';proof=json.loads(path.read_text());proof['game_booted']=True;path.write_text(json.dumps(proof))
  with self.assertRaises(ValueError):self.publish()
 def test_nonempty_destination_is_never_merged(self):
  result=self.publish();destination=self.root/'volume';destination.mkdir();(destination/'operator.cfg').write_text('keep')
  with self.assertRaises(ValueError):c.seed(self.cache,result['object'],destination)
  self.assertEqual((destination/'operator.cfg').read_text(),'keep')
 def test_shared_depots_key_all_manifest_ids_and_strip_native_owner(self):
  self.state['SharedDepots']={'11':'10'};self.state['LastOwner']='76561190000000000';self.write_state()
  shared={**self.state,'appid':'10','StateFlags':'68','buildid':'789','InstalledDepots':{'11':{'manifest':'999','size':'4'}},'UserConfig':{}};shared.pop('SharedDepots');shared.pop('LastOwner')
  (self.acf.parent/'appmanifest_10.acf').write_text(c.vdf.dumps({'AppState':shared},pretty=True))
  key,acfs=c.metadata_tree(self.acf,self.request);self.assertEqual(key['depots'],{'1':'456','11':'999'});self.assertEqual(key['shared_apps']['10']['buildid'],'789')
  self.assertTrue(all(c.vdf.loads(raw.decode())['AppState']['LastOwner']=='0' for raw in acfs.values()))
 def test_partial_seed_failure_rolls_back_empty_destination(self):
  result=self.publish();destination=self.root/'volume';destination.mkdir()
  with patch.object(c.shutil,'copyfile',side_effect=OSError('disk failure')):
   with self.assertRaises(OSError):c.seed(self.cache,result['object'],destination)
  self.assertEqual(list(destination.iterdir()),[])
 def test_private_branch_selection_never_cached(self):
  with self.assertRaises(ValueError):c.metadata_tree(self.acf,{**self.request,'branch':'private'})
 def test_global_capacity_lock_serializes_other_publishers(self):
  lock=self.cache/'.capacity.lock';lock.touch()
  script="import fcntl,sys,time;f=open(sys.argv[1],'a+b');fcntl.flock(f,fcntl.LOCK_EX);print('locked',flush=True);time.sleep(0.25)"
  child=subprocess.Popen([sys.executable,'-c',script,str(lock)],stdout=subprocess.PIPE,text=True)
  self.assertEqual(child.stdout.readline().strip(),'locked');started=time.monotonic()
  with c.locked(self.cache):self.assertGreater(time.monotonic()-started,0.15)
  child.wait();child.stdout.close()
 def test_no_steam_appstate_or_session_owner_deployed(self):
  result=self.publish();destination=self.root/'volume';destination.mkdir();report=c.seed(self.cache,result['object'],destination)
  self.assertFalse(report['steam_appstate_deployed']);self.assertFalse((destination/'steamapps').exists());self.assertTrue(report['publisher_update_validate_required'])
 def test_unknown_immutable_members_rejected(self):
  result=self.publish();obj=self.cache/'steam-games/objects'/result['object'];obj.chmod(0o700);(obj/'unexpected').write_text('not in manifest')
  with self.assertRaises(ValueError):c.verify(obj)
if __name__=='__main__':unittest.main()
