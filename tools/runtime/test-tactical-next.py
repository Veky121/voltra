import os
import sys
import types
import signal
import tempfile
from pathlib import Path
import unittest
from unittest import mock
for name,source in SOURCES:
    module=types.ModuleType(name);exec(source,module.__dict__);sys.modules[name]=module
runtime=sys.modules['tactical_next_runtime'];installer=sys.modules['tactical_next_install']


class TacticalNextTests(unittest.TestCase):
    def fixture(self,root,kind,**extra):
        info=installer.GAMES[kind];binary=root/info['binaries'][0];binary.parent.mkdir(parents=True,exist_ok=True);binary.write_bytes(b'publisher fixture')
        return {'VOLTRA_TACTICAL_NEXT':kind,'SRCDS_APPID':str(info['app']),'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28020,28030','QUERY_PORT':'28020',**({'WINDOWS_INSTALL':'1','WINEARCH':'win64','WINEPATH':str(root)}if kind=='groundbranch'else{}),**extra}

    def test_aapg_original_auth_query_and_literal_name(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'aapg',AUTH_PORT='28030',SERVER_NAME="Literal $value 'army'")
            argv,child,secrets,ready=runtime.configure(root,env)
            for flag in('-port=28010','-SAP=28030','-SQP=28020',"-servername=\"Literal $value 'army'\""):self.assertIn(flag,argv)
            self.assertEqual(ready,b'Finished loading level');self.assertNotIn('PYTHONHOME',child)

    def test_battalion_original_controls_correct_name_and_game_port(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'battalion',SERVER_NAME="Battalion $value 'literal'",ADMIN_PW='privateadmin')
            argv,_,secrets,ready=runtime.configure(root,env)
            self.assertIn("-SteamServerName=Battalion $value 'literal'",argv);self.assertIn('-Port=28010',argv);self.assertIn('-Queue=Wartide',argv);self.assertIn('-AdminPassword=privateadmin',argv)
            self.assertIn('privateadmin',secrets);self.assertEqual(ready,b' OnCreateSessionComplete ')
            with mock.patch.object(runtime,'run',return_value=250)as child:self.assertEqual(runtime.main(root,env),250)
            self.assertEqual(child.call_args.args[3],'\x03');self.assertTrue(child.call_args.kwargs['terminal_input']);self.assertEqual(child.call_args.kwargs['stop_signal'],signal.SIGINT)

    def test_publisher_battalion_alternate_layout_and_ambiguity(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'battalion');old=root/installer.GAMES['battalion']['binaries'][0]
            alternate=root/'BattalionServer/BattalionServer.sh';alternate.parent.mkdir();alternate.write_bytes(b'publisher shell wrapper')
            with self.assertRaises(ValueError):runtime.configure(root,env)
            old.unlink();argv,*_=runtime.configure(root,env);self.assertEqual(argv[0],str(alternate))
            alternate.unlink()
            with self.assertRaises(ValueError):runtime.configure(root,env)

    def test_groundbranch_wine_prerequisites_fail_before_configuration(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'groundbranch')
            with mock.patch.object(runtime.shutil,'which',return_value=None),self.assertRaisesRegex(ValueError,'wine is missing'):runtime.configure(root,env)
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/wine'),mock.patch.dict(os.environ,{},clear=True),self.assertRaisesRegex(ValueError,'headless display'):runtime.configure(root,env)
            self.assertFalse((root/'GroundBranch/ServerConfig/Server.ini').exists())

    def test_groundbranch_original_controls_modpath_and_unknown_ini_retained(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'groundbranch',SERVER_NAME="Ground $value 'literal'",MAX_PLAYERS='16',WINEDEBUG='-all')
            installer.default_server(root,ORIGINAL_DEFAULT.encode());target=root/'GroundBranch/ServerConfig/Server.ini';target.chmod(0o640)
            previous=target.read_bytes();target.write_bytes(previous+b'CustomOperator=73\r\n')
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/wine'),mock.patch.dict(os.environ,{'DISPLAY':':99'}):argv,child,_,ready=runtime.configure(root,env)
            self.assertEqual(argv[0],'/usr/bin/wine');self.assertIn('MultiHome=0.0.0.0',argv);self.assertIn('Port=28010',argv);self.assertIn('QueryPort=28020',argv)
            self.assertEqual(child['WINEARCH'],'win64');self.assertEqual(child['WINEPATH'],str(root));self.assertEqual(child['WINEPREFIX'],str(root/'.wine'));self.assertEqual(child['WINEDEBUG'],'-all')
            self.assertIn(b'CustomOperator=73',target.read_bytes());self.assertIn(b'ServerMOTD="Welcome!"',target.read_bytes());self.assertIn(b'MaxPlayers',target.read_bytes());self.assertEqual(target.stat().st_mode&0o777,0o640)
            self.assertIn('ModPath=../steamapps/workshop/content/16900/',(root/'GroundBranch/Config/DefaultModding.ini').read_text());self.assertEqual(ready,b'Bringing up level for play took')

    def test_default_groundbranch_template_exact_and_never_overwrites_operator(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);installer.default_server(root,ORIGINAL_DEFAULT.encode());target=root/'GroundBranch/ServerConfig/Server.ini'
            self.assertEqual(target.read_bytes(),ORIGINAL_DEFAULT.encode());target.write_bytes(b'operator custom bytes');installer.default_server(root,b'replacement');self.assertEqual(target.read_bytes(),b'operator custom bytes')

    def test_all_install_retention_success_and_failure_metadata(self):
        for kind in installer.GAMES:
            for failure in(False,True):
                with self.subTest(kind=kind,failure=failure),tempfile.TemporaryDirectory()as directory:
                    root=Path(directory);env=self.fixture(root,kind);info=installer.GAMES[kind];folder=root/info['preserve'][0];folder.mkdir(parents=True,exist_ok=True);cfg=folder/'operator.ini';cfg.write_bytes(b'private operator\r\n');cfg.chmod(0o640);before=cfg.stat()
                    def update(*a,**kw):
                        self.assertEqual(kw['platform'],info['platform']);cfg.write_bytes(b'publisher replacement')
                        if failure:raise RuntimeError('publisher failure')
                        return {'buildid':'123'}
                    with mock.patch.object(installer,'update',side_effect=update):
                        if failure:
                            with self.assertRaises(RuntimeError):installer.install(root,env,groundbranch_default=ORIGINAL_DEFAULT)
                        else:self.assertEqual(installer.install(root,env,groundbranch_default=ORIGINAL_DEFAULT)['buildid'],'123')
                    self.assertEqual(cfg.read_bytes(),b'private operator\r\n');after=cfg.stat();self.assertEqual((before.st_mode,before.st_uid,before.st_gid),(after.st_mode,after.st_uid,after.st_gid))

    def test_aapg_actual_native_state_paths_survive_success_and_failed_update(self):
        for failure in (False, True):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root=Path(directory);env=self.fixture(root,'aapg')
                paths=['AAGame/Config/PCServerLinux-AAGame.ini','AAGame/Config/PCServerLinux/operator.ini','AAGame/Config/BPList.dat','AAGame/Config/PAList.dat','AAGame/Cloud/CloudStorage.ini','AAGame/Logs/AAServer.log','AAPG/Config/legacy.ini']
                before={}
                for index,name in enumerate(paths):
                    path=root/name;path.parent.mkdir(parents=True,exist_ok=True)
                    path.write_bytes(('operator state '+str(index)+'\r\n').encode());path.chmod(0o640)
                    before[name]=(path.read_bytes(),path.stat())
                def update(*args,**kwargs):
                    for name in paths:(root/name).write_bytes(b'publisher replacement')
                    if failure:raise RuntimeError('publisher failure')
                    return {'buildid':'8671920'}
                with mock.patch.object(installer,'update',side_effect=update):
                    if failure:
                        with self.assertRaises(RuntimeError):installer.install(root,env)
                    else:installer.install(root,env)
                for name,(content,metadata) in before.items():
                    path=root/name;after=path.stat()
                    self.assertEqual(path.read_bytes(),content,name)
                    self.assertEqual((after.st_mode,after.st_uid,after.st_gid,after.st_mtime_ns),(metadata.st_mode,metadata.st_uid,metadata.st_gid,metadata.st_mtime_ns),name)

    def test_private_steam_refused_before_installer_or_state_creation(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'aapg',STEAM_PASS='privatepassword')
            with mock.patch.object(installer,'update')as child,self.assertRaises(ValueError)as error:installer.install(root,env)
            child.assert_not_called();self.assertNotIn('privatepassword',str(error.exception));self.assertEqual(list(root.glob('.tactical-next-retention-*')),[])

    def test_original_repair_validation_auto_update_semantics(self):
        for value,expected in[('',False),('true',True),('1',True)]:
            with tempfile.TemporaryDirectory()as directory:
                root=Path(directory);env=self.fixture(root,'groundbranch',AUTO_UPDATE='1',VALIDATE=value)
                with mock.patch.object(runtime,'install')as install,mock.patch.object(runtime,'configure',return_value=([],{},[],b'ready')),mock.patch.object(runtime,'run',return_value=0):self.assertEqual(runtime.main(root,env),0)
                self.assertEqual(install.call_args.kwargs['validate'],expected)
        with self.assertRaises(ValueError):runtime.main(Path('/unused'),{'VOLTRA_TACTICAL_NEXT':'groundbranch','VALIDATE':'arbitrary'})

    def test_role_collisions_unknown_app_wrong_platform_controls_and_symlinks(self):
        cases=[{'QUERY_PORT':'28010'},{'AUTH_PORT':'28020'},{'QUERY_PORT':'0'},{'QUERY_PORT':'29000'},{'SERVER_NAME':'bad\nvalue'},{'SRCDS_APPID':'90'},{'WINDOWS_INSTALL':'1'}]
        for extra in cases:
            with self.subTest(extra=extra),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);env=self.fixture(root,'aapg',AUTH_PORT='28030');env.update(extra)
                with self.assertRaises(ValueError):runtime.configure(root,env)
        with tempfile.TemporaryDirectory()as directory,tempfile.TemporaryDirectory()as outside:
            root=Path(directory);env=self.fixture(root,'aapg');binary=root/'Binaries/Linux/AAPG';binary.unlink();target=Path(outside)/'external';target.write_bytes(b'external');binary.symlink_to(target)
            with self.assertRaises(ValueError):runtime.configure(root,env)

    def test_wine_regular_prefix_retained_without_following_dosdevice_external_links(self):
        with tempfile.TemporaryDirectory()as directory,tempfile.TemporaryDirectory()as outside:
            root=Path(directory);env=self.fixture(root,'groundbranch');prefix=root/'.wine';prefix.mkdir();registry=prefix/'system.reg';registry.write_bytes(b'private registry');devices=prefix/'dosdevices';devices.mkdir();(devices/'z:').symlink_to(outside,target_is_directory=True)
            with mock.patch.object(installer,'update',return_value={'buildid':'123'}):installer.install(root,env,groundbranch_default=ORIGINAL_DEFAULT)
            self.assertEqual(registry.read_bytes(),b'private registry');self.assertTrue((devices/'z:').is_symlink())

    def test_all_original_next_tactical_interrupt_callers_select_sigint(self):
        for kind in installer.GAMES:
            with self.subTest(kind=kind),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);env=self.fixture(root,kind,AUTO_UPDATE='0')
                with mock.patch.object(runtime,'configure',return_value=([],{},[],b'ready')),mock.patch.object(runtime,'run',return_value=250)as native:
                    self.assertEqual(runtime.main(root,env),250)
                self.assertEqual(native.call_args.kwargs['stop_signal'],signal.SIGINT)


unittest.main()
