import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('tools/runtime/managed-steam-operator-archive.py','utf8');
const tests=String.raw`
import unittest,tempfile,types,json,tarfile,io,os,hashlib
from pathlib import Path
m=types.ModuleType('archive');exec(SOURCE,m.__dict__)
class ArchiveTests(unittest.TestCase):
 def populate(self,root):
  p=root/'FactoryGame/Saved/marker.sav';p.parent.mkdir(parents=True);p.write_bytes(b'private operator marker');p.chmod(0o600)
  for f in [root/'FactoryGame/Saved',p]:os.chown(f,1000,1000)
 def test_round_trip_exact_content_modes_and_ownership(self):
  with tempfile.TemporaryDirectory() as d:
   base=Path(d);old=base/'old';new=base/'new';out=base/'export';old.mkdir();new.mkdir();out.mkdir();self.populate(old);self.populate(new)
   (new/'FactoryGame/Saved/marker.sav').write_bytes(b'new disposable state')
   m.export(old,out);result=m.restore(new,out)
   self.assertTrue(result['exact_manifest_match']);self.assertEqual(m.scan(old),m.scan(new));self.assertEqual((new/'FactoryGame/Saved/marker.sav').read_bytes(),b'private operator marker')
 def test_unknown_traversal_and_special_members_rejected_before_destination_mutation(self):
  for name,kind in [('FactoryGame/Saved/../escape','regular'),('outside','regular'),('FactoryGame/Saved/pipe','fifo'),('FactoryGame/Saved/link','link')]:
   with tempfile.TemporaryDirectory() as d:
    base=Path(d);new=base/'new';out=base/'export';new.mkdir();out.mkdir();self.populate(new);before=m.scan(new)
    archive=out/'operator.tar.gz'
    with tarfile.open(archive,'w:gz') as t:
     item=tarfile.TarInfo(name);item.size=0
     if kind=='fifo':item.type=tarfile.FIFOTYPE
     if kind=='link':item.type=tarfile.SYMTYPE;item.linkname='/etc/passwd'
     t.addfile(item,io.BytesIO(b''))
    records={name:{'mode':0o600,'uid':1000,'gid':1000,'directory':False,'size':0,'sha256':hashlib.sha256(b'').hexdigest()}}
    (out/'manifest.json').write_text(json.dumps({'schema':1,'archive_sha256':m.digest(archive),'records':records}))
    with self.assertRaises(ValueError):m.restore(new,out)
    self.assertEqual(m.scan(new),before)
 def test_corrupt_archive_and_source_ancestor_link_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   base=Path(d);old=base/'old';new=base/'new';out=base/'export';old.mkdir();new.mkdir();out.mkdir();self.populate(old);self.populate(new);m.export(old,out)
   with (out/'operator.tar.gz').open('ab') as f:f.write(b'changed')
   with self.assertRaises(ValueError):m.restore(new,out)
   (old/'.config').symlink_to(base,target_is_directory=True)
   with self.assertRaises(ValueError):m.scan(old)
unittest.main()
`;
const r=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','128m','--cpus','1','python:3.13-slim','python3','-B','-'],{input:'SOURCE='+JSON.stringify(source)+'\n'+tests,windowsHide:true,encoding:'utf8',maxBuffer:1024*1024});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status??1;
