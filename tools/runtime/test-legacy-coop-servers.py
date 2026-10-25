"""Offline typed configuration/publication fixtures; no actual game assets or runtime."""
import importlib.util
import io
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, BASE / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
load('steam_template', 'steam-template.py')
game = load('legacy_coop_servers', 'legacy-coop-servers.py')
ACK = {'ACKNOWLEDGE_LEGACY_PREREQUISITES': 'true'}


class LegacyTests(unittest.TestCase):
    def league(self, root):
        (root / 'Content').mkdir()
        (root / 'Content/operator-owned-fixture').write_text('fixture-only')
        (root / 'Settings').mkdir()
        (root / 'Settings/GameInfo.json').write_text('{"gameInfo":{"CONTENT_PATH":"old","COOLDOWNS_ENABLED":true,"unknown":42},"players":[],"custom":{"kept":true}}')

    def sit(self, root):
        path = root / 'Aki_Data/Server/configs/http.json'
        path.parent.mkdir(parents=True)
        path.write_text('{"ip":"old","port":6969,"backendUrl":"https://operator-owned.invalid","https":true,"custom":{"kept":true}}')
        return path

    def metadata(self, version='1.6.4', digest=None):
        return {'tag_name': version, 'assets': [{'name': 'SITCoop-' + version + '-linux.tar.gz', 'size': 123, 'digest': digest, 'browser_download_url': 'https://github.com/stayintarkov/SIT.Aki-Server-Mod/releases/download/' + version + '/SITCoop-' + version + '-linux.tar.gz'}]}

    def test_prerequisite_ack_before_build_or_release_network(self):
        with tempfile.TemporaryDirectory() as d, patch.object(game, 'github') as github, patch.object(game, 'build_league') as build:
            for selection in ('league', 'sit'):
                with self.assertRaises(ValueError): game.install(Path(d), selection, {})
            github.assert_not_called()
            build.assert_not_called()

    def test_league_lawful_content_and_native_config_required_without_sample_accounts(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with self.assertRaises(ValueError): game.configure(root, 'league', {})
            self.assertFalse((root / 'Settings/GameInfo.json').exists())

    def test_league_native_unknown_settings_and_players_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.league(root)
            path = root / 'Settings/GameInfo.json'
            path.chmod(0o640)
            game.configure(root, 'league', {'SERVER_PORT': '28010'})
            data = json.loads(path.read_text())
            self.assertEqual(data['players'], [])
            self.assertEqual(data['gameInfo']['unknown'], 42)
            self.assertEqual(data['custom'], {'kept': True})
            self.assertEqual(data['gameInfo']['CONTENT_PATH'], str(root / 'Content'))
            self.assertFalse(json.loads((root / 'Settings/GameServerSettings.json').read_text())['autoStartClient'])
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_sit_http_port_bind_and_unknown_auth_tls_controls_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            path = self.sit(root)
            game.configure(root, 'sit', {'SERVER_PORT': '28011'})
            data = json.loads(path.read_text())
            self.assertEqual(data['ip'], '0.0.0.0')
            self.assertEqual(data['port'], 28011)
            self.assertEqual(data['backendUrl'], 'https://operator-owned.invalid')
            self.assertTrue(data['https'])
            self.assertEqual(data['custom'], {'kept': True})

    def test_latest_exact_tag_and_exact_commit_resolution(self):
        metadata = self.metadata(digest='sha256:' + 'a' * 64)
        for version in ('latest', '1.6.4'):
            with patch.object(game, 'github', return_value=metadata) as github:
                result = game.sit_identity({'SIT_VERSION': version})
                self.assertEqual(result['version'], '1.6.4')
                self.assertEqual(result['sha256'], 'a' * 64)
                self.assertTrue(result['publisher_digest'])
                self.assertIn('releases/latest' if version == 'latest' else 'releases/tags/1.6.4', github.call_args.args)
        commit = 'b' * 40
        with patch.object(game, 'github', side_effect=[[metadata], {'sha': commit}]):
            self.assertEqual(game.sit_identity({'SIT_VERSION': commit})['version'], '1.6.4')

    def test_unknown_version_or_commit_never_falls_back_to_latest(self):
        with patch.object(game, 'github', side_effect=ValueError('missing tag')) as github:
            with self.assertRaises(ValueError): game.sit_identity({'SIT_VERSION': 'does-not-exist'})
            self.assertEqual(github.call_count, 1)
        with patch.object(game, 'github', side_effect=[[self.metadata()], {'sha': 'c' * 40}]):
            with self.assertRaises(ValueError): game.sit_identity({'SIT_VERSION': 'b' * 40})

    def test_checksum_required_no_legacy_unverified_download(self):
        with patch.object(game, 'github', return_value=self.metadata()):
            with self.assertRaises(ValueError): game.sit_identity({})
            identity = game.sit_identity({'SIT_ARCHIVE_SHA256': 'f' * 64})
            self.assertFalse(identity['publisher_digest'])
        with patch.object(game, 'github', return_value=self.metadata(digest='sha256:' + 'a' * 64)):
            with self.assertRaises(ValueError): game.sit_identity({'SIT_ARCHIVE_SHA256': 'f' * 64})

    def test_operator_server_tar_checksum_extraction_and_publication_without_network(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive = root / 'operator-fixture.tar.gz'
            with tarfile.open(archive, 'w:gz') as output:
                for name, data in [('Aki.Server.exe', b'\x7fELFfixture-only-not-a-game'), ('Aki_Data/Server/configs/http.json', b'{"ip":"old","port":6969,"operator":true}')]:
                    entry = tarfile.TarInfo(name)
                    entry.size = len(data)
                    output.addfile(entry, io.BytesIO(data))
            metadata = self.metadata()
            metadata['assets'][0]['size'] = archive.stat().st_size
            env = dict(ACK, SIT_ARCHIVE_PATH=archive.name, SIT_ARCHIVE_SHA256=game.release.sha256(archive))
            with patch.object(game, 'github', return_value=metadata), patch.object(game.release, 'download') as download:
                game.install(root, 'sit', env)
                download.assert_not_called()
            self.assertEqual((root / 'Aki.Server.exe').read_bytes(), b'\x7fELFfixture-only-not-a-game')
            game.configure(root, 'sit', {'SERVER_PORT': '28014'})
            self.assertTrue(json.loads((root / 'Aki_Data/Server/configs/http.json').read_text())['operator'])

    def test_ambiguous_or_external_release_assets_reject(self):
        data = self.metadata(digest='sha256:' + 'a' * 64)
        data['assets'].append(data['assets'][0].copy())
        with patch.object(game, 'github', return_value=data):
            with self.assertRaises(ValueError): game.sit_identity({})

    def test_original_case_insensitive_linux_release_selection_retained(self):
        data = self.metadata(digest='sha256:' + 'a' * 64)
        data['assets'][0]['name'] = 'SITCoop-Linux-x64.tar.gz'
        data['assets'][0]['browser_download_url'] = 'https://github.com/stayintarkov/SIT.Aki-Server-Mod/releases/download/1.6.4/SITCoop-Linux-x64.tar.gz'
        with patch.object(game, 'github', return_value=data):
            self.assertEqual(game.sit_identity({})['asset'], 'SITCoop-Linux-x64.tar.gz')
        data = self.metadata(digest='sha256:' + 'a' * 64)
        data['assets'][0]['browser_download_url'] = 'https://unrelated.invalid/payload.tar.gz'
        with patch.object(game, 'github', return_value=data):
            with self.assertRaises(ValueError): game.sit_identity({})

    def test_github_credentials_only_fixed_https_header_never_url(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, *_): return b'{}'
        class Opener:
            def open(self, req, **kwargs):
                self.request = req
                return Response()
        opener = Opener()
        with patch.object(game.urllib.request, 'build_opener', return_value=opener):
            game.github('stayintarkov/SIT.Aki-Server-Mod', 'releases/latest', {'GITHUB_USER': 'fixture-user', 'GITHUB_OAUTH_TOKEN': 'fixture-secret'})
            self.assertEqual(opener.request.full_url, 'https://api.github.com/repos/stayintarkov/SIT.Aki-Server-Mod/releases/latest')
            self.assertNotIn('fixture-secret', opener.request.full_url)
            self.assertTrue(opener.request.get_header('Authorization').startswith('Basic '))
        with self.assertRaises(ValueError): game.NoRedirect().redirect_request(None, None, 302, None, None, 'https://elsewhere.invalid/')

    def test_port_json_and_github_identity_validation(self):
        for body in ['{"a":1,"a":2}', '[]', '{"a":NaN}']:
            with self.assertRaises(ValueError): game.object_json(body)
        with self.assertRaises(ValueError): game.primary({'SERVER_PORT': '28010', 'VOLTRA_ALLOCATED_PORTS': '28011'})
        with self.assertRaises(ValueError): game.github('../evil/repo', 'releases/latest', {})
        with self.assertRaises(ValueError): game.github('safe/repo', 'releases/latest', {'GITHUB_OAUTH_TOKEN': 'bad\r\nheader'})

    def test_atomic_publication_retains_profiles_mod_config_content_and_metadata(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as s:
            root, stage = Path(d), Path(s)
            names = ['Aki.Server.exe', 'Aki_Data/Server/configs/http.json', 'user/profiles/operator.json', 'user/mods/operator/config.json', 'user/mods/operator/source.js', 'Settings/GameInfo.json', 'Content/operator.json']
            for name in names:
                destination, source = root / name, stage / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                source.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(b'operator-' + name.encode())
                source.write_bytes(b'publisher-' + name.encode())
                destination.chmod(0o640)
                if os.getuid() == 0: os.chown(destination, 988, 988)
            before = {name: ((root / name).read_bytes(), (root / name).stat().st_mode & 0o777, (root / name).stat().st_uid, (root / name).stat().st_gid) for name in names[1:]}
            game.publish_tree(root, stage, {'game': 'sit', 'version': 'fixture'}, 'Aki.Server.exe')
            self.assertEqual((root / 'Aki.Server.exe').read_bytes(), b'publisher-Aki.Server.exe')
            for name, expected in before.items():
                path = root / name
                self.assertEqual((path.read_bytes(), path.stat().st_mode & 0o777, path.stat().st_uid, path.stat().st_gid), expected)
            self.assertEqual((root / 'Aki.Server.exe').stat().st_mode & 0o777, 0o640)

    def test_failed_publication_rolls_back_original_engine_and_receipt(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as s:
            root, stage = Path(d), Path(s)
            (root / 'Aki.Server.exe').write_bytes(b'old-engine')
            (root / 'Aki.Server.exe').chmod(0o750)
            (stage / 'Aki.Server.exe').write_bytes(b'new-engine')
            shared = game._publish
            def failing(root, relative, writer, mode=0o644):
                if relative.endswith('release.json'): raise RuntimeError('fixture receipt failure')
                return shared(root, relative, writer, mode)
            with patch.object(game, '_publish', side_effect=failing):
                with self.assertRaises(RuntimeError): game.publish_tree(root, stage, {'game': 'sit'}, 'Aki.Server.exe')
            self.assertEqual((root / 'Aki.Server.exe').read_bytes(), b'old-engine')
            self.assertEqual((root / 'Aki.Server.exe').stat().st_mode & 0o777, 0o750)

    def test_publication_rejects_symlink_and_archive_traversal(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as s, tempfile.TemporaryDirectory() as outside:
            root, stage = Path(d), Path(s)
            (root / 'Aki.Server.exe').symlink_to(Path(outside) / 'engine')
            (stage / 'Aki.Server.exe').write_bytes(b'new-engine')
            with self.assertRaises(ValueError): game.publish_tree(root, stage, {'game': 'sit'}, 'Aki.Server.exe')
            archive = stage / 'unsafe.tar.gz'
            with tarfile.open(archive, 'w:gz') as output:
                entry = tarfile.TarInfo('../escape')
                entry.size = 1
                output.addfile(entry, io.BytesIO(b'x'))
            with self.assertRaises(ValueError): game.release.extract(archive, stage / 'out', None)

    def test_league_build_uses_fixed_source_packets_and_never_content_submodule(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            calls = []
            def command(argv, cwd, **kwargs):
                calls.append(argv)
                self.assertNotIn('GITHUB_OAUTH_TOKEN', kwargs['env'])
                self.assertNotIn('fixture-secret', ' '.join(argv))
                if argv[:2] == ['dotnet', 'build']:
                    output = cwd / 'GameServerConsole/bin/Debug/net6.0'
                    output.mkdir(parents=True)
                    (output / 'GameServerConsole').write_bytes(b'fixture build artifact')
                    (cwd / 'LICENSE').write_text('fixture AGPL notice')
                    (cwd / 'LeaguePackets/LICENSE').write_text('fixture Apache notice')
            with patch.object(game.subprocess, 'run', side_effect=command): game.build_league(root, root, {'GITHUB_OAUTH_TOKEN': 'fixture-secret'})
            self.assertTrue(any(game.PINS['league']['commit'] in c for c in calls))
            self.assertTrue(any(game.PINS['league']['packets_commit'] in c for c in calls))
            self.assertFalse(any('submodule' in c or any('LeagueSandbox-Default' in part for part in c) for c in calls))
            self.assertFalse((root / 'ready/Settings').exists())

    def test_bundled_sample_profiles_are_never_published(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as s:
            root, stage = Path(d), Path(s)
            (stage / 'Aki.Server.exe').write_bytes(b'fixture engine only')
            profile = stage / 'user/profiles/sample.json'
            profile.parent.mkdir(parents=True)
            profile.write_text('{"fixture":"not a real account"}')
            game.publish_tree(root, stage, {'game': 'sit'}, 'Aki.Server.exe')
            self.assertFalse((root / 'user/profiles/sample.json').exists())

    def test_launch_keeps_native_argv_actual_exit_and_strips_github_secret(self):
        with tempfile.TemporaryDirectory() as d, patch.object(game.console, 'run', return_value=31) as run:
            root = Path(d)
            self.league(root)
            (root / 'GameServerConsole').write_text('fixture-only')
            result = game.launch(root, 'league', dict(ACK, SERVER_PORT='28010', GITHUB_USER='fixture-user', GITHUB_OAUTH_TOKEN='fixture-secret'))
            self.assertEqual(result, 31)
            self.assertEqual(run.call_args.args[1], [str(root / 'GameServerConsole'), '--port', '28010'])
            self.assertNotIn('GITHUB_OAUTH_TOKEN', run.call_args.args[2])
            self.assertIn('fixture-secret', run.call_args.kwargs['credentials'])
            self.assertEqual(run.call_args.kwargs['stop_signal'], signal.SIGINT)

    def test_actual_wrapper_sigint_only_owned_tiny_native_and_retains_exit(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.sit(root)
            executable = root / 'Aki.Server.exe'
            executable.write_text('#!' + sys.executable + '\nimport signal,sys,time\ndef stop(*_):\n print("tiny-native-SIGINT",flush=True)\n sys.exit(29)\nsignal.signal(signal.SIGINT,stop)\nprint("tiny-native-ready",flush=True)\nwhile True:time.sleep(.05)\n')
            executable.chmod(0o700)
            launcher = root / 'wrapper.py'
            launcher.write_text('import importlib.util,sys,os\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location("fixture",' + repr(str(Path(__file__))) + ')\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nsys.exit(m.game.launch(Path(' + repr(d) + '),"sit",dict(os.environ,ACKNOWLEDGE_LEGACY_PREREQUISITES="true")))\n')
            child = subprocess.Popen([sys.executable, '-B', str(launcher)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            output = b''
            try:
                selector = selectors.DefaultSelector()
                selector.register(child.stdout, selectors.EVENT_READ)
                deadline = time.monotonic() + 5
                while b'tiny-native-ready' not in output and time.monotonic() < deadline:
                    if selector.select(.1): output += os.read(child.stdout.fileno(), 65536)
                    if child.poll() is not None: break
                selector.close()
                self.assertIn(b'tiny-native-ready', output)
                child.send_signal(signal.SIGINT)
                tail, _ = child.communicate(timeout=5)
                self.assertIn(b'tiny-native-SIGINT', output + tail)
                self.assertEqual(child.returncode, 29)
            finally:
                if child.poll() is None: child.terminate(); child.communicate(timeout=5)


if __name__ == '__main__': unittest.main()
