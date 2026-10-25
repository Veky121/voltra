"""Offline missing-maplist repair fixtures; no Wine or game execution."""
import importlib.util
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock

BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
for name in ['steam-template','native-config','native-console','source-install','source-next-install','tactical-install','tactical-runtime','tactical-next-install','tactical-next-runtime']:
    key=name.replace('-','_');spec=importlib.util.spec_from_file_location(key,BASE/(name+'.py'));module=importlib.util.module_from_spec(spec);sys.modules[key]=module;spec.loader.exec_module(module)
runtime=sys.modules['tactical_next_runtime']
EXPECTED=b'[/script/rbzookeeper.zkmaplist]\nMapList=/Game/GroundBranch/Maps/SmallTown/SmallTown?Mission=/Game/GroundBranch/Mission/SmallTown/SmallTown_IntelRetrieval\n'

class MapListTests(unittest.TestCase):
    def identity(self,p):
        s=p.stat();return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_atime_ns,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink)

    def test_missing_creates_exact_current_verified_default_and_safe_identity(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);self.assertTrue(runtime.default_ground_maplist(root));p=root/'GroundBranch/ServerConfig/MapList.ini';self.assertEqual(p.read_bytes(),EXPECTED);s=p.stat();self.assertEqual(stat.S_IMODE(s.st_mode),0o640);self.assertEqual((s.st_uid,s.st_gid),(root.stat().st_uid,root.stat().st_gid));self.assertEqual(s.st_nlink,1);self.assertEqual(list(p.parent.glob('.voltra-maplist-*')),[])

    def test_existing_custom_bytes_and_every_metadata_field_untouched(self):
        for data in [b'',b';operator\r\n[/script/rbzookeeper.zkmaplist]\r\nMapList=Custom?Mission=Custom\r\n',b'\xff\xfe'+b'custom-non-UTF8']:
            with self.subTest(data=data),tempfile.TemporaryDirectory()as d:
                root=Path(d);p=root/'GroundBranch/ServerConfig/MapList.ini';p.parent.mkdir(parents=True);p.write_bytes(data);p.chmod(0o600);os.utime(p,ns=(1111111111111111111,1222222222222222222));before=self.identity(p);self.assertFalse(runtime.default_ground_maplist(root));self.assertEqual(self.identity(p),before);self.assertEqual(p.read_bytes(),data)

    def test_repeat_call_does_not_touch_default_metadata(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);runtime.default_ground_maplist(root);p=root/'GroundBranch/ServerConfig/MapList.ini';before=self.identity(p);self.assertFalse(runtime.default_ground_maplist(root));self.assertEqual(self.identity(p),before)

    def test_leaf_symlink_existing_or_dangling_rejected(self):
        for dangling in [False,True]:
            with self.subTest(dangling=dangling),tempfile.TemporaryDirectory()as d,tempfile.TemporaryDirectory()as outside:
                root=Path(d);target=Path(outside)/'operator';target.write_bytes(b'outside');p=root/'GroundBranch/ServerConfig/MapList.ini';p.parent.mkdir(parents=True);p.symlink_to(Path(outside)/'missing'if dangling else target)
                with self.assertRaises((ValueError,OSError)):runtime.default_ground_maplist(root)
                self.assertTrue(p.is_symlink());self.assertEqual(target.read_bytes(),b'outside')

    def test_directory_and_fifo_rejected_without_changes(self):
        for kind in ['directory','fifo']:
            with self.subTest(kind=kind),tempfile.TemporaryDirectory()as d:
                root=Path(d);p=root/'GroundBranch/ServerConfig/MapList.ini';p.parent.mkdir(parents=True);p.mkdir()if kind=='directory'else os.mkfifo(p)
                before=p.lstat()
                with self.assertRaises((ValueError,OSError)):runtime.default_ground_maplist(root)
                after=p.lstat();self.assertEqual((before.st_ino,before.st_mode,before.st_ctime_ns),(after.st_ino,after.st_mode,after.st_ctime_ns))

    def test_parent_symlink_rejected_without_outside_creation(self):
        with tempfile.TemporaryDirectory()as d,tempfile.TemporaryDirectory()as outside:
            root=Path(d);(root/'GroundBranch').mkdir();(root/'GroundBranch/ServerConfig').symlink_to(outside,target_is_directory=True)
            with self.assertRaises((ValueError,OSError)):runtime.default_ground_maplist(root)
            self.assertEqual(list(Path(outside).iterdir()),[])

    def test_operator_race_wins_without_overwrite(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);original=runtime.os.link;captured={}
            def race(source,dest,**kwargs):
                p=root/'GroundBranch/ServerConfig/MapList.ini';p.write_bytes(b'concurrent operator');p.chmod(0o600);captured['before']=self.identity(p);return original(source,dest,**kwargs)
            with mock.patch.object(runtime.os,'link',side_effect=race):self.assertFalse(runtime.default_ground_maplist(root))
            p=root/'GroundBranch/ServerConfig/MapList.ini';self.assertEqual(self.identity(p),captured['before']);self.assertEqual(p.read_bytes(),b'concurrent operator');self.assertEqual(list(p.parent.glob('.voltra-maplist-*')),[])

    def test_prepublication_failure_leaves_no_partial_default(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d)
            with mock.patch.object(runtime.os,'fsync',side_effect=OSError('injected durable write failure')),self.assertRaises(OSError):runtime.default_ground_maplist(root)
            folder=root/'GroundBranch/ServerConfig';self.assertFalse((folder/'MapList.ini').exists());self.assertEqual(list(folder.glob('.voltra-maplist-*')),[])

    def fixture(self,root,kind):
        info=runtime.GAMES[kind];binary=root/info['binaries'][0];binary.parent.mkdir(parents=True);binary.write_bytes(b'fixture');env={'VOLTRA_TACTICAL_NEXT':kind,'SRCDS_APPID':str(info['app']),'SERVER_PORT':'28000','QUERY_PORT':'28001','AUTH_PORT':'28002','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002','SERVER_NAME':'Original name','MAX_PLAYERS':'6'}
        if kind=='groundbranch':env.update(WINDOWS_INSTALL='1',WINEARCH='win64',WINEPATH=str(root))
        return env

    def test_ground_configure_publishes_before_launch_and_retains_controls(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);env=self.fixture(root,'groundbranch')
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/wine'),mock.patch.dict(os.environ,{'DISPLAY':':0'}):argv,child,secrets,ready=runtime.configure(root,env)
            self.assertEqual((root/'GroundBranch/ServerConfig/MapList.ini').read_bytes(),EXPECTED);self.assertEqual(argv[0],'/usr/bin/wine');self.assertIn('Port=28000',argv);self.assertIn('QueryPort=28001',argv);self.assertEqual(argv[-1],'-log');self.assertEqual(child['WINEPREFIX'],str(root/'.wine'));self.assertEqual(ready,b'Bringing up level for play took')

    def test_other_tactical_families_never_create_maplist(self):
        for kind in ['aapg','battalion']:
            with self.subTest(kind=kind),tempfile.TemporaryDirectory()as d:
                root=Path(d);env=self.fixture(root,kind)
                with mock.patch.object(runtime,'default_ground_maplist',side_effect=AssertionError('Ground-only')):runtime.configure(root,env)
                self.assertFalse((root/'GroundBranch').exists())

if __name__=='__main__':unittest.main()
