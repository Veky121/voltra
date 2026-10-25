"""Offline server-disk staging tests. No downloads or native execution."""
import contextlib
import hashlib
import importlib
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

SCRIPTS=Path('internal/panel/game_library/scripts')
REAL_TEMP=tempfile.TemporaryDirectory


class ServerDiskStaging(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.modules_temp=REAL_TEMP()
        cls.modules=Path(cls.modules_temp.name)
        for source in SCRIPTS.iterdir():
            if source.is_file():
                shutil.copyfile(source,cls.modules/source.name)
                if source.suffix=='.py':shutil.copyfile(source,cls.modules/source.name.replace('-','_'))
        sys.path.insert(0,str(cls.modules))
    @classmethod
    def tearDownClass(cls):
        sys.path.remove(str(cls.modules));cls.modules_temp.cleanup()
    def setUp(self):
        self.fixture=REAL_TEMP();self.root=Path(self.fixture.name)/'server';self.root.mkdir();self.created=[]
    def tearDown(self):self.fixture.cleanup()
    def module(self,name):return importlib.import_module(name)
    @contextlib.contextmanager
    def guard(self):
        @contextlib.contextmanager
        def owned(*args,**kwargs):
            self.assertIn('dir',kwargs,'Payload staging must never use default system temp')
            parent=Path(kwargs['dir']);self.assertEqual(parent.resolve(),self.root)
            self.assertFalse(parent.is_symlink());self.assertTrue(parent.is_dir())
            with REAL_TEMP(*args,**kwargs) as name:
                created=Path(name);self.created.append(created)
                self.assertEqual(created.stat().st_mode&0o777,0o700)
                self.assertEqual(created.stat().st_dev,self.root.stat().st_dev)
                yield name
            self.assertFalse(created.exists(),'Owned staging was not cleaned')
        with patch('tempfile.TemporaryDirectory',side_effect=owned):yield
    def file(self,name,data=b'operator config'):
        path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);path.chmod(0o640);return path
    def fail_update(self,target):
        def update(*args,**kwargs):
            target.write_bytes(b'publisher replacement');raise RuntimeError('fixture Steam failure')
        return update
    def assert_restored(self,target,old):
        self.assertEqual(target.read_bytes(),old);self.assertEqual(target.stat().st_mode&0o777,0o640)
        self.assertTrue(self.created);self.assertTrue(all(not path.exists() for path in self.created))

    def test_aggregate_retention_restores_after_failed_update_on_server_disk(self):
        cases=[('ark_family','evolved','ShooterGame/Saved/Config/Game.ini','steam_options'),('conan_empires','conan','ConanSandbox/Saved/Config/Game.ini','steam_options'),('ghost_love_renown','renown','Renown_Combat/Saved/Config/Game.ini','options')]
        for name,game,relative,selector in cases:
            with self.subTest(helper=name):
                module=self.module(name);target=self.file(relative);old=target.read_bytes()
                options=(1,'linux','native',{}) if name!='ghost_love_renown' else {}
                with patch.object(module,selector,return_value=options),patch.object(module.steam,'arguments',return_value=[]),patch.object(module.steam,'update',side_effect=self.fail_update(target)),self.guard():
                    with self.assertRaisesRegex(RuntimeError,'fixture Steam failure'):module.install(self.root,game,{})
                self.assert_restored(target,old)

    def test_reforger_config_backup_failure_restores_same_filesystem(self):
        module=self.module('arma_native');target=self.file('config.json',b'{"operator": true}')
        with patch.object(module.steam,'update',side_effect=self.fail_update(target)),self.guard():
            with self.assertRaisesRegex(RuntimeError,'fixture Steam failure'):module.update_reforger(self.root,{},installing=True)
        self.assert_restored(target,b'{"operator": true}')

    def test_fantasy_full_operator_tree_restore_does_not_capture_staging(self):
        module=self.module('fantasy_worlds_install');target=self.file('Config/operator.ini')
        self.file('Citadel/Saved/SaveGames/world.sav',b'fixture world')
        with patch.object(module.steam_template,'arguments',return_value=[]),patch.object(module.steam_template,'update',side_effect=self.fail_update(target)),self.guard():
            with self.assertRaisesRegex(RuntimeError,'fixture Steam failure'):module.install(self.root,'citadel',{})
        self.assert_restored(target,b'operator config')
        self.assertEqual((self.root/'Citadel/Saved/SaveGames/world.sav').read_bytes(),b'fixture world')
        self.assertFalse(any(p.name.startswith('voltra-fantasy-preserve-') for p in self.root.iterdir()))

    def test_windows_sdk_uses_server_disk_and_rolls_back_owned_publications(self):
        module=self.module('ghost_love_renown');prefix=module.GAMES['ghost'][3].rsplit('/',1)[0]
        old=self.file(prefix+'/steamclient64.dll',b'operator original dll')
        pe=bytearray(80);pe[:2]=b'MZ';struct.pack_into('<I',pe,60,64);pe[64:68]=b'PE\0\0';struct.pack_into('<H',pe,68,0x8664)
        def acquire(stage,*args,**kwargs):
            self.assertTrue(stage.is_relative_to(self.root));self.assertEqual(stage.stat().st_mode&0o777,0o700)
            for name in ('steamclient64.dll','tier0_s64.dll','vstdlib_s64.dll'):(stage/name).write_bytes(pe)
            return {'fixture_only':True}
        publish=module.steam._publish;calls=[]
        def failure(root,name,writer,mode=0o644):
            calls.append(name)
            if len(calls)==2:raise RuntimeError('fixture SDK publish failure')
            return publish(root,name,writer,mode)
        with patch.object(module.steam,'update',side_effect=acquire),patch.object(module.steam,'_publish',side_effect=failure),self.guard():
            with self.assertRaisesRegex(RuntimeError,'fixture SDK publish failure'):module.windows_sdk(self.root,'ghost',{})
        self.assert_restored(old,b'operator original dll')
        self.assertFalse((self.root/prefix/'tier0_s64.dll').exists())

    def test_portal_payload_rollback_and_operator_conflict_remain_real(self):
        module=self.module('fantasy_worlds_install');first=self.file('dedicated_server/pk_dedicated_server.exe',b'old exe');second=self.file('dedicated_server/program.dat',b'old program')
        receipt=self.file('.voltra/fantasy-worlds/portal-files.json',json.dumps({'files':{str(p.relative_to(self.root)):module.digest(p) for p in (first,second)}}).encode())
        with zipfile.ZipFile(self.root/'dedicated_server.zip','w') as archive:
            archive.writestr('payload/pk_dedicated_server.exe',b'new exe');archive.writestr('payload/program.dat',b'new program')
        publish=module.steam_template._publish;count=0
        def failure(*args,**kwargs):
            nonlocal count
            count+=1
            if count==2:raise RuntimeError('fixture Portal publication failure')
            return publish(*args,**kwargs)
        with patch.object(module.steam_template,'_publish',side_effect=failure),self.guard():
            with self.assertRaisesRegex(RuntimeError,'fixture Portal publication failure'):module.unpack_portal(self.root)
        self.assert_restored(first,b'old exe');self.assertEqual(second.read_bytes(),b'old program')
        first.write_bytes(b'operator edit')
        with self.guard():
            with self.assertRaisesRegex(ValueError,'modified or unmanaged'):module.unpack_portal(self.root)
        self.assertEqual(first.read_bytes(),b'operator edit')

    def test_staging_root_confinement_accepts_root_but_rejects_links(self):
        for name in ('ark_family','arma_native','fantasy_worlds_runtime'):
            with self.subTest(name=name):
                module=self.module(name);self.assertEqual(module.confined(self.root,'.').resolve(),self.root)
                outside=Path(self.fixture.name)/('outside-'+name);outside.mkdir();link=self.root/('link-'+name);link.symlink_to(outside,target_is_directory=True)
                with self.assertRaises(ValueError):module.confined(self.root,link.name)


if __name__=='__main__':unittest.main(verbosity=2)
