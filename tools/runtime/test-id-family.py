"""Offline regression fixtures for ID-family installers and runtime controls."""
import importlib.util
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SCRIPTS=Path('/repo/internal/panel/game_library/scripts')
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,SCRIPTS/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
native=load('native_release','native-release.py')
ziprelease=load('native_zip_release','native-zip-release.py')
load('steam_template','steam-template.py')
load('native_console','native-console.py')
huffman=load('zandronum_huffman','zandronum-huffman.py')
query=load('id_family_query','id-family-query.py')
runtime=load('id_family_runtime','id-family-runtime.py')
installer=load('id_family_install','id-family-install.py')
build=load('nzp_engine_build','nzp-engine-build.py')

class ArchiveTests(unittest.TestCase):
 def test_prefix_and_root_layout(self):
  for prefix,name in [('top','top/progs.dat'),(None,'progs.dat')]:
   with self.subTest(prefix=prefix),tempfile.TemporaryDirectory() as t:
    p=Path(t);archive=p/'source.zip';out=p/'out';out.mkdir()
    with zipfile.ZipFile(archive,'w') as z:z.writestr(name,b'content')
    ziprelease.extract(archive,out,prefix)
    self.assertEqual((out/'progs.dat').read_bytes(),b'content')
 def test_unsafe_paths(self):
  for name in ['/escape','../escape','top/../../escape','top\\escape','','./']:
   with self.subTest(name=name),tempfile.TemporaryDirectory() as t:
    p=Path(t);out=p/'out';out.mkdir()
    with zipfile.ZipFile(p/'source.zip','w') as z:
     if not name:continue # Python's writer itself rejects empty names.
     z.writestr(name,b'bad')
    with self.assertRaises(ValueError):ziprelease.extract(p/'source.zip',out,None)
 def test_special_types_and_excluded_paths(self):
  for kind in [stat.S_IFLNK,stat.S_IFCHR,stat.S_IFIFO,stat.S_IFSOCK]:
   with self.subTest(kind=kind),tempfile.TemporaryDirectory() as t:
    p=Path(t);out=p/'out';out.mkdir();info=zipfile.ZipInfo('excluded');info.external_attr=(kind|0o777)<<16
    with zipfile.ZipFile(p/'source.zip','w') as z:z.writestr(info,b'bad')
    with self.assertRaises(ValueError):ziprelease.extract(p/'source.zip',out,None,['wanted'])
 def test_duplicate_normalized_paths(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);out=p/'out';out.mkdir()
   with zipfile.ZipFile(p/'source.zip','w') as z:z.writestr('one',b'a');z.writestr('./one',b'b')
   with self.assertRaises(ValueError):ziprelease.extract(p/'source.zip',out,None)
 def test_prefix_mismatch_and_file_root(self):
  for name in ['wrong/file','top']:
   with self.subTest(name=name),tempfile.TemporaryDirectory() as t:
    p=Path(t);out=p/'out';out.mkdir()
    with zipfile.ZipFile(p/'source.zip','w') as z:z.writestr(name,b'x')
    with self.assertRaises(ValueError):ziprelease.extract(p/'source.zip',out,'top')

