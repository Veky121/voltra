#!/usr/bin/env python3
"""Offline, synthetic official-shaped archives. Never launches a game or network."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / 'internal/panel/game_library/scripts/factorio-install.py'
spec = importlib.util.spec_from_file_location('factorio_install', SOURCE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def archive(version='2.1.23', extra=None, machine=62):
    elf = bytearray(64)
    elf[:6] = b'\x7fELF\x02\x01'
    elf[18:20] = machine.to_bytes(2, 'little')
    files = {'bin/x64/factorio': bytes(elf), 'data/base/info.json': json.dumps({'name': 'base', 'version': version}).encode(),
             'data/server-settings.example.json': b'{"name":"default"}', 'data/server-settings.json': b'archive mutable must not publish',
             'config/config.ini': b'archive config must not publish', 'mods/mod-list.json': b'archive mods must not publish',
             'saves/world.zip': b'archive save must not publish'}
    files.update(extra or {})
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:xz') as tar:
        for name, payload in files.items():
            entry = tarfile.TarInfo('factorio/' + name)
            entry.mode = 0o755 if name == 'bin/x64/factorio' else 0o644
            if isinstance(payload, tarfile.TarInfo):
                payload.name = entry.name
                tar.addfile(payload)
            else:
                entry.size = len(payload)
                tar.addfile(entry, io.BytesIO(payload))
    return output.getvalue()


class Transport:
    def __init__(self, payload=None, version='2.1.23'):
        self.payload = payload if payload is not None else archive(version)
        self.version = version
        self.calls = []
        self.checksum = hashlib.sha256(self.payload).hexdigest()
        self.inventory = f'{self.checksum}  factorio-headless_linux_{version}.tar.xz\n'

    def __call__(self, url, destination, limit):
        worker.official(url)
        self.calls.append(url)
        if url == worker.RELEASES:
            value = json.dumps({'stable': {'headless': self.version}, 'experimental': {'headless': self.version}}).encode()
        elif url == worker.SUMS:
            value = self.inventory.encode()
        elif url == f'https://factorio.com/get-download/{self.version}/headless/linux64':
            value = self.payload
        else:
            raise AssertionError('Unexpected endpoint: ' + url)
        if len(value) > limit:
            raise worker.InstallError('Fixture response exceeds limit')
        Path(destination).write_bytes(value)


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'server'
        self.root.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def install(self, transport=None, version='2.1.23', **kwargs):
        return worker.install(self.root, version, transport=transport or Transport(), machine='x86_64', **kwargs)

    def assert_uninstalled(self):
        self.assertFalse((self.root / 'bin').exists())
        self.assertFalse((self.root / '.voltra/factorio-installed.json').exists())

    def test_literal_acquisition_extract_publish(self):
        transport = Transport()
        receipt = self.install(transport)
        self.assertEqual(receipt['version'], '2.1.23')
        self.assertEqual(transport.calls, [worker.SUMS, 'https://factorio.com/get-download/2.1.23/headless/linux64'])
        for name, row in receipt['files'].items():
            self.assertEqual(worker.digest(self.root / name), row['sha256'])
        self.assertFalse((self.root / 'config').exists())
        self.assertFalse((self.root / 'saves').exists())
        self.assertFalse((self.root / 'data/server-settings.json').exists())
        if os.name != 'nt':
            self.assertEqual(stat.S_IMODE((self.root / 'bin/x64/factorio').stat().st_mode), 0o755)

    def test_selectors_resolve_once_and_pin_no_metadata(self):
        for selection in ('stable', 'latest', 'experimental'):
            with self.subTest(selection=selection), tempfile.TemporaryDirectory() as temporary:
                transport = Transport()
                self.assertEqual(worker.resolve(selection, Path(temporary), transport), ('2.1.23', transport.checksum))
                self.assertEqual(transport.calls, [worker.RELEASES, worker.SUMS])
        transport = Transport()
        self.assertEqual(worker.resolve('2.0.77', self.root, transport), (worker.PIN, worker.PIN_SHA))
        self.assertEqual(transport.calls, [])

    def test_invalid_versions_no_network(self):
        for invalid in ('', '../2.0.77', '2.0.77;id', '2.0', '02.0.77', '2.0.77\n', 'STABLE', ' stable', '2.0.77/abc'):
            transport = Transport()
            with self.subTest(invalid=invalid), self.assertRaises(worker.InstallError):
                self.install(transport, invalid)
            self.assertEqual(transport.calls, [])

    def test_unknown_or_duplicate_hash_no_archive_fetch(self):
        for inventory in ('', 'invalid  factorio-headless_linux_2.1.23.tar.xz', Transport().inventory * 2):
            transport = Transport()
            transport.inventory = inventory
            with self.assertRaisesRegex(worker.InstallError, 'Unsupported'):
                self.install(transport)
            self.assertEqual(transport.calls, [worker.SUMS])
            self.assert_uninstalled()

    def test_checksum_failure_no_mutation(self):
        transport = Transport()
        transport.inventory = '0' * 64 + '  factorio-headless_linux_2.1.23.tar.xz\n'
        with self.assertRaisesRegex(worker.InstallError, 'SHA256 mismatch'):
            self.install(transport)
        self.assert_uninstalled()

    def test_cached_archive_verified_no_download(self):
        transport = Transport()
        cache = Path(self.temp.name) / 'cache.tar.xz'
        cache.write_bytes(transport.payload)
        self.install(transport, cache=cache)
        self.assertEqual(transport.calls, [worker.SUMS])
        cache.write_bytes(b'bad cache')
        with self.assertRaisesRegex(worker.InstallError, 'SHA256 mismatch'):
            self.install(Transport(), cache=cache)

    def test_official_redirect_policy(self):
        for url in ('https://factorio.com/get-download/x', 'https://www.factorio.com/a', 'https://dl.factorio.com/a?public-signature=fixture'):
            self.assertEqual(worker.official(url), url)
        for url in ('http://factorio.com/a', 'https://factorio.com.evil.test/a', 'https://evilfactorio.com/a', 'https://u@factorio.com/a', 'https://factorio.com:444/a', 'file:///tmp/archive'):
            with self.subTest(url=url), self.assertRaises(worker.InstallError):
                worker.official(url)
        handler = worker.OfficialRedirect()
        with self.assertRaises(worker.InstallError):
            handler.redirect_request(None, None, 302, '', {}, 'https://evil.test/payload')

    def test_wrong_node_or_payload_architecture(self):
        for architecture, machine in (('x64', 'aarch64'), ('box64', 'x86_64'), ('native-arm', 'aarch64')):
            transport = Transport()
            with self.assertRaisesRegex(worker.InstallError, 'architecture'):
                worker.install(self.root, '2.1.23', architecture, transport, machine=machine)
            self.assertEqual(transport.calls, [])
        with self.assertRaisesRegex(worker.InstallError, 'ELF64'):
            self.install(Transport(archive(machine=183)))
        self.assert_uninstalled()
        result = worker.install(self.root, '2.1.23', 'box64', Transport(), machine='aarch64')
        self.assertEqual(result['payload_architecture'], 'linux-x64')

    def test_archive_paths_links_collisions_version_rejected(self):
        link = tarfile.TarInfo()
        link.type = tarfile.SYMTYPE
        link.linkname = '/tmp/escape'
        for payload in (archive(extra={'../../escape': b'no'}), archive(extra={'data/link': link}),
                        archive(extra={'DATA/base/info.json': b'no'}), archive('2.1.22'),
                        archive(extra={'data/parent': b'file', 'data/parent/child': b'no'})):
            with self.subTest(payload_sha=hashlib.sha256(payload).hexdigest()), self.assertRaises(worker.InstallError):
                self.install(Transport(payload))
            self.assert_uninstalled()

    def test_mutable_bytes_modes_and_legacy_version_preserved(self):
        # Real previous-profile migration has base version metadata but no new receipt.
        preserved = {'saves/world.zip': b'world', 'mods/example.zip': b'mod', 'config/config.ini': b'operator config',
                     'data/server-settings.json': b'operator settings', 'data/map-settings.json': b'map'}
        for name, payload in preserved.items():
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
        legacy = Transport(archive('2.0.77'), '2.0.77')
        archive_path = Path(self.temp.name) / 'legacy.tar.xz'
        archive_path.write_bytes(legacy.payload)
        legacy_stage = Path(self.temp.name) / 'legacy'
        legacy_stage.mkdir()
        for name in worker.extract(archive_path, legacy_stage, '2.0.77'):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(legacy_stage / name, target)
        binary = self.root / 'bin/x64/factorio'
        os.chmod(binary, 0o750)
        expected_mode = stat.S_IMODE(binary.stat().st_mode)
        # Fixture-only override of the reviewed constant to test pinned-cache
        # adoption without acquiring the real archive or weakening production.
        with patch.object(worker, 'PIN_SHA', legacy.checksum):
            self.install(legacy, '2.0.77', cache=archive_path)
        self.assertEqual(legacy.calls, [])
        self.install()
        for name, payload in preserved.items():
            self.assertEqual((self.root / name).read_bytes(), payload)
        self.assertEqual(stat.S_IMODE(binary.stat().st_mode), expected_mode)
        self.assertIn('not_tested', json.loads((self.root / '.voltra/factorio-installed.json').read_text())['compatibility'])

    def test_receipt_owned_modified_binary_data_and_new_collision_refused(self):
        self.install()
        for name in ('bin/x64/factorio', 'data/base/info.json'):
            target = self.root / name
            original = target.read_bytes()
            target.write_bytes(b'operator modified')
            with self.assertRaisesRegex(worker.InstallError, 'operator-modified'):
                self.install()
            self.assertEqual(target.read_bytes(), b'operator modified')
            target.write_bytes(original)
        collision = self.root / 'data/new-publisher-path'
        collision.write_bytes(b'operator')
        with self.assertRaisesRegex(worker.InstallError, 'operator file'):
            self.install(Transport(archive(extra={'data/new-publisher-path': b'publisher'})))
        self.assertEqual(collision.read_bytes(), b'operator')

    def test_legacy_modified_and_cross_version_adoption_denied(self):
        transport = Transport()
        path = Path(self.temp.name) / 'legacy.tar.xz'
        path.write_bytes(transport.payload)
        for name in worker.extract(path, self.root, '2.1.23'):
            self.assertTrue((self.root / name).exists())
        binary = self.root / 'bin/x64/factorio'
        original = binary.read_bytes()
        binary.write_bytes(b'operator custom binary')
        with self.assertRaisesRegex(worker.InstallError, 'differs from the exact verified archive'):
            self.install()
        self.assertEqual(binary.read_bytes(), b'operator custom binary')
        binary.write_bytes(original)
        with self.assertRaisesRegex(worker.InstallError, 'Reinstall its current exact version first'):
            self.install(Transport(archive('2.1.24'), '2.1.24'), '2.1.24')
        self.assertFalse((self.root / '.voltra/factorio-installed.json').exists())

    def test_downgrade_and_unknown_save_version_refused(self):
        self.install()
        before = worker.digest(self.root / 'bin/x64/factorio')
        with self.assertRaisesRegex(worker.InstallError, 'Downgrade refused'):
            self.install(Transport(archive('2.1.22'), '2.1.22'), '2.1.22')
        self.assertEqual(worker.digest(self.root / 'bin/x64/factorio'), before)
        shutil.rmtree(self.root)
        (self.root / 'saves').mkdir(parents=True)
        (self.root / 'saves/world.zip').write_bytes(b'unknown')
        with self.assertRaisesRegex(worker.InstallError, 'no installed-version'):
            self.install()
        self.assert_uninstalled()

    def test_cancellation_and_multi_file_failure_rollback(self):
        self.install()
        snapshot = {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        for point in ('verified', 'before_publish', 'published:bin/x64/factorio', 'published:data/base/info.json', 'before_receipt', 'after_receipt'):
            def cancel(actual):
                if actual == point:
                    raise KeyboardInterrupt('fixture cancellation')
            with self.subTest(point=point), self.assertRaises(KeyboardInterrupt):
                self.install(Transport(archive(extra={'data/extra': b'new'})), hook=cancel)
            current = {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
            self.assertEqual(snapshot, current)
            self.assertFalse((self.root / '.voltra/factorio-transaction').exists())

    def test_crash_recovery_next_process(self):
        self.install()
        old = (self.root / 'bin/x64/factorio').read_bytes()
        transport = Transport(archive(extra={'data/new-publisher-file': b'new'}))
        payload = Path(self.temp.name) / 'payload.tar.xz'
        payload.write_bytes(transport.payload)
        program = '''import importlib.util, pathlib, os, sys
sys.dont_write_bytecode=True
s=importlib.util.spec_from_file_location('i',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
r=pathlib.Path(sys.argv[2]); stage=r/'.crash-stage'; stage.mkdir(); files=m.extract(sys.argv[3],stage,'2.1.23')
def crash(point):
 if point=='published:data/new-publisher-file': os._exit(71)
m.publish(r,stage,files,'2.1.23','2.1.23',m.digest(sys.argv[3]),crash)
'''
        result = subprocess.run([sys.executable, '-c', program, str(SOURCE), str(self.root), str(payload)], capture_output=True)
        self.assertEqual(result.returncode, 71, result.stderr.decode())
        with self.assertRaisesRegex(worker.InstallError, 'requires --recover'):
            self.install()
        worker.recover(self.root)
        self.assertEqual((self.root / 'bin/x64/factorio').read_bytes(), old)
        self.assertFalse((self.root / 'data/new-publisher-file').exists())

    def test_target_lock_and_symlink_denial(self):
        (self.root / '.voltra').mkdir()
        with worker.InstallLock(self.root / '.voltra/factorio-install.lock'):
            with self.assertRaisesRegex(worker.InstallError, 'active'):
                self.install()
        external = Path(self.temp.name) / 'external'
        external.mkdir()
        try:
            (self.root / 'bin').symlink_to(external, target_is_directory=True)
        except OSError:
            return  # Windows without symlink privilege. Linux fixture must exercise this.
        with self.assertRaisesRegex(worker.InstallError, 'symlink'):
            self.install()
        self.assertEqual(list(external.iterdir()), [])

    def test_official_fetch_http_and_body_failure(self):
        class Opener:
            def open(self, *args, **kwargs):
                raise worker.urllib.error.HTTPError('https://factorio.com/a', 404, 'gone', {}, None)
        with patch.object(worker.urllib.request, 'build_opener', return_value=Opener()):
            with self.assertRaisesRegex(worker.InstallError, '404; no fallback'):
                worker.fetch('https://factorio.com/a', self.root / 'archive', 10)
        self.assertFalse((self.root / 'archive').exists())

    def test_truthful_identity_all_official_requests_and_terminal_denial(self):
        calls = []
        class Response(io.BytesIO):
            def geturl(self):
                return 'https://dl.factorio.com/fixture'
        class Opener:
            def open(self, request, **kwargs):
                self_test.assertEqual(request.get_header('User-agent'), 'Voltra-Factorio-Installer/1.0')
                self_test.assertEqual(request.get_method(), 'GET')
                self_test.assertFalse(request.has_header('Authorization'))
                self_test.assertFalse(request.has_header('Cookie'))
                calls.append(request.full_url)
                return Response(b'fixture')
        self_test = self
        with patch.object(worker.urllib.request, 'build_opener', return_value=Opener()):
            for index, url in enumerate([worker.RELEASES, worker.SUMS, 'https://factorio.com/get-download/2.0.77/headless/linux64']):
                worker.fetch(url, self.root / str(index), 64)
        self.assertEqual(len(calls), 3)
        class Denied:
            def open(self, request, **kwargs):
                calls.append(request.full_url)
                raise worker.urllib.error.HTTPError(request.full_url, 403, 'forbidden', {}, None)
        calls.clear()
        with patch.object(worker.urllib.request, 'build_opener', return_value=Denied()):
            with self.assertRaisesRegex(worker.InstallError, '403; no fallback'):
                worker.fetch('https://factorio.com/get-download/2.0.77/headless/linux64', self.root / 'denied', 64)
        self.assertEqual(len(calls), 1)
        self.assertFalse((self.root / 'denied').exists())

    def test_transport_disconnect_and_bounded_body(self):
        transport = Transport()
        def disconnect(url, destination, limit):
            if '/get-download/' in url:
                Path(destination).write_bytes(b'partial')
                raise OSError('fixture connection lost')
            transport(url, destination, limit)
        with self.assertRaisesRegex(OSError, 'connection lost'):
            self.install(disconnect)
        self.assert_uninstalled()
        class Response(io.BytesIO):
            def geturl(self):
                return 'https://dl.factorio.com/fixture'
        class Opener:
            def open(self, *args, **kwargs):
                return Response(b'too large response')
        with patch.object(worker.urllib.request, 'build_opener', return_value=Opener()):
            with self.assertRaisesRegex(worker.InstallError, 'size limit'):
                worker.fetch('https://factorio.com/a', self.root / 'oversized', 3)

    def test_publication_io_failure_and_receipt_directory_fsync_failure(self):
        self.install()
        original_receipt = (self.root / '.voltra/factorio-installed.json').read_bytes()
        before = worker.digest(self.root / 'data/base/info.json')
        original_replace = worker.os.replace
        failed = False
        def replace(source, target):
            nonlocal failed
            if Path(source).as_posix().endswith('data/server-settings.example.json') and not failed:
                failed = True
                raise OSError('fixture publication disk failure')
            return original_replace(source, target)
        with patch.object(worker.os, 'replace', side_effect=replace):
            with self.assertRaisesRegex(OSError, 'disk failure'):
                self.install(Transport(archive(extra={'data/extra': b'new'})))
        self.assertEqual(worker.digest(self.root / 'data/base/info.json'), before)
        self.assertFalse((self.root / 'data/extra').exists())
        original_sync = worker.sync_dir
        failed = False
        renamed = False
        def receipt_replace(source, target):
            nonlocal renamed
            result = original_replace(source, target)
            if str(source).endswith('receipt.tmp'):
                renamed = True
            return result
        def sync(directory):
            nonlocal failed
            if renamed and not failed:
                failed = True
                raise OSError('fixture receipt directory fsync failure')
            return original_sync(directory)
        with patch.object(worker.os, 'replace', side_effect=receipt_replace), patch.object(worker, 'sync_dir', side_effect=sync):
            with self.assertRaisesRegex(OSError, 'directory fsync failure'):
                self.install(Transport(archive(extra={'data/extra': b'new'})))
        self.assertEqual((self.root / '.voltra/factorio-installed.json').read_bytes(), original_receipt)
        self.assertFalse((self.root / 'data/extra').exists())

    def test_obsolete_owned_files_removed_but_modified_files_refused(self):
        self.install(Transport(archive(extra={'data/obsolete': b'old publisher file'})))
        obsolete = self.root / 'data/obsolete'
        obsolete.write_bytes(b'operator edit')
        with self.assertRaisesRegex(worker.InstallError, 'operator-modified'):
            self.install()
        self.assertEqual(obsolete.read_bytes(), b'operator edit')
        obsolete.write_bytes(b'old publisher file')
        self.install()
        self.assertFalse(obsolete.exists())

    def test_staged_profiles_embed_exact_source_and_resolved_updater(self):
        result = subprocess.run(['node', 'tools/runtime/stage-factorio-version-profiles.mjs'], cwd=REPO, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        profiles = json.loads((REPO / '.local/factorio-version-choice/profiles.json').read_text())
        self.assertEqual(len(profiles), 3)
        for name, profile in profiles.items():
            script = profile['egg']['scripts']['installation']['script']
            self.assertIn(SOURCE.read_text(), script)
            self.assertNotIn('This reviewed profile supports Factorio 2.0.77.', script)
            self.assertIn('FACTORIO_VERSION=$(python3 -c', script)
            version = next(v for v in profile['egg']['variables'] if v['env_variable'] == 'FACTORIO_VERSION')
            self.assertEqual(version['default_value'], '2.0.77')
            if 'modupdate' in name:
                self.assertLess(script.index('FACTORIO_VERSION=$(python3 -c'), script.index('bash .voltra/factorio-update-mods.sh "$FACTORIO_VERSION"'))
            if 'a-r-m64' in name:
                self.assertIn('--architecture box64', script)
                self.assertIn('command -v box64', script)
                self.assertIn('box64 ./bin/x64/factorio --', script)

    def test_stager_twice_and_refresh_current_profiles(self):
        program = r'''
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {stageProfiles} from './tools/runtime/stage-factorio-version-profiles.mjs';
const originals=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json','utf8'));
const source=fs.readFileSync('internal/panel/game_library/scripts/factorio-install.py','utf8');
const first=stageProfiles(originals), second=stageProfiles(first), third=stageProfiles(second);
assert.deepEqual(first,second); assert.deepEqual(second,third);
const freshSource=source+'\n# fixture refreshed installer body\n';
const refreshed=stageProfiles(first,freshSource);
assert.deepEqual(refreshed,stageProfiles(refreshed,freshSource));
for(const [key,profile] of Object.entries(refreshed)) {
 const script=profile.egg.scripts.installation.script;
 assert.equal(script.split('# fixture refreshed installer body').length-1,1);
 assert.equal(script.split("installed=$(.voltra/jq -er '.version'").length-1,1);
 assert.equal(script.split('apk add --no-cache')[1].split('\n')[0].split('python3').length-1,1);
 assert.equal(profile.verification,originals[key].verification);
 const rules=profile.egg.variables.find(v=>v.env_variable==='FACTORIO_VERSION').rules;
 assert(rules.startsWith('required|string|regex:/\\A'));
 // API's splitEggRules explicitly supports regex alternatives. Check identical
 // syntax locally with strict JS start/end equivalents, without changing API code.
 const expression=rules.slice('required|string|regex:/'.length,-1).replace('\\A','^').replace('\\z','$(?![\\s\\S])');
 const regex=new RegExp(expression);
 for(const value of ['latest','stable','experimental','2.0.77','0.17.79','2.1.23']) assert(regex.test(value));
 for(const value of ['arbitrary','2.0.77\n','2.0','02.0.77','STABLE','2.0.77;id',' stable']) assert(!regex.test(value));
}
'''
        result = subprocess.run(['node', '--input-type=module', '-e', program], cwd=REPO, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())


if __name__ == '__main__':
    unittest.main(verbosity=2)
