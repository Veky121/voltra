#!/usr/bin/env python3
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import time
import unittest
import zlib

spec=importlib.util.spec_from_file_location('public_cache',Path(__file__).with_name('cache-steamcmd-public.py'))
public=importlib.util.module_from_spec(spec);spec.loader.exec_module(public)


class PublicCacheTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.source=self.root/'source';self.source.mkdir()
        self.version='1792617903';self.archive=self.root/'updated.tar.gz';self.manifest=self.root/'manifest.json'
        for name in public.PUBLIC_FILES:
            path=self.source/name;path.parent.mkdir(parents=True,exist_ok=True)
            if name in public.PROGRAMS:
                path.write_bytes(b'#!/usr/bin/env bash\nexit 0\n' if name=='steamcmd.sh' else b'\x7fELFpublic-program-fixture')
                path.chmod(0o755)
            elif name.endswith('.manifest'):
                path.write_text('"version" "'+self.version+'"\n"kvsignatures" {}\n')
            else:
                path.write_text('linux32/steamcmd,26;1792617903;12345\nVERSION=3\nSHA1='+'A'*40+'\n')

    def build(self):
        return public.build(self.source,self.archive,self.manifest,self.version)

    def test_public_only_archive_excludes_private_state(self):
        for name in ('config/loginusers.vdf','linux32/logs/console_log.txt','package/steam_cmd_metrics.bin'):
            path=self.source/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('private fixture must never be cached')
        record=self.build();public.validate_archive(self.archive,record)
        with tarfile.open(self.archive) as archive:self.assertEqual(set(archive.getnames()),public.PUBLIC_FILES)
        self.assertEqual(len(record['excluded_files']),3)

    def test_unknown_file_requires_review(self):
        (self.source/'linux32/unknown-token.bin').write_bytes(b'not accepted')
        with self.assertRaisesRegex(ValueError,'Unknown'):self.build()

    def test_catalog_resource_is_checked_and_copied(self):
        name='public/steambootstrapper_english.txt';data=b'public locale fixture'
        path=self.source/name;path.parent.mkdir();path.write_bytes(data);path.chmod(0o644)
        catalog=self.source/'package/steam_cmd_linux.installed'
        catalog.write_text(catalog.read_text()+f'{name},{len(data)};1792617903;{zlib.crc32(data)}\n')
        record=self.build();public.validate_archive(self.archive,record)
        self.assertIn(name,record['files'])
        path.write_bytes(b'x'*len(data))
        with self.assertRaisesRegex(ValueError,'differs'):self.build()

    def test_undeclared_public_resource_is_rejected(self):
        path=self.source/'public/unknown.txt';path.parent.mkdir();path.write_text('unknown')
        with self.assertRaisesRegex(ValueError,'Unknown'):self.build()

    def test_private_or_traversing_resource_catalog_is_rejected(self):
        for name in ('public/../token','public/config/token','/public/token','public/secret\\token'):
            with self.subTest(name=name),self.assertRaises(ValueError):
                public.installed_resources(f'{name},1;1;1\n')

    def test_symlinked_public_library_rejected(self):
        target=self.source/'linux32/steamclient.so';target.unlink();target.symlink_to('/etc/passwd')
        with self.assertRaisesRegex(ValueError,'linked'):self.build()

    def test_private_metadata_rejected(self):
        (self.source/'package/steam_cmd_linux.manifest').write_text('"CachedAccountName" "fixture"')
        with self.assertRaisesRegex(ValueError,'private'):self.build()

    def test_expired_bundle_requires_refresh(self):
        record=self.build();record['prepared_unix']=int(time.time())-8*86400
        with self.assertRaisesRegex(ValueError,'fresh'):public.validate_archive(self.archive,record)

    def test_archive_unknown_traversal_and_symlink_rejected(self):
        record=self.build()
        original=self.archive.read_bytes()
        for name,linked in [('../escape',False),('config/loginusers.vdf',False),('linux32/steamcmd',True)]:
            with self.subTest(name=name):
                self.archive.write_bytes(original)
                members=[]
                with tarfile.open(self.archive) as source:
                    for info in source:
                        members.append((info,source.extractfile(info).read()))
                with tarfile.open(self.archive,'w:gz') as target:
                    for info,data in members:target.addfile(info,io.BytesIO(data))
                    info=tarfile.TarInfo(name)
                    if linked:info.type=tarfile.SYMTYPE;info.linkname='/etc/passwd'
                    else:info.size=1
                    target.addfile(info,None if linked else io.BytesIO(b'x'))
                changed=copy.deepcopy(record);changed['archive_sha256']=hashlib.sha256(self.archive.read_bytes()).hexdigest();changed['archive_bytes']=self.archive.stat().st_size
                with self.assertRaisesRegex(ValueError,'unknown|duplicate|linked'):public.validate_archive(self.archive,changed)


if __name__=='__main__':unittest.main(verbosity=2)