class RuntimeTests(unittest.TestCase):
 def test_zandronum_all_original_controls(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);game=root/'zandronum';(game/'IWAD').mkdir(parents=True);(game/'PWAD').mkdir();(game/'IWAD/freedoom1.wad').write_bytes(b'wad');(game/'PWAD/custom mod.wad').write_bytes(b'patch')
   env=dict(SERVER_PORT='28010',PWADS='"custom mod.wad"',MAX_PLAYERS='8',MAP='e1m2',SKILL='4',SERVER_NAME='Literal $safe "quoted"',SERVER_PASSWORD='fixture',DMFLAGS='1',DMFLAGS2='2',ZADMFLAGS='3',COMPATFLAGS='4',COMPATFLAGS2='5',ZACOMPATFLAGS='6')
   _,args,port=runtime.configure(env,root,'zandronum')
   self.assertEqual(port,28010);self.assertIn(str(game/'PWAD/custom mod.wad'),args);self.assertIn('Literal $safe "quoted"',args)
   for key,value in [('dmflags','1'),('dmflags2','2'),('zadmflags','3'),('compatflags','4'),('compatflags2','5'),('zacompatflags','6')]:self.assertEqual(args[args.index(key)+1],value)
   self.assertEqual(args[-2:],['+map','e1m2'])
   self.assertEqual(args[args.index('sv_maxplayers')+1],'8');self.assertEqual(args[args.index('-host')+1],'8')
 def test_wad_escape_and_missing(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);(root/'outside.wad').write_bytes(b'x');(root/'zandronum/IWAD').mkdir(parents=True)
   for name in ['../../outside.wad','missing.wad']:
    with self.assertRaises(ValueError):runtime.configure(dict(IWAD=name),root,'zandronum')
 def test_nzp_original_controls_and_literal_args(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);env=dict(NZP_ENGINE='fte_legacy',PROTOCOL='NZP-REBOOT-WEB',TICKRATE='0.033',MAP='ndu',GAME_ARGS='+hostname "literal ; $safe"')
   _,args,_=runtime.configure(env,root,'nzportable')
   self.assertIn('NZP-REBOOT-WEB',args);self.assertIn('0.033',args);self.assertIn('literal ; $safe',args);self.assertEqual(args[-2:],['+map','ndu'])
   self.assertEqual(args[args.index('-basedir')+1],str(root/'nzportable/fte_legacy'))
 def test_vril_full_native_slots_and_headless(self):
  with tempfile.TemporaryDirectory() as t:
   _,args,_=runtime.configure(dict(NZP_ENGINE='vril',NZP_MAXPLAYERS='16',TICKRATE='0.033'),Path(t),'nzportable')
   self.assertEqual(args[args.index('-dedicated')+1],'16');self.assertEqual(args[args.index('+vid_renderer')+1],'headless');self.assertEqual(args[args.index('+sys_ticrate')+1],'0.033')
   self.assertEqual(args[args.index('+hostname')+1],'"Nazi Zombies: Portable server"')
   for env in [dict(NZP_MAXPLAYERS='17'),dict(PROTOCOL='NZP-REBOOT-WEB'),dict(SERVER_PORT='65535')]:
    with self.assertRaises(ValueError):runtime.configure(env,Path(t),'nzportable')
 def test_invalid_map_and_limits(self):
  with tempfile.TemporaryDirectory() as t:
   for env in [dict(MAP='../bad'),dict(TICKRATE='0'),dict(SERVER_PORT='0')]:
    with self.assertRaises(ValueError):runtime.configure(env,Path(t),'nzportable')
 def test_checked_release_receipts(self):
  for releases in installer.RELEASES.values():
   for release in releases:self.assertEqual(len(release['sha256']),64);self.assertTrue(release['url'].startswith('https://'));self.assertGreater(release['bytes'],0)

