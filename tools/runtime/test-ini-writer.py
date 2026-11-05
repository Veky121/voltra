"""Offline file fixtures. No server processes, network, Docker or downloads."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[2]
def load(name):
    spec = importlib.util.spec_from_file_location(name, BASE/'internal/panel/game_library/scripts'/(name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

native = load('native-config')
asa = load('arkascended')
astro = load('astroneer-parity')
# TEST ONLY: satisfies IPv4Address.is_global in pure file fixtures. Never used
# for network traffic, discovery, or as an operator PUBLIC_IP default.
TEST_ONLY_PUBLIC_IP = '8.8.8.8'

class Writer(unittest.TestCase):
    def test_staged_profiles_keep_current_metadata(self):
        overrides = json.loads((BASE/'internal/panel/game_library/overrides.json').read_text())
        for recipe, name in [('ark_survival_ascended/egg-ark-survival-ascended.json', 'arkascended'),
                             ('astroneer/egg-astroneer-dedicated-server.json', 'astroneer')]:
            fragment_path = ('resume-wave4-arkascended/profile.json' if name == 'arkascended' else name+'-ini-profile.json')
            fragment = json.loads((BASE/('artifacts/game-parity-20261029/'+fragment_path)).read_text())
            self.assertEqual(list(fragment), [recipe])
            profile = fragment[recipe]
            script = profile['egg']['scripts']['installation']['script']
            self.assertIn('def patch_ini(content, sections, case_insensitive=False):', script)
            self.assertIn('case_insensitive=True', script)
            profile['egg']['scripts']['installation']['script'] = overrides[recipe]['egg']['scripts']['installation']['script']
            self.assertEqual(profile, overrides[recipe])

    def test_default_unchanged(self):
        text = '[url]\nport=1\n'
        self.assertEqual(native.patch_ini(text, {'URL': {'Port': '2'}}), text+'[URL]\nPort = 2\n')

    def test_unique_spelling_comments_arrays_and_missing(self):
        text = '; comment\r\n[url]\r\n  port=1\r\nArray=a\r\nArray=b\r\n'
        self.assertEqual(native.patch_ini(text, {'URL': {'Port': '2', 'Other': '3'}}, True),
                         text.replace('port=1', 'port= 2')+'Other = 3\r\n')

    def test_unicode(self):
        self.assertEqual(native.patch_ini('[Straße]\nς=1\n', {'STRASSE': {'Σ': '2'}}, True), '[Straße]\nς= 2\n')

    def test_fail_closed_bytes(self):
        cases = [('[URL]\nPort=1\nport=2\n', {'URL': {'Port': '3'}}),
                 ('[url]\nPort=1\n[URL]\nOther=2\n', {'URL': {'Port': '3'}}),
                 ('[URL]\nStraße=1\nSTRASSE=2\n', {'URL': {'strasse': '3'}}),
                 ('[URL]\n', {'URL': {'Port': '1', 'port': '2'}}),
                 ('[URL]\n', {'URL': {}, 'url': {}})]
        for text, sections in cases:
            with self.subTest(text=text), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); path = root/'file.ini'; path.write_bytes(text.encode())
                with self.assertRaises(ValueError):
                    native.configure_ini(root, path, sections, root/'backups', True)
                self.assertEqual(path.read_bytes(), text.encode())
                self.assertFalse((root/'backups').exists())

    def test_asa_wrapper_restores(self):
        env = {'SERVER_PORT': '7777', 'VOLTRA_ALLOCATED_PORTS': '7777,7778,37015',
               'RCON_PORT': '37015', 'ARK_ADMIN_PASSWORD': 'fixture-password'}
        original = asa.ark.native.patch_ini
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); path = root/asa.CONFIG; path.parent.mkdir(parents=True)
            path.write_text('[serversettings]\nserveradminpassword=fixture-password\n')
            asa.configure(root, env)
            self.assertEqual(path.read_text().lower().count('serveradminpassword'), 1)
            path.write_bytes(b'[ServerSettings]\nServerPVE=True\nserverpve=False\n')
            before = path.read_bytes()
            with self.assertRaises(ValueError): asa.configure(root, env)
            self.assertEqual(path.read_bytes(), before)
        self.assertIs(asa.ark.native.patch_ini, original)

    def test_astro_two_files_validate_before_write(self):
        env = {'PUBLIC_IP': TEST_ONLY_PUBLIC_IP, 'OWNER_NAME': 'Owner', 'OWNER_GUID': '0',
               'SERVER_PORT': '8777', 'VOLTRA_ALLOCATED_PORTS': '8777'}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); base = root/'Astro/Saved/Config/WindowsServer'; base.mkdir(parents=True)
            settings = base/'AstroServerSettings.ini'; engine = base/'Engine.ini'
            settings.write_text('['+astro.SECTION.lower()+']\nownername=Existing\nPlayerProperties=a\nPlayerProperties=b\n')
            engine.write_text('[url]\nport=1\n')
            astro.configure(root, env)
            self.assertIn('[url]\nport= 8777', engine.read_text())
            self.assertEqual(settings.read_text().lower().count('['+astro.SECTION.lower()+']'), 1)
            self.assertIn('PlayerProperties=a\nPlayerProperties=b\n', settings.read_text())
            self.assertIn('ownername=Existing', settings.read_text())
            engine.write_bytes(b'[url]\nport=1\nPort=2\n')
            before = settings.read_bytes(), engine.read_bytes()
            with self.assertRaises(ValueError): astro.configure(root, env)
            self.assertEqual(before, (settings.read_bytes(), engine.read_bytes()))

    def test_astro_invalid_public_ip_preserves_both_files(self):
        for address in ('', '192.0.2.1', '127.0.0.1', '10.0.0.1', '224.0.0.1', '::1', 'invalid'):
            with self.subTest(address=address), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); base = root/'Astro/Saved/Config/WindowsServer'; base.mkdir(parents=True)
                settings = base/'AstroServerSettings.ini'; engine = base/'Engine.ini'
                settings.write_bytes(('['+astro.SECTION+']\nPublicIP='+address+'\n; operator\nPlayerProperties=a\nPlayerProperties=b\n').encode())
                engine.write_bytes(b'[URL]\nPort=8777\n; operator engine\n')
                before = settings.read_bytes(), engine.read_bytes()
                env = {'PUBLIC_IP': address, 'OWNER_NAME': 'Owner', 'OWNER_GUID': '0',
                       'SERVER_PORT': '8777', 'VOLTRA_ALLOCATED_PORTS': '8777'}
                with self.assertRaises(ValueError): astro.configure(root, env)
                self.assertEqual(before, (settings.read_bytes(), engine.read_bytes()))

if __name__ == '__main__': unittest.main()
