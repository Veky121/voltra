import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('factory',Path('internal/panel/game_library/scripts/foundry-factory.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

class Factory(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name).resolve();self.path=self.root/'App.cfg'
        self.env={'SERVER_PORT':'3724','QUERY_PORT':'27015','AUTO_UPDATE':'0','VOLTRA_ALLOCATED_PORTS':'3724,27015','SERVER_NAME':'stale environment'}
        self.content='server_name=operator\nserver_password=secret\nserver_world_name=Factory\nserver_persistent_data_override_folder=Z:'+str(self.root).replace('/','\\')+'\\serverfiles\nmapseed=18446744073709551615\n# operator comment\nunknown=retained\n'
        self.path.write_text(self.content)
    def test_native_authority_and_ports(self):
        argv,secrets=f.configure(self.root,self.env)
        content=self.path.read_text()
        for line in self.content.splitlines(): self.assertIn(line,content)
        self.assertIn('server_port=3724',content);self.assertIn('server_query_port=27015',content)
        self.assertEqual(secrets,['secret']);self.assertEqual(argv[-1],'-log')
    def test_duplicate_rejected_without_write(self):
        self.path.write_text(self.content+'server_name=duplicate\n');before=self.path.read_bytes()
        with self.assertRaises(ValueError):f.configure(self.root,self.env)
        self.assertEqual(before,self.path.read_bytes())
    def test_unsafe_native_paths(self):
        for old,new in [('server_world_name=Factory','server_world_name=../escape'),('\\serverfiles','\\..\\escape')]:
            self.path.write_text(self.content.replace(old,new))
            with self.assertRaises(ValueError):f.configure(self.root,self.env)
    def test_reinstall_does_not_reseed(self):
        with mock.patch.object(f.base,'install') as install,mock.patch.object(f.base,'configure') as seed:
            f.install(self.root,self.env);install.assert_called_once();seed.assert_not_called()
        self.assertEqual(self.path.read_text(),self.content)
    def test_first_install_seeds(self):
        self.path.unlink()
        with mock.patch.object(f.base,'install'),mock.patch.object(f.base,'configure') as seed:
            f.install(self.root,self.env);seed.assert_called_once_with(self.root,'foundry',self.env)
    def test_console_handoff_preserves_crash_code(self):
        console=mock.Mock();console.run.return_value=-9
        with mock.patch.object(f.base,'helper',return_value=console):self.assertEqual(f.run(self.root,self.env),137)
        args,kw=console.run.call_args
        self.assertEqual(args[3],'\x03');self.assertEqual(kw['ready_marker'],b'Dedicated server is now running!');self.assertTrue(kw['terminal_input'])
    def test_invalid_launch_refuses_before_acquisition(self):
        for key, value in [('WINETRICKS_RUN', 'none'), ('XVFB', '0'), ('WINEDEBUG', 'bad\nvalue'), ('QUERY_PORT', '65536')]:
            with self.subTest(key=key), mock.patch.object(f.base, 'install') as acquire:
                before = self.path.read_bytes()
                with self.assertRaises(ValueError): f.install(self.root, dict(self.env, **{key:value}))
                acquire.assert_not_called()
                self.assertEqual(self.path.read_bytes(), before)
    def test_invalid_existing_config_refuses_before_acquisition(self):
        self.path.write_text(self.content + 'server_world_name=duplicate\n')
        before = self.path.read_bytes()
        with mock.patch.object(f.base, 'install') as acquire:
            with self.assertRaises(ValueError): f.install(self.root, self.env)
            acquire.assert_not_called()
        self.assertEqual(self.path.read_bytes(), before)
    def test_preflight_does_not_patch_ports(self):
        before = self.path.read_bytes()
        f.configure(self.root, self.env, preflight=True)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse((self.root/'.voltra').exists())
    def test_crlf_operator_lines_preserved(self):
        content = self.content.replace('\n', '\r\n')
        self.path.write_bytes(content.encode())
        f.configure(self.root, self.env)
        actual = self.path.read_bytes()
        self.assertTrue(actual.startswith(content.encode()))
        self.assertIn(b'server_port=3724\r\n', actual)
    def test_official_publisher_template(self):
        source = Path('artifacts/game-parity-20261029/foundry-owner-20261030/publisher-App.cfg')
        self.assertEqual(f.base.shared.release.sha256(source), f.base.FOUNDRY_CONFIG['sha256'])
        # The official example lacks the provider save override. Never redirect silently.
        self.path.write_bytes(source.read_bytes())
        before = self.path.read_bytes()
        with self.assertRaises(ValueError): f.configure(self.root, self.env)
        self.assertEqual(self.path.read_bytes(), before)
        self.path.write_bytes(before + ('\nserver_persistent_data_override_folder=Z:' + str(self.root).replace('/', '\\') + '\\serverfiles\n').encode())
        f.configure(self.root, self.env)
        self.assertIn('server_name=HappyPlace', self.path.read_text())
    def test_fragment_exact_original_rows(self):
        catalog=json.loads(Path('internal/panel/game_library/upstream/catalog.json').read_text())
        original=next(x['egg'] for x in catalog['entries'] if x['path']=='foundry/egg-foundry.json')
        fragment=json.loads(Path(os.environ.get('FOUNDRY_FRAGMENT', 'artifacts/game-parity-20261029/foundry-profile.json')).read_text())
        self.assertEqual(list(fragment),['foundry/egg-foundry.json'])
        profile=next(iter(fragment.values()))
        self.assertEqual(len(original['variables']), 16);
        if 'FOUNDRY_FRAGMENT' in os.environ:
            self.assertIn(Path('internal/panel/game_library/scripts/foundry-factory.py').read_text(), profile['egg']['scripts']['installation']['script'])
        self.assertEqual(profile['egg']['variables'],original['variables']);self.assertEqual(profile['verification'],'not_verified')

unittest.main()

