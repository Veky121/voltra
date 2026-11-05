import importlib.util
import json
import os
from pathlib import Path
import runpy
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


for name in ('steam-template', 'native-console', 'native-release', 'source-install', 'source-runtime', 'goldsrc-runtime', 'goldsrc-install', 'cs16-modules-install'):
    load(name.replace('-', '_'), BASE / (name + '.py'))
source, gold, modules = [sys.modules[name] for name in ('source_runtime', 'goldsrc_runtime', 'cs16_modules_install')]
adapter = load('counterstrike_wave5', BASE / 'counterstrike-preflight.py')


class CounterStrikePreflight(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.payloads = ('srcds_run', 'hlds_run', 'hlds_linux', 'cstrike/liblist.gam', 'cstrike/maps/de_dust2.bsp')
        for name in self.payloads:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'non-executable fixture')
        cfg = self.root / 'cstrike/cfg/server.cfg'
        cfg.parent.mkdir()
        cfg.write_bytes(b'// original Source operator\nmp_friendlyfire 1\n')
        (self.root / 'cstrike/server.cfg').write_bytes(b'// original GoldSrc operator\nmp_freezetime 5\n')
        (self.root / '.voltra').mkdir()
        (self.root / '.voltra/cs16-modules-release.json').write_bytes((BASE / 'cs16-modules-release.json').read_bytes())

    def env(self, game):
        env = {'SERVER_PORT':'29100', 'VOLTRA_ALLOCATED_PORTS':'29100,29101,29102', 'AUTO_UPDATE':'1', 'HOSTNAME':'Literal server', 'SERVER_PASSWORD':'fixture-join', 'RCON_PASSWORD':'fixture-rcon'}
        if game == 'css': env.update(SRCDS_APPID='232330', SRCDS_MAP='de_dust2')
        else: env.update(SRCDS_APPID='90', HLDS_GAME='cstrike', SRV_SLOTS='32')
        if game == 'rehlds': env.update(SRCDS_BETAID='steam_legacy', VERSION='latest')
        return env

    def snapshot(self):
        return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file() and not p.is_symlink()}

    def invoke(self, game, env):
        module_stub = types.SimpleNamespace(selection=modules.selection, install=Mock())
        installer_stub = types.SimpleNamespace(install=Mock())
        runtime = source if game == 'css' else gold
        with patch.object(runtime, 'update', create=True) as update, patch.object(runtime, 'run', return_value=17) as launch, patch.object(gold, 'await_native_info'):
            result = adapter.main(game, self.root, env, runtime, installer_stub, module_stub)
        return result, update, launch, installer_stub, module_stub

    def test_invalid_controls_refuse_before_any_acquisition_or_writes(self):
        for game in ('css','cs16','rehlds'):
            for invalid in ({'SERVER_PORT':'1'}, {'HOSTNAME':'bad;exec'}, {'PUBLIC_SERVER':'2'}, {('MAX_PLAYERS' if game=='css' else 'SRV_SLOTS'):'999'}):
                with self.subTest(game=game,invalid=invalid):
                    before = self.snapshot()
                    runtime = source if game=='css' else gold
                    install = types.SimpleNamespace(install=Mock())
                    mods = types.SimpleNamespace(selection=modules.selection, install=Mock())
                    with patch.object(runtime,'update',create=True) as update, patch.object(runtime,'run') as launch, self.assertRaises(ValueError):
                        adapter.main(game,self.root,{**self.env(game),**invalid},runtime,install,mods)
                    update.assert_not_called();install.install.assert_not_called();mods.install.assert_not_called();launch.assert_not_called()
                    self.assertEqual(self.snapshot(),before)

    def test_css_explicit_tv_reserved_before_automatic_client_port(self):
        env = {**self.env('css'),'AUTO_UPDATE':'0','SRCDS_CPORT':'0','SRCDS_STV':'29101'}
        with self.assertRaises(ValueError): source.configure(self.root,env)
        result, _, launch, _, _ = self.invoke('css',env)
        argv = launch.call_args.args[1]
        self.assertEqual(result,17)
        self.assertEqual(argv[argv.index('+clientport')+1],'29102')
        self.assertEqual(argv[argv.index('+tv_port')+1],'29101')

    def test_valid_variants_reuse_shared_config_and_keep_advanced_files(self):
        expected = [(self.root/'cstrike/cfg/server.cfg').read_bytes(),(self.root/'cstrike/server.cfg').read_bytes()]
        for game in ('css','cs16','rehlds'):
            with self.subTest(game=game):
                result, update, launch, installer, mods = self.invoke(game,{**self.env(game),'AUTO_UPDATE':'0'})
                self.assertEqual(result,17);update.assert_not_called();installer.install.assert_not_called();mods.install.assert_not_called()
                self.assertIn('fixture-join',launch.call_args.args[4]);self.assertIn('fixture-rcon',launch.call_args.args[4])
        self.assertEqual((self.root/'cstrike/cfg/server.cfg').read_bytes(),expected[0]);self.assertEqual((self.root/'cstrike/server.cfg').read_bytes(),expected[1])

    def test_valid_update_can_restore_missing_payload(self):
        for game in ('css','cs16','rehlds'):
            with self.subTest(game=game):
                target=self.root/('srcds_run' if game=='css' else 'hlds_linux');target.unlink()
                restore=Mock(side_effect=lambda *a,**k:target.write_bytes(b'restored payload'))
                runtime=source if game=='css' else gold
                installer=types.SimpleNamespace(install=restore)
                mods=types.SimpleNamespace(selection=modules.selection,install=restore)
                with patch.object(runtime,'update',restore,create=True),patch.object(runtime,'run',return_value=9),patch.object(gold,'await_native_info'):
                    self.assertEqual(adapter.main(game,self.root,self.env(game),runtime,installer,mods),9)
                restore.assert_called_once();self.assertTrue(target.is_file())

    def test_failed_update_does_not_configure_or_start(self):
        for game in ('css','cs16','rehlds'):
            with self.subTest(game=game):
                runtime=source if game=='css' else gold
                failure=Mock(side_effect=RuntimeError('bounded fixture failure'))
                installer=types.SimpleNamespace(install=failure)
                mods=types.SimpleNamespace(selection=modules.selection,install=failure)
                before=self.snapshot()
                with patch.object(runtime,'update',failure,create=True),patch.object(runtime,'configure') as configure,patch.object(runtime,'run') as launch,self.assertRaises(RuntimeError):
                    adapter.main(game,self.root,self.env(game),runtime,installer,mods)
                configure.assert_not_called();launch.assert_not_called();self.assertEqual(self.snapshot(),before)

    def test_rehlds_module_prerequisites_remain_validated(self):
        installer=types.SimpleNamespace(install=Mock());mods=types.SimpleNamespace(selection=modules.selection,install=Mock())
        with patch.object(gold,'run') as launch,self.assertRaises(ValueError):
            adapter.main('rehlds',self.root,{**self.env('rehlds'),'INSTALL_MODULES':'reapi'},gold,installer,mods)
        installer.install.assert_not_called();mods.install.assert_not_called();launch.assert_not_called()

    def test_wrong_backup_directory_type_refuses_before_acquisition(self):
        target=self.root/'.voltra/goldsrc/config-backups';target.parent.mkdir(parents=True);target.write_text('operator-file')
        before=self.snapshot()
        for game in ('cs16','rehlds'):
            with self.subTest(game=game),self.assertRaises(ValueError):
                adapter.preflight(game,self.root,self.env(game),gold,require_payload=False)
        self.assertEqual(self.snapshot(),before)

    @unittest.skipIf(os.name=='nt','Linux symlink publication boundary; root should run under bounded Linux fixture')
    def test_goldsrc_backup_symlink_cannot_escape_volume(self):
        with tempfile.TemporaryDirectory() as outside:
            state=self.root/'.voltra/goldsrc';state.mkdir()
            (state/'config-backups').symlink_to(outside,target_is_directory=True)
            for game in ('cs16','rehlds'):
                with self.subTest(game=game),self.assertRaises(ValueError):
                    adapter.preflight(game,self.root,self.env(game),gold,require_payload=False)
            self.assertEqual(list(Path(outside).iterdir()),[])

    def test_canonical_entrypoints_acquire_before_invalid_slots_repro(self):
        paths={'css':'source-runtime.py','cs16':'goldsrc-runtime.py','rehlds':'cs16-modules-runtime.py'}
        for game,file in paths.items():
            env={**self.env(game),('MAX_PLAYERS' if game=='css' else 'SRV_SLOTS'):'999','VOLTRA_GOLDSRC_RECIPE':'cs16' if game=='cs16' else 'generic'}
            module=sys.modules['source_install' if game=='css' else 'goldsrc_install' if game=='cs16' else 'cs16_modules_install']
            # The ReHLDS launcher delegates to this installed absolute path.
            managed=self.root/'.voltra/goldsrc_runtime.py';managed.write_bytes((BASE/'goldsrc-runtime.py').read_bytes())
            with self.subTest(game=game),patch.dict(os.environ,env,clear=True),patch.object(Path,'cwd',return_value=self.root),patch.object(module,'update' if game=='css' else 'install') as acquisition,self.assertRaises(ValueError):
                runpy.run_path(str(BASE/file),run_name='__main__')
            acquisition.assert_called_once()


if __name__=='__main__': unittest.main()
