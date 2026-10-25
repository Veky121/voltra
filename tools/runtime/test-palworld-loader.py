"""MIT. Loader archive/transaction fixtures only; no game/runtime execution."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SOURCE=Path('internal/panel/game_library/scripts/palworld-loader-install.py').resolve()
ARCHIVE=Path('.local/palworld-proton-dependencies/UE4SS-Palworld-g2281fa31.zip').resolve()
spec=importlib.util.spec_from_file_location('loader',SOURCE);loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)


def files(root):
    return {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}


class LoaderTests(unittest.TestCase):
    def test_inventory_returns_only_validated_relative_mod_roots_and_orders(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);config=root/(loader.BASE+'ue4ss/UE4SS-settings.ini');config.parent.mkdir(parents=True)
            config.write_text('[Overrides]\nModsFolderPath=../../../../SharedMods\n+ModsFolderPaths=../../../../SharedMods\nControllingModsTxt=../../../../Order/custom.txt\n')
            before=files(root);result=loader.inventory(root)
            self.assertEqual(result['mod_roots'],[loader.BASE+'Mods',loader.BASE+'ue4ss/Mods','SharedMods'])
            self.assertEqual(result['order_files'],[loader.BASE+'Mods/mods.txt',loader.BASE+'ue4ss/Mods/mods.txt','SharedMods/mods.txt','Order/custom.txt'])
            self.assertEqual(files(root),before);self.assertFalse((root/'.voltra').exists())
            self.assertTrue(all(not Path(name).is_absolute() and '..' not in Path(name).parts for group in result.values() for name in group))

    def test_actual_pinned_archive_layout_license_and_amd64(self):
        manifest,_=loader.pins();payloads=loader.archive_files(ARCHIVE,manifest)
        self.assertEqual(len(payloads),21)
        self.assertIn(b'MIT License',payloads['ue4ss/LICENSE'])
        self.assertNotIn('winmm.dll',payloads)
        self.assertEqual(hashlib.sha256(payloads['ue4ss/UE4SS.dll']).hexdigest(),'21b691a69a20c0801f465369d4fcbca7d7444764022fac2a7e8edc7709ef92b8')

    def test_fresh_install_exact_single_loader_and_private_config_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);receipt=loader.install(root,ARCHIVE)
            self.assertFalse(receipt['native_verified']);self.assertEqual(loader.verify(root)['dll_override'],'dwmapi=n,b')
            for name in (loader.RECEIPT,loader.JOURNAL,loader.BASE+'ue4ss/UE4SS-settings.ini',loader.BASE+'ue4ss/Mods/mods.txt'):
                self.assertEqual((root/name).stat().st_mode&0o777,0o600)
            self.assertFalse((root/(loader.BASE+'winmm.dll')).exists())

    def test_reinstall_keeps_custom_lua_settings_order_paks_saves_and_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);loader.install(root,ARCHIVE)
            names={loader.BASE+'ue4ss/UE4SS-settings.ini':b'[Overrides]\nModsFolderPath=Mods\n;private operator setting\n',
                   loader.BASE+'ue4ss/Mods/mods.txt':b'OperatorFirst : 1\nBPModLoaderMod : 1\n',
                   loader.BASE+'ue4ss/Mods/OperatorFirst/Scripts/main.lua':b'-- operator lua\n',
                   'Pal/Content/Paks/LogicMods/Operator.pak':b'operator blueprint',
                   'Pal/Saved/SaveGames/Operator.sav':b'operator world'}
            for name,data in names.items():
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);path.chmod(0o640);os.utime(path,ns=(1700000000000000000,1700000000000000000))
            before={name:(root/name).stat() for name in names};snapshot=files(root);loader.install(root,ARCHIVE)
            self.assertEqual(files(root),snapshot)
            for name,old in before.items():
                current=(root/name).stat();self.assertEqual((current.st_mode,current.st_uid,current.st_gid,current.st_mtime_ns),(old.st_mode,old.st_uid,old.st_gid,old.st_mtime_ns))

    def test_legacy_proxy_core_settings_and_root_mods_refuse_before_writes(self):
        for name in ('winmm.dll','xinput1_3.dll','UE4SS.dll','UE4SS-settings.ini','Mods/Old/Scripts/main.lua','dwmapi.dll'):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);path=root/(loader.BASE+name);path.parent.mkdir(parents=True);path.write_bytes(b'operator legacy');snapshot=files(root)
                with self.assertRaises(ValueError):loader.install(root,ARCHIVE)
                self.assertEqual(files(root),snapshot);self.assertFalse((root/'.voltra').exists())

    def test_custom_dll_mod_abi_refused_before_any_write_or_reinstall(self):
        for installed in (False,True):
            with self.subTest(installed=installed),tempfile.TemporaryDirectory() as directory:
                root=Path(directory)
                if installed:loader.install(root,ARCHIVE)
                path=root/(loader.BASE+'ue4ss/Mods/LegacyNative/dlls/main.dll');path.parent.mkdir(parents=True);path.write_bytes(b'operator legacy DLL');snapshot=files(root)
                with self.assertRaisesRegex(ValueError,'matching modern UE4SS ABI'):loader.install(root,ARCHIVE)
                self.assertEqual(files(root),snapshot)

    def test_configured_mod_roots_preserve_lua_but_reject_external_and_legacy_dll(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);config=root/(loader.BASE+'ue4ss/UE4SS-settings.ini');config.parent.mkdir(parents=True)
            data=b'[Overrides]\nModsFolderPath = ../../../../SharedMods\nControllingModsTxt = ../../../../SharedMods/mods.txt\n';config.write_bytes(data)
            mod=root/'SharedMods/Operator/Scripts/main.lua';mod.parent.mkdir(parents=True);mod.write_bytes(b'-- operator Lua');order=root/'SharedMods/mods.txt';order.write_bytes(b'Operator : 1\n')
            loader.install(root,ARCHIVE);self.assertEqual(config.read_bytes(),data);self.assertEqual(order.read_bytes(),b'Operator : 1\n')
            dll=mod.parent.parent/'dlls/main.dll';dll.parent.mkdir();dll.write_bytes(b'legacy DLL');snapshot=files(root)
            with self.assertRaisesRegex(ValueError,'ABI'):loader.verify(root)
            self.assertEqual(files(root),snapshot)
        for value in ('../../../../../outside','Z:\\outside','/outside'):
            with self.subTest(value=value),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);config=root/(loader.BASE+'ue4ss/UE4SS-settings.ini');config.parent.mkdir(parents=True);config.write_text('[Overrides]\nModsFolderPath='+value+'\n');snapshot=files(root)
                with self.assertRaises(ValueError):loader.install(root,ARCHIVE)
                self.assertEqual(files(root),snapshot);self.assertFalse((root/'.voltra').exists())

    def test_workshop_second_loader_and_windows_case_collision_refuse(self):
        for name in ('Mods/ManagedMods/UE4SSExperimentalPW/main.dll',loader.BASE+'UE4SS/custom.lua'):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);path=root/name;path.parent.mkdir(parents=True);path.write_bytes(b'operator');snapshot=files(root)
                with self.assertRaises(ValueError):loader.install(root,ARCHIVE)
                self.assertEqual(files(root),snapshot);self.assertFalse((root/'.voltra').exists())

    def test_changed_core_and_uncommitted_journal_block_instead_of_vanilla(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with self.assertRaisesRegex(ValueError,'vanilla'):loader.verify(root)
            loader.install(root,ARCHIVE);path=root/(loader.BASE+'ue4ss/UE4SS.dll');path.write_bytes(b'operator-core');snapshot=files(root)
            with self.assertRaisesRegex(ValueError,'changed/missing'):loader.install(root,ARCHIVE)
            self.assertEqual(files(root),snapshot)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/loader.JOURNAL;path.parent.mkdir(parents=True);path.write_text('{"state":"prepared"}');snapshot=files(root)
            with self.assertRaisesRegex(ValueError,'Interrupted'):loader.verify(root)
            self.assertEqual(files(root),snapshot)

    def test_symlink_state_parent_target_and_volume_alias_refuse(self):
        for name in ('.voltra',loader.BASE.rstrip('/'),loader.BASE+'ue4ss'):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as directory:
                parent=Path(directory);root=parent/'volume';root.mkdir();outside=parent/'outside';outside.mkdir();path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.symlink_to(outside,target_is_directory=True)
                with self.assertRaises(ValueError):loader.install(root,ARCHIVE)
                self.assertEqual(list(outside.iterdir()),[])

    def test_bad_archive_hash_refuses_without_creating_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'volume';root.mkdir();archive=Path(directory)/'bad.zip';archive.write_bytes(b'invalid')
            with self.assertRaises(ValueError):loader.install(root,archive)
            self.assertEqual(list(root.iterdir()),[])

    def malformed(self,name,mode=0o100644,duplicate=False):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'bad.zip'
            with zipfile.ZipFile(path,'w') as source:
                entry=zipfile.ZipInfo(name);entry.external_attr=mode<<16;source.writestr(entry,b'payload')
                if duplicate:source.writestr(name.upper(),b'payload')
            raw=path.read_bytes();manifest={'archive':{'bytes':len(raw),'sha256':loader.digest(raw)},'files':[{'path':name,'bytes':7,'sha256':loader.digest(b'payload'),'kind':'seed'}]}
            with self.assertRaises(ValueError):loader.archive_files(path,manifest)

    def test_zip_traversal_windows_alias_reserved_case_link_rejected(self):
        for name in ('../outside','/absolute','C:/escape','ue4ss\\escape','ue4ss/NUL.txt','ue4ss/trailing.','ue4ss//alias','ue4ss/./alias'):
            with self.subTest(name=name):self.malformed(name)
        self.malformed('ue4ss/link',stat.S_IFLNK|0o777);self.malformed('ue4ss/file',duplicate=True)

    def test_zip_non_amd64_core_missing_member_and_checksum_rejected(self):
        self.malformed('ue4ss/UE4SS.dll')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'bad.zip'
            with zipfile.ZipFile(path,'w') as source:source.writestr('seed',b'data')
            raw=path.read_bytes();manifest={'archive':{'bytes':len(raw),'sha256':loader.digest(raw)},'files':[{'path':'seed','bytes':4,'sha256':'0'*64,'kind':'seed'}]}
            with self.assertRaisesRegex(ValueError,'checksum'):loader.archive_files(path,manifest)

    def test_partial_publication_failure_rolls_back_new_leaves_preserves_operator(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);operator=root/(loader.BASE+'ue4ss/Mods/Operator/Scripts/main.lua');operator.parent.mkdir(parents=True);operator.write_bytes(b'operator');operator.chmod(0o640);snapshot=files(root)
            original=loader.publish;failed=False
            def publish(root,name,*args,**kwargs):
                nonlocal failed
                if name==loader.BASE+'ue4ss/UE4SS.dll' and not failed:failed=True;raise OSError('injected core publication failure')
                return original(root,name,*args,**kwargs)
            with patch.object(loader,'publish',side_effect=publish),self.assertRaises(OSError):loader.install(root,ARCHIVE)
            self.assertEqual(operator.read_bytes(),snapshot[str(operator.relative_to(root))]);self.assertEqual(operator.stat().st_mode&0o777,0o640)
            self.assertFalse((root/(loader.BASE+'dwmapi.dll')).exists());self.assertFalse((root/loader.RECEIPT).exists())
            self.assertEqual(json.loads((root/loader.JOURNAL).read_text())['state'],'rolled_back')
            loader.install(root,ARCHIVE);loader.verify(root)

    def test_receipt_commit_failure_rolls_back_entire_active_set(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);original=loader.publish;failed=False
            def publish(root,name,*args,**kwargs):
                nonlocal failed
                if name==loader.RECEIPT and not failed:failed=True;raise OSError('injected receipt failure')
                return original(root,name,*args,**kwargs)
            with patch.object(loader,'publish',side_effect=publish),self.assertRaises(OSError):loader.install(root,ARCHIVE)
            self.assertFalse((root/(loader.BASE+'dwmapi.dll')).exists());self.assertFalse((root/(loader.BASE+'ue4ss/UE4SS.dll')).exists())
            with self.assertRaisesRegex(ValueError,'vanilla'):loader.verify(root)

    def test_new_files_follow_volume_uid_gid_without_blanket_chown(self):
        if os.geteuid()!=0:self.skipTest('root-only exact ownership fixture')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);os.chown(root,12345,12346);loader.install(root,ARCHIVE)
            for name in (loader.BASE+'dwmapi.dll',loader.BASE+'ue4ss/UE4SS-settings.ini',loader.RECEIPT):
                metadata=(root/name).stat();self.assertEqual((metadata.st_uid,metadata.st_gid),(12345,12346))

    def test_post_replace_failure_restores_old_receipt_uid_gid_mode_and_time(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);loader.install(root,ARCHIVE)
            receipt=root/loader.RECEIPT
            if os.geteuid()==0:os.chown(receipt,12345,12346)
            os.utime(receipt,ns=(1700000000000000000,1700000000000000000));old=receipt.read_bytes();info=receipt.stat()
            missing=root/(loader.BASE+'ue4ss/Mods/mods.txt');missing.unlink()
            original=loader.publish;failed=False
            def publish(root,name,*args,**kwargs):
                nonlocal failed
                result=original(root,name,*args,**kwargs)
                if name==loader.RECEIPT and not failed:failed=True;raise OSError('injected after replace')
                return result
            with patch.object(loader,'publish',side_effect=publish),self.assertRaises(OSError):loader.install(root,ARCHIVE)
            self.assertEqual(receipt.read_bytes(),old);current=receipt.stat()
            self.assertEqual((current.st_mode,current.st_uid,current.st_gid,current.st_mtime_ns),(info.st_mode,info.st_uid,info.st_gid,info.st_mtime_ns))
            self.assertFalse(missing.exists());self.assertEqual(loader.verify(root)['dll_override'],'dwmapi=n,b')


if __name__=='__main__':unittest.main()