class QueryTests(unittest.TestCase):
 def test_native_netquake_info_fields_and_size(self):
  import struct
  payload=b'\x83'+b'127.0.0.1:28010\0Vril fixture\0ndu\0'+bytes([0,16,3])
  data=struct.pack('>I',0x80000000|len(payload)+4)+payload
  self.assertEqual(query.parse_vril(data)['maxplayers'],16)
  with self.assertRaises(ValueError):query.parse_vril(data[:-1])
 def fte_socket(self,body,responder=('127.0.0.1',28011)):
  from unittest.mock import MagicMock
  stream=MagicMock();stream.__enter__.return_value=stream;stream.recvfrom.return_value=(body,responder);return stream
 def test_fte_publisher_response_omits_challenge(self):
  data=b'\xff\xff\xff\xffinfoResponse\n\\hostname\\NZP fixture\\mapname\\ndu\\sv_maxclients\\8\\clients\\0\0'
  with patch.object(query.socket,'socket',return_value=self.fte_socket(data)):
   result=query.query('nzportable','127.0.0.1',28011);self.assertEqual(result['map'],'ndu');self.assertEqual(result['maxplayers'],8)
 def test_fte_rejects_wrong_responder_and_wrong_present_challenge(self):
  for data,responder in [(b'anything',('127.0.0.1',1)),(b'\xff\xff\xff\xffinfoResponse\n\\challenge\\wrong\0',('127.0.0.1',28011))]:
   with patch.object(query.socket,'socket',return_value=self.fte_socket(data,responder)):
    with self.assertRaises(ValueError):query.query('nzportable','127.0.0.1',28011)
 def test_fte_empty_info_falls_back_to_native_qw_status(self):
  stream=self.fte_socket(b'')
  stream.recvfrom.side_effect=[(b'\xff\xff\xff\xffinfoResponse\n',('127.0.0.1',28011)),(b'\xff\xff\xff\xffn\\hostname\\Legacy\\map\\ndu\\maxclients\\8\n1 0 0 20 "Fixture" "base" 0 0\n\0\n',('127.0.0.1',28011))]
  with patch.object(query.socket,'socket',return_value=stream):
   result=query.query('nzportable','127.0.0.1',28011);self.assertEqual(result['name'],'Legacy');self.assertEqual(result['map'],'ndu');self.assertEqual(result['maxplayers'],8);self.assertEqual(result['players'],1)
  self.assertEqual(stream.sendto.call_args_list[-1].args[0],b'\xff\xff\xff\xffstatus\n')
 def test_vendored_codec_roundtrip(self):
  codec=huffman.Huffman(huffman.HUFFMAN_FREQS)
  for data in [bytes(range(256)),b'Zandronum server\0'*20,b'\xc7\0\0\0']:
   self.assertEqual(codec.decode(codec.encode(data)),data)
 def test_launcher_fields_and_challenge(self):
  import struct
  raw=struct.pack('<II',5660023,517077)+b'3.2.1\0'+struct.pack('<I',query.FLAGS)+b'Name\0https://example.invalid/517077\0E1M1\0'+bytes([16,8])+b'freedoom1.wad\0'+bytes([1,0,3,0])
  data=query.CODEC.encode(raw);result=query.parse_zandronum(data,517077)
  self.assertEqual(result['maxplayers'],8);self.assertTrue(result['password']);self.assertEqual(result['map'],'E1M1')
  with self.assertRaises(ValueError):query.parse_zandronum(data,1)
  with self.assertRaises((ValueError,KeyError)):query.parse_zandronum(b'\xff'+raw[:-1],517077)

class PublicationTests(unittest.TestCase):
 def fixture(self,root,unsafe=False):
  archive=root/'source.zip'
  with zipfile.ZipFile(archive,'w') as z:
   z.writestr('fteqw-sv64',b'native');z.writestr('nzp/server.cfg',b'stock');z.writestr('nzp/maps/ndu.bsp',b'map')
   if unsafe:z.writestr('../escape',b'bad')
  return dict(version='fixture',url='https://example.invalid/archive',sha256=native.sha256(archive),bytes=archive.stat().st_size,prefix=None,format='zip',destination=''),archive
 def test_same_release_operator_preservation_and_no_network(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);release,archive=self.fixture(root)
   def copy(release,target):
    import shutil
    shutil.copyfile(archive,target)
   with patch.dict(installer.RELEASES,{'nzportable':[release]}),patch.object(installer,'download',side_effect=copy) as download:
    installer.install(root,'nzportable');cfg=root/'nzportable/nzp/server.cfg';cfg.write_bytes(b'operator\xff');(root/'nzportable/nzp/maps/ndu.bsp').write_bytes(b'edited map')
    installer.install(root,'nzportable');self.assertEqual(download.call_count,1);self.assertEqual(cfg.read_bytes(),b'operator\xff');self.assertEqual((root/'nzportable/nzp/maps/ndu.bsp').read_bytes(),b'edited map');self.assertIn('basegame nzp',(root/'nzportable/default.fmf').read_text())
 def test_unsafe_archive_never_publishes_binary(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);release,archive=self.fixture(root,True)
   import shutil
   with patch.dict(installer.RELEASES,{'nzportable':[release]}),patch.object(installer,'download',side_effect=lambda r,p:shutil.copyfile(archive,p)):
    with self.assertRaises(ValueError):installer.install(root,'nzportable')
   self.assertFalse((root/'nzportable/fteqw-sv64').exists());self.assertFalse((root/'.voltra/nzportable/release.json').exists())

class SourceBuildTests(unittest.TestCase):
 def test_stdlib_legacy_crc_table_known_vector(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);(root/'data.csv').write_text('source,target\n123456789,texture.tga\nother,second.tga\n')
   build.generate_legacy_table(root/'data.csv',root/'table.qc');data=(root/'table.qc').read_text()
   self.assertIn('10673,"texture.tga",9}',data);self.assertIn('asset_conversion_table[]',data)
   self.assertNotIn('123456789,\n',data)

if __name__=='__main__':unittest.main(verbosity=2)
