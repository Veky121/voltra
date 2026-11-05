import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, BASE / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


for filename in ('steam-template.py', 'native-console.py', 'goldsrc-runtime.py', 'goldsrc-install.py', 'cs16-gameplay-runtime.py', 'cs16-gameplay-install.py'):
    load(filename[:-3].replace('-', '_'), filename)
g = sys.modules['cs16_gameplay_runtime']
installer = sys.modules['cs16_gameplay_install']


class Gameplay(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for name, data in {'cstrike/server.cfg': b'// operator\r\nmp_freezetime 17\r\nexec custom.cfg\r\n',
                           'cstrike/custom.cfg': b'mp_friendlyfire 1\n', 'cstrike/banned.cfg': b'// ban data\n',
                           'cstrike/listip.cfg': b'// ip ban data\n', 'steamapps/appmanifest_90.acf': b'"AppState" { "buildid" "15961496" }'}.items():
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        (self.root / '.voltra').mkdir()

    def bytes(self):
        return {p.relative_to(self.root).as_posix(): (p.read_bytes(), p.stat().st_mode) for p in self.root.rglob('*') if p.is_file()}

    def receipt(self, values=None):
        receipt = g.snapshot(self.root, values or {**g.DEFAULTS, 'mp_freezetime': '17', 'mp_friendlyfire': '1'})
        (self.root / g.RECEIPT).write_text(json.dumps(receipt))
        return receipt

    def test_existing_legacy_never_automigrates(self):
        before = self.bytes()
        self.assertIsNone(g.plan(self.root))
        self.assertEqual(before, self.bytes())

    def test_explicit_effective_snapshot_preserves_legacy_and_seeds_once(self):
        self.receipt()
        before = self.bytes()
        candidate = g.plan(self.root)
        self.assertIn(b'mp_freezetime 17\n', candidate)
        self.assertIn(b'mp_tkpunish 0\n', candidate)
        self.assertIn(b'mp_autokick 1\n', candidate)
        self.assertIn(b'mp_hostagepenalty 13\n', candidate)
        g.seed_absent(self.root, candidate)
        for name, data in before.items(): self.assertEqual(data, self.bytes()[name])
        path = self.root / g.DOCUMENT
        path.write_bytes(b'// operator removes unwanted controls\r\nmp_freezetime 21\r\n')
        path.chmod(0o640)
        before = self.bytes()
        self.assertIsNone(g.plan(self.root))
        self.assertEqual(before, self.bytes())

    def test_stale_snapshot_refuses_without_writes(self):
        self.receipt()
        (self.root / 'cstrike/custom.cfg').write_bytes(b'mp_freezetime 22\n')
        before = self.bytes()
        with self.assertRaisesRegex(ValueError, 'changed'): g.plan(self.root)
        self.assertEqual(before, self.bytes())

    def test_wrong_build_and_duplicate_json_refuse(self):
        self.receipt()
        manifest = self.root / 'steamapps/appmanifest_90.acf'
        manifest.write_bytes(b'"buildid" "123"')
        with self.assertRaisesRegex(ValueError, 'build'): g.plan(self.root)
        (self.root / g.RECEIPT).write_bytes(b'{"version":1,"version":1}')
        with self.assertRaisesRegex(ValueError, 'Duplicate'): g.plan(self.root)

    def test_executable_and_ambiguous_documents_refuse_before_base_writes(self):
        for text in ('exec server.cfg\n', 'mp_freezetime 3;quit\n', 'mp_freezetime 3\nmp_freezetime 4\n',
                     'mp_freezetime 3\nMP_FREEZETIME 4\n', '"mp_freezetime" 4\n', 'alias x quit\n', 'sv_password 123\n'):
            (self.root / g.DOCUMENT).write_text(text)
            before = self.bytes()
            with patch.object(g.base, 'configure') as configure:
                with self.assertRaises(ValueError): g.configure(self.root, {'VOLTRA_GOLDSRC_RECIPE':'cs16'})
                configure.assert_not_called()
            self.assertEqual(before, self.bytes())

    def test_native_limits_and_injection(self):
        for key, value in [('mp_roundtime','10'),('mp_roundtime','0'),('mp_roundtime','.999999999999999999999999999999'),('mp_freezetime','61'),('mp_buytime','.24'),('mp_startmoney','799'),('mp_forcecamera','3'),('mp_footsteps','2'),('mp_timelimit','nan'),('mp_maxrounds','1e400'),('mp_freezetime','3\nquit')]:
            with self.assertRaises(ValueError): g.values_checked({**g.DEFAULTS,key:value})
        self.assertEqual(g.values_checked({**g.DEFAULTS,'mp_roundtime':'9','mp_freezetime':'60','mp_buytime':'.25'})['mp_roundtime'], '9')

    def test_closed_legacy_chain_refuses_alias_routing_or_unknown_exec_on_every_boot(self):
        self.receipt()
        g.seed_absent(self.root, g.plan(self.root))
        for command in ('alias mp_friendlyfire quit', 'servercfgfile other.cfg', 'exec ../other.cfg',
                        'exec voltra_gameplay.cfg', 'quit', 'exec missing.cfg', 'mp_freezetime 5;quit'):
            (self.root / 'cstrike/custom.cfg').write_text(command+'\n')
            before = self.bytes()
            with patch.object(g.base, 'configure') as base:
                with self.assertRaises(ValueError): g.configure(self.root, {'VOLTRA_GOLDSRC_RECIPE':'cs16'})
                base.assert_not_called()
            self.assertEqual(before, self.bytes())

    def test_include_cycles_refused_without_publication(self):
        (self.root / 'cstrike/custom.cfg').write_text('exec server.cfg\n')
        before = self.bytes()
        with self.assertRaisesRegex(ValueError, 'recursive'): self.receipt()
        self.assertEqual(before, self.bytes())

    def test_native_startup_entrypoints_refuse_unproven_commands(self):
        for relative in ('cstrike/autoexec.cfg','cstrike/valve.rc','cstrike/maps/de_dust2_load.cfg','cstrike/maps/de_dust2_unload.cfg'):
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('alias mp_freezetime quit\n')
            before = self.bytes()
            with self.assertRaises(ValueError): self.receipt()
            self.assertEqual(before, self.bytes())
            target.unlink()

    def test_missing_ban_include_refuses_instead_of_inherited_file_fallback(self):
        (self.root / 'cstrike/server.cfg').write_text('exec listip.cfg\nexec banned.cfg\n')
        for name in ('listip.cfg','banned.cfg'):
            target = self.root / 'cstrike' / name
            previous = target.read_bytes()
            target.unlink()
            before = self.bytes()
            with self.assertRaisesRegex(ValueError, 'Missing CS16 included'): self.receipt()
            self.assertEqual(before, self.bytes())
            target.write_bytes(previous)

    def test_real_publisher_chain_and_native_ban_rows(self):
        capture = Path(__file__).with_name('cs16-vanilla-wave8-publisher-server.cfg')
        self.assertEqual(len(capture.read_bytes()), 441, 'Pinned public15961496 publisher configuration fixture')
        (self.root / 'cstrike/server.cfg').write_bytes(capture.read_bytes())
        (self.root / 'cstrike/banned.cfg').write_text('// preserved\nbanid 0 STEAM_0:1:123456\n')
        (self.root / 'cstrike/listip.cfg').write_text('addip 0 192.0.2.42\n')
        self.receipt()
        before = self.bytes()
        g.seed_absent(self.root, g.plan(self.root))
        for name, data in before.items(): self.assertEqual(data, self.bytes()[name])

    def test_parser_comment_quotes_case_and_controls_agreement(self):
        self.assertEqual(g.parse_document(b'MP_FREEZETIME "12" // tab\there\r\nmp_friendlyfire 1\r\n'), {'mp_freezetime':'12','mp_friendlyfire':'1'})
        for raw in (b'mp_freezetime 12\rmp_friendlyfire 1', b'mp_freezetime 12\vmp_friendlyfire 1',
                    'mp_freezetime 12\u2028mp_friendlyfire 1'.encode(), b'mp_footsteps 1.0\n', b'mp_footsteps +1\n'):
            with self.assertRaises(ValueError): g.parse_document(raw)
        with self.assertRaises(ValueError): g.values_checked({**g.DEFAULTS,'mp_buytime':'.'+'0'*45+'1'})

    def test_invalid_authority_refuses_before_import_or_auto_acquisition(self):
        (self.root / g.DOCUMENT).write_bytes(b'exec malicious.cfg\n')
        with patch.object(g.Path, 'cwd', return_value=self.root), patch.object(g.importlib, 'import_module') as delegate:
            with self.assertRaises(ValueError): g.main()
            delegate.assert_not_called()

    def test_shared_raw_status_not_normalized(self):
        from unittest.mock import Mock
        delegate = Mock()
        delegate.main.return_value = -9
        with patch.object(g.Path, 'cwd', return_value=self.root), patch.object(g.importlib, 'import_module', return_value=delegate):
            self.assertEqual(g.main(), -9)
        self.assertEqual(delegate.main.call_args.args, ('cs16',))
        self.assertIs(delegate.main.call_args.kwargs['runtime'], g)

    def test_symlink_refusal_no_external_write(self):
        outside = self.root / 'outside'
        outside.write_bytes(b'untouched')
        (self.root / g.DOCUMENT).symlink_to(outside)
        with self.assertRaises(ValueError): g.plan(self.root)
        self.assertEqual(outside.read_bytes(), b'untouched')

    def test_concurrent_creation_not_overwritten(self):
        self.receipt()
        candidate = g.plan(self.root)
        (self.root / g.DOCUMENT).write_bytes(b'mp_freezetime 30\n')
        with self.assertRaisesRegex(ValueError, 'appeared'): g.seed_absent(self.root, candidate)
        self.assertEqual((self.root / g.DOCUMENT).read_bytes(), b'mp_freezetime 30\n')

    def test_final_map_wrapper_keeps_managed_suffix_and_base_result(self):
        self.receipt()
        with patch.object(g.base, 'configure', return_value=(['native','-norestart'], {'secret':'native'})):
            result = g.configure(self.root, {'VOLTRA_GOLDSRC_RECIPE':'cs16'})
        self.assertEqual(result, (['native','-norestart'], {'secret':'native'}))
        self.assertEqual((self.root / 'cstrike/voltra_server.cfg').read_text(), g.WRAPPER)
        self.assertEqual(g.WRAPPER.splitlines(), ['exec server.cfg','exec voltra_gameplay.cfg','exec voltra_managed.cfg','servercfgfile voltra_server.cfg'])

    def test_existing_install_preserved_and_no_silent_seed(self):
        before = self.bytes()
        with patch.object(installer.goldsrc_install, 'install') as shared:
            installer.install(self.root, {'VOLTRA_GOLDSRC_RECIPE':'cs16'})
            shared.assert_called_once()
        self.assertEqual(before, self.bytes())

    def test_fresh_reviewed_build_seeds_measured_defaults_only(self):
        import shutil
        shutil.rmtree(self.root / 'cstrike')
        def acquire(root, env, validate): (root / 'cstrike').mkdir()
        with patch.object(installer.goldsrc_install, 'install', side_effect=acquire):
            installer.install(self.root, {'VOLTRA_GOLDSRC_RECIPE':'cs16'})
        self.assertEqual(g.parse_document((self.root / g.DOCUMENT).read_bytes()), g.DEFAULTS)

    def test_unknown_fresh_build_retains_native_defaults(self):
        import shutil
        shutil.rmtree(self.root / 'cstrike')
        (self.root / 'steamapps/appmanifest_90.acf').write_bytes(b'"buildid" "new"')
        def acquire(root, env, validate): (root / 'cstrike').mkdir()
        with patch.object(installer.goldsrc_install, 'install', side_effect=acquire):
            installer.install(self.root, {'VOLTRA_GOLDSRC_RECIPE':'cs16'})
        self.assertFalse((self.root / g.DOCUMENT).exists())


if __name__ == '__main__': unittest.main()
