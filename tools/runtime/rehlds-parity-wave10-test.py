import importlib.util
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'


def load(name, file):
    loader = SourceFileLoader(name, str(file))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    loader.exec_module(module)
    return module


for name in ('steam-template', 'native-console', 'native-release', 'goldsrc-runtime', 'goldsrc-install', 'cs16-modules-install', 'counterstrike-preflight'):
    load(name.replace('-', '_'), BASE / (name + '.py'))
adapter = load('rehlds_wave10', BASE / 'rehlds-wave10.py.pending')


class ReHLDSPreflight(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / '.voltra').mkdir()
        self.manifest = self.root / '.voltra/cs16-modules-release.json'
        self.manifest.write_bytes((BASE / 'cs16-modules-release.json').read_bytes())
        (self.root / 'cstrike').mkdir()
        (self.root / 'cstrike/liblist.gam').write_bytes(b'// operator\r\ngamedll_linux "dlls/cs.so"\r\n')
        (self.root / 'cstrike/server.cfg').write_bytes(b'// opaque operator \xff\r\nexec custom.cfg\r\n')
        self.env = {'SERVER_PORT': '29120', 'VOLTRA_ALLOCATED_PORTS': '29120,29121', 'SRCDS_APPID': '90', 'HLDS_GAME': 'cstrike', 'SRCDS_BETAID': 'steam_legacy', 'VERSION': 'latest', 'INSTALL_MODULES': ','.join(adapter.modules.MODULES), 'SRCDS_MAP': 'de_dust2', 'SRV_SLOTS': '32', 'HOSTNAME': 'Fixture', 'AUTO_UPDATE': '0', 'VALIDATE': '0'}

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): (p.read_bytes(), p.stat().st_mode) for p in self.root.rglob('*') if p.is_file() and not p.is_symlink()}

    def test_original_module_defaults_and_version_aliases(self):
        release = adapter.release_plan(self.root)
        for version in ('latest', release['commit'], release['tag']):
            before = self.snapshot()
            with patch.object(adapter.modules, 'install', return_value='delegated') as install:
                self.assertEqual(adapter.install(self.root, {**self.env, 'VERSION': version}), 'delegated')
                install.assert_called_once()
                self.assertEqual(install.call_args.args[2], True)
            self.assertEqual(before, self.snapshot())

    def test_invalid_controls_refuse_before_acquisition(self):
        for change in ({'SRV_SLOTS': '999'}, {'HOSTNAME': 'bad;quit'}, {'PUBLIC_SERVER': '2'}, {'SERVER_PORT': '1'}, {'VOLTRA_ALLOCATED_PORTS': '29120,29120'}, {'SRCDS_APPID': '91'}, {'HLDS_GAME': 'valve'}, {'SRCDS_BETAID': ''}, {'VERSION': 'unreviewed'}, {'INSTALL_MODULES': 'reapi'}, {'INSTALL_MODULES': 'rehlds,rehlds'}, {'AUTO_UPDATE': '2'}, {'VALIDATE': '2'}, {'SRCDS_MAP': '../escape'}, {'VAC_PORT': '29120'}, {'SRV_PINGBOOST': '4'}, {'SYS_TICRATE': '9'}, {'RCON_PASSWORD': 'bad\ncommand'}):
            with self.subTest(change=change):
                before = self.snapshot()
                with patch.object(adapter.modules, 'install') as install, self.assertRaises(ValueError):
                    adapter.install(self.root, {**self.env, **change})
                install.assert_not_called()
                self.assertEqual(before, self.snapshot())

    def test_manifest_changes_fail_before_acquisition(self):
        original = self.manifest.read_bytes()
        base = json.loads(original.decode('utf-8-sig'))
        mutations = [lambda x: x.update(repository='other/untrusted'), lambda x: x.update(commit='mutable'), lambda x: x.update(modules=x['modules'][:-1]), lambda x: x['modules'][0].update(url='http://127.0.0.1/private'), lambda x: x['modules'][0].update(sha256='missing'), lambda x: x['modules'][0].update(bytes=True), lambda x: x['modules'][0].update(path='../escape.zip')]
        for mutate in mutations:
            value = json.loads(json.dumps(base)); mutate(value)
            self.manifest.write_text(json.dumps(value), encoding='utf-8')
            before = self.snapshot()
            with patch.object(adapter.modules, 'install') as install, self.assertRaises(ValueError): adapter.install(self.root, self.env)
            install.assert_not_called(); self.assertEqual(before, self.snapshot())
        self.manifest.write_bytes(original)
        duplicate = original.decode('utf-8-sig').replace('"tag":', '"tag": "first", "tag":', 1)
        self.manifest.write_text(duplicate, encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Duplicate'): adapter.release_plan(self.root)

    def test_existing_registration_ambiguity_refuses_without_writes(self):
        for content in ('GAMEDLL_LINUX "dlls/cs.so"\n', ' gamedll_linux "dlls/cs.so"\n', 'gamedll_linux "a.so"\ngamedll_linux "b.so"\n', 'gamedll_linux "a.so"\x00hidden'):
            (self.root / 'cstrike/liblist.gam').write_bytes(content.encode())
            before = self.snapshot()
            with patch.object(adapter.modules, 'install') as install, self.assertRaises(ValueError): adapter.install(self.root, self.env)
            install.assert_not_called(); self.assertEqual(before, self.snapshot())

    def test_valid_tabbed_registration_and_empty_selection_delegate(self):
        (self.root / 'cstrike/liblist.gam').write_bytes(b'gamedll_linux\t"dlls/cs.so"\r\n')
        with patch.object(adapter.modules, 'install') as install:
            adapter.install(self.root, self.env, validate=False)
            self.assertEqual(install.call_args.args[2], False)
            adapter.install(self.root, {**self.env, 'INSTALL_MODULES': ''})
            self.assertEqual(install.call_count, 2)

    @unittest.skipIf(os.name == 'nt', 'Linux symlink behavior is executed in the bounded Docker fixture')
    def test_unmanaged_game_tree_symlink_refuses_before_download(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside); (target / 'sentinel').write_bytes(b'unchanged')
            (self.root / 'cstrike/dlls').symlink_to(target, target_is_directory=True)
            with patch.object(adapter.modules, 'install') as install, self.assertRaises(ValueError): adapter.install(self.root, self.env)
            install.assert_not_called(); self.assertEqual((target / 'sentinel').read_bytes(), b'unchanged')

    def test_runtime_reuses_existing_supervisor_and_exact_exit(self):
        before = self.snapshot()
        with patch.object(adapter.shared, 'main', return_value=17) as main:
            self.assertEqual(adapter.run(self.root, self.env), 17)
            self.assertEqual(main.call_args.args[0], 'rehlds')
            self.assertIs(main.call_args.kwargs['runtime'], adapter.runtime)
            self.assertIs(main.call_args.kwargs['module_installer'].install, adapter.install)
        self.assertEqual(before, self.snapshot())

    def test_initial_plan_does_not_require_payload_or_decode_opaque_server_cfg(self):
        before = self.snapshot()
        checked, _ = adapter.plan(self.root, self.env)
        self.assertEqual(checked['HLDS_GAME'], 'cstrike')
        self.assertFalse((self.root / 'hlds_linux').exists())
        self.assertEqual(before, self.snapshot())


if __name__ == '__main__': unittest.main()
