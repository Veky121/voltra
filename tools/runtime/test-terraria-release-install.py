"""Offline synthetic release tests, never native gameplay/acquisition proof."""
import importlib.util
import io
import json
import os
import sys
from pathlib import Path
import stat
import tempfile
import tarfile
import unittest
from unittest import mock
import zipfile

SOURCE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/terraria-release-install.py'
spec = importlib.util.spec_from_file_location('terraria_release', SOURCE)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
sys.modules['terraria_release_install'] = m
tml_spec = importlib.util.spec_from_file_location('tmodloader_runtime', SOURCE.with_name('tmodloader-runtime.py'))
tml = importlib.util.module_from_spec(tml_spec); sys.modules['tmodloader_runtime'] = tml; tml_spec.loader.exec_module(tml)


def release(version='6.1.0', digest='sha256:' + 'a' * 64):
    name = 'TShock-' + version + '-for-Terraria-1.4.5.6-linux-x64-Release.zip'
    return {'tag_name': 'v' + version, 'draft': False, 'prerelease': False, 'assets': [{'name': name, 'size': 1024, 'digest': digest, 'browser_download_url': 'https://github.com/Pryaxis/TShock/releases/download/v' + version + '/' + name}]}


class TerrariaReleaseTests(unittest.TestCase):
    def test_tmodloader_exact_assets_and_actual_runtime_families(self):
        for version, major in [('0.11.8.9', None), ('2023.06.25.36', 6), ('2026.07.1.0', 8)]:
            with self.subTest(version=version), tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);name='tModLoader.Linux.v'+version+'.zip' if major is None else 'tModLoader.zip'
                metadata={'tag_name':'v'+version,'assets':[{'name':name,'size':1024,'digest':None,'browser_download_url':'https://github.com/tModLoader/tModLoader/releases/download/v'+version+'/'+name}]}
                selected=m.resolve('tmodloader',version,'x64',read_metadata=lambda _:metadata)
                self.assertEqual('publisher-HTTPS',selected['assurance']);self.assertTrue(selected['url'].endswith(name))
                content=root/'content';content.mkdir();elf=b'\x7fELF\x02\x01'+b'\0'*12+(62).to_bytes(2,'little')
                def put(name,data):
                    path=content/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
                if major is None:
                    for name in ('tModLoaderServer.exe','mscorlib.dll','System.dll','FNA.dll'):put(name,b'MZfixture')
                    for name in ('monoconfig','monomachineconfig'):put(name,b'fixture')
                    put('lib64/libSDL2-2.0.so.0',elf);put('tModLoaderServer.bin.x86_64',elf)
                else:
                    put('tModLoader.dll',b'MZfixture');put('Libraries/Native/Linux/libSDL2-2.0.so.0',elf)
                    put('tModLoader.runtimeconfig.json',json.dumps({'runtimeOptions':{'tfm':f'net{major}.0','framework':{'name':'Microsoft.NETCore.App','version':f'{major}.0.0'}}}).encode())
                    put('tModLoader.deps.json',b'{"libraries":{"tModLoader/1.4.4.9":{}}}')
                self.assertEqual(content,m.payload(selected,content,root));self.assertEqual(major,selected['runtime_major'])
                if major is None:self.assertEqual(0o755,stat.S_IMODE((content/'tModLoaderServer.bin.x86_64').stat().st_mode)) if os.name=='posix' else None
        with self.assertRaises(ValueError):m.resolve('tmodloader','0.10.1.5','x64',read_metadata=lambda _:self.fail('unsupported family fetched metadata'))

    def test_tmodloader_installer_preflight_before_private6_and_preserves_data(self):
        import types
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);source=root/'archive-source.zip';elf=b'\x7fELF\x02\x01'+b'\0'*12+(62).to_bytes(2,'little')
            with zipfile.ZipFile(source,'w')as archive:
                archive.writestr('tModLoader.dll',b'MZfixture');archive.writestr('Libraries/Native/Linux/libSDL2-2.0.so.0',elf)
                archive.writestr('tModLoader.runtimeconfig.json',json.dumps({'runtimeOptions':{'tfm':'net6.0','framework':{'name':'Microsoft.NETCore.App','version':'6.0.0'}}}))
                archive.writestr('tModLoader.deps.json','{"libraries":{"tModLoader/1.4.4.9":{}}}')
            item={'kind':'tmodloader','version':'2023.06.25.36','arch':'x64','assurance':'publisher-HTTPS'}
            called=[]
            def download(release,path,cache):__import__('shutil').copyfile(source,path);return m.digest(path)
            primitive=types.SimpleNamespace(ensure_runtime=lambda root,arch:called.append(arch)or{'version':'6.0.36'})
            env={'VOLTRA_TERRARIA_KIND':'tmodloader','VERSION':item['version']}
            (root/'serverconfig.txt').mkdir()
            with mock.patch.object(m,'resolve',return_value=dict(item)),mock.patch.dict(sys.modules,{'tshock_runtime':primitive}):
                with self.assertRaises(ValueError):m.install(root,env,download=download,machine='x86_64')
                self.assertEqual([],called);self.assertFalse((root/'tModLoader.dll').exists())
                (root/'serverconfig.txt').rmdir();(root/'serverconfig.txt').write_text('operator config')
                (root/'saves/Worlds').mkdir(parents=True);(root/'saves/Worlds/old.wld').write_bytes(b'world');(root/'saves/Worlds/old.twld').write_bytes(b'modworld')
                m.install(root,env,download=download,machine='x86_64')
                receipt=json.loads((root/'.voltra/terraria-release/release.json').read_text())
                self.assertEqual(6,receipt['runtime_major']);self.assertEqual('6.0.36',receipt['private_runtime']['version'])
                self.assertEqual(['x64'],called);self.assertEqual('operator config',(root/'serverconfig.txt').read_text())
                self.assertEqual(b'world',(root/'saves/Worlds/old.wld').read_bytes());self.assertEqual(b'modworld',(root/'saves/Worlds/old.twld').read_bytes())
    def test_pins_and_input(self):
        for (kind, version, arch), (_, checksum) in m.PINS.items():
            item = m.resolve(kind, version, arch, read_metadata=lambda _: self.fail('pinned metadata network'))
            self.assertEqual(checksum, item['expected_sha256'])
        self.assertEqual('1.4.5.8', m.resolve('vanilla', '1458', 'x64')['version'])
        self.assertEqual('1.4.4.9', m.resolve('vanilla', 'latest', 'x64', read_metadata=lambda _: ['terraria-server-1449.zip'])['version'])
        for bad in ('../6.1.0', '6.1.0;echo', 'vlatest', '', '1\n2'):
            with self.assertRaises(ValueError): m.resolve('tshock', bad, 'x64')

    def test_exact_latest_and_assurance(self):
        for requested in ('6.1.0', 'latest'):
            item = m.resolve('tshock', requested, 'x64', read_metadata=lambda _: release())
            self.assertEqual('6.1.0', item['version']); self.assertEqual('publisher-checksum', item['assurance'])
        item = m.resolve('tshock', '6.1.0', 'x64', read_metadata=lambda _: release(digest=None))
        self.assertIsNone(item['expected_sha256']); self.assertEqual('publisher-HTTPS', item['assurance'])
        item = m.resolve('tshock', '6.1.0', 'x64', 'b' * 64, read_metadata=lambda _: release(digest=None))
        self.assertEqual('operator-checksum', item['assurance'])
        with self.assertRaises(ValueError): m.resolve('tshock', '6.1.0', 'x64', 'b' * 64, read_metadata=lambda _: release())
        with self.assertRaises(ValueError): m.resolve('tshock', '6.1.0', 'x64', read_metadata=lambda _: release('6.0.0'))
        with self.assertRaises(ValueError): m.resolve('tshock', '7.0.0', 'x64', read_metadata=lambda _: release('7.0.0'))

    def test_tshock5_amd64_alias_and_runtime_family(self):
        value=release('5.2.4',digest=None);asset=value['assets'][0];asset['name']=asset['name'].replace('linux-x64','linux-amd64');asset['browser_download_url']=asset['browser_download_url'].replace('linux-x64','linux-amd64')
        plan=m.resolve('tshock','v5.2.4','x64',read_metadata=lambda _:value)
        self.assertEqual(6,plan['runtime_major']);self.assertEqual('publisher-HTTPS',plan['assurance']);self.assertIn('linux-amd64',plan['url'])
        value['assets'].append({**asset,'name':asset['name'].replace('amd64','x64'),'browser_download_url':asset['browser_download_url'].replace('amd64','x64')})
        with self.assertRaises(ValueError):m.resolve('tshock','5.2.4','x64',read_metadata=lambda _:value)
        for version,major,wrong in [('5.2.4',6,9),('6.1.0',9,6)]:
            with tempfile.TemporaryDirectory()as temporary:
                root=Path(temporary);extracted=root/'unpacked';extracted.mkdir()
                def package(runtime_major):
                    runtime={'runtimeOptions':{'tfm':f'net{runtime_major}.0','framework':{'name':'Microsoft.NETCore.App','version':f'{runtime_major}.0.0'}}}
                    elf=b'\x7fELF\x02\x01'+b'\0'*12+(62).to_bytes(2,'little')+json.dumps(runtime).encode()
                    with tarfile.open(extracted/'TShock-fixture.tar','w')as out:
                        member=tarfile.TarInfo('TShock.Server');member.size=len(elf);out.addfile(member,io.BytesIO(elf))
                package(major);release_plan={'kind':'tshock','version':version,'arch':'x64','runtime_major':major};content=m.payload(release_plan,extracted,root)
                self.assertEqual(major,release_plan['runtime_framework']['major']);self.assertTrue((content/'TShock.Server').is_file())
                __import__('shutil').rmtree(root/'content');package(wrong)
                with self.assertRaises(ValueError):m.payload(release_plan,extracted,root)

    def test_publisher_url_and_asset_rejection(self):
        for url in ('http://github.com/a', 'https://evil.example/a', 'https://user:pass@github.com/a', 'https://github.com:444/a'):
            with self.assertRaises(ValueError): m.official(url)
        for transform in (lambda r: r['assets'].append(r['assets'][0]), lambda r: r['assets'][0].update(browser_download_url='https://github.com/wrong/repo/archive.zip'), lambda r: r.update(prerelease=True)):
            value = release(); transform(value)
            with self.assertRaises(ValueError): m.resolve('tshock', '6.1.0', 'x64', read_metadata=lambda _: value)

    def test_archive_traversal_duplicate_special(self):
        with self.assertRaises(ValueError): m.safe_name('a\\b')
        for names in (('../escape',), ('/absolute',), ('A', 'a')):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); archive = root / 'archive.zip'
                with zipfile.ZipFile(archive, 'w') as out:
                    for name in names: out.writestr(name, b'fixture')
                with self.assertRaises(ValueError): m.unpack(archive, root / 'ready')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); archive = root / 'archive.zip'
            with zipfile.ZipFile(archive, 'w') as out:
                entry = zipfile.ZipInfo('link'); entry.external_attr = (stat.S_IFLNK | 0o777) << 16; out.writestr(entry, 'target')
            with self.assertRaises(ValueError): m.unpack(archive, root / 'ready')

    def test_runtime_and_elf_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); config = root / 'runtime.json'
            for major in (8, 9):
                value = {'runtimeOptions': {'tfm': 'net' + str(major) + '.0', 'framework': {'name': 'Microsoft.NETCore.App', 'version': str(major) + '.0.0'}}}
                config.write_text(json.dumps(value)); m.check_runtime(config, major)
                with self.assertRaises(ValueError): m.check_runtime(config, 10)
                binary = root / 'apphost'; binary.write_bytes(b'\x7fELF\x02\x01' + b'\0' * 12 + (62).to_bytes(2, 'little') + json.dumps(value).encode())
                m.check_elf(binary, 'x64'); m.check_bundled_runtime(binary, major)
                with self.assertRaises(ValueError): m.check_elf(binary, 'arm64')

    def test_checksum_failure_and_verified_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); cache = root / 'cache'; cache.mkdir(); payload = b'official-fixture'
            expected = __import__('hashlib').sha256(payload).hexdigest()
            item = {'url': 'https://terraria.org/api/download/pc-dedicated-server/terraria-server-1449.zip', 'expected_sha256': expected, 'bytes': len(payload)}
            opener = mock.Mock(); opener.open.return_value = io.BytesIO(payload)
            with mock.patch.object(m.urllib.request, 'build_opener', return_value=opener):
                self.assertEqual(expected, m.acquire(item, root / 'first.zip', cache))
            with mock.patch.object(m.urllib.request, 'build_opener', side_effect=AssertionError('cache must avoid transport')):
                self.assertEqual(expected, m.acquire(item, root / 'second.zip', cache))
            (cache / expected).write_bytes(b'corrupt')
            with self.assertRaises(ValueError): m.acquire(item, root / 'third.zip', cache)
            opener.open.return_value = io.BytesIO(payload)
            with mock.patch.object(m.urllib.request, 'build_opener', return_value=opener):
                with self.assertRaises(ValueError): m.acquire({**item, 'expected_sha256': 'b' * 64}, root / 'bad.zip', cache)

    def test_tar_links_and_budget_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); archive = root / 'content.tar'
            with tarfile.open(archive, 'w') as out:
                member = tarfile.TarInfo('link'); member.type = tarfile.SYMTYPE; member.linkname = '/outside'; out.addfile(member)
            with self.assertRaises(ValueError): m.unpack(archive, root / 'unpacked', tar=True)
            with zipfile.ZipFile(root / 'big.zip', 'w') as out: out.writestr('large', b'fixture')
            with mock.patch.object(m, 'MAX_UNPACKED', 2):
                with self.assertRaises(ValueError): m.unpack(root / 'big.zip', root / 'unpacked')

    @unittest.skipUnless(os.name == 'posix', 'POSIX symlink and permission semantics')
    def test_operator_symlink_and_modified_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); outside = root / 'outside'; outside.mkdir(); (root / 'saves').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError): m.preflight_operator_paths(root, 'vanilla', {})
            (root / 'saves').unlink()
            state = root / '.voltra/terraria-release'; state.mkdir(parents=True)
            ready = root / 'ready'; ready.mkdir(); (ready / 'runtime').write_bytes(b'first')
            item = {'kind': 'vanilla', 'version': '1.4.4.9'}
            m.publish(root, ready, item, 'a' * 64, state)
            (root / 'runtime').chmod(0o700); (ready / 'runtime').write_bytes(b'second'); (ready / 'runtime').chmod(0o755)
            m.publish(root, ready, item, 'b' * 64, state)
            self.assertEqual(0o700, stat.S_IMODE((root / 'runtime').stat().st_mode))

    def test_publication_preservation_and_rollback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); state = root / '.voltra/terraria-release'; state.mkdir(parents=True)
            ready = root / 'ready'; ready.mkdir(); (ready / 'runtime').write_bytes(b'first'); (ready / 'runtime').chmod(0o755)
            (ready / 'serverconfig.txt').write_text('publisher sample')
            (root / 'serverconfig.txt').write_text('operator config'); (root / 'serverconfig.txt').chmod(0o600)
            config_mode = stat.S_IMODE((root / 'serverconfig.txt').stat().st_mode)
            runtime_mode = stat.S_IMODE((ready / 'runtime').stat().st_mode)
            item = {'kind': 'vanilla', 'version': '1.4.4.9', 'assurance': 'publisher-HTTPS'}
            m.publish(root, ready, item, 'a' * 64, state)
            self.assertEqual('operator config', (root / 'serverconfig.txt').read_text())
            self.assertEqual(config_mode, stat.S_IMODE((root / 'serverconfig.txt').stat().st_mode))
            self.assertEqual(runtime_mode, stat.S_IMODE((root / 'runtime').stat().st_mode))
            (ready / 'runtime').write_bytes(b'second'); (ready / 'z').write_bytes(b'z')
            def fail(name):
                if name == 'z': raise RuntimeError('injected replacement interruption')
            with self.assertRaises(RuntimeError): m.publish(root, ready, item, 'b' * 64, state, fail)
            self.assertEqual(b'first', (root / 'runtime').read_bytes())
            self.assertEqual('a' * 64, json.loads((state / 'release.json').read_text())['archive_sha256'])
            (ready / 'runtime').write_bytes(b'third'); (root / 'runtime').write_bytes(b'operator mutation')
            with self.assertRaises(ValueError): m.publish(root, ready, item, 'b' * 64, state)

    def test_complete_offline_selected_version_install(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def fixture_download(item, destination, cache):
                self.assertEqual('1.4.4.9', item['version'])
                elf = b'\x7fELF\x02\x01' + b'\0' * 12 + (62).to_bytes(2, 'little')
                with zipfile.ZipFile(destination, 'w') as out: out.writestr('1449/Linux/TerrariaServer.bin.x86_64', elf)
                return m.digest(destination)
            m.install(root, {'VOLTRA_TERRARIA_KIND': 'vanilla', 'TERRARIA_VERSION': '1.4.4.9'}, download=fixture_download, machine='x86_64')
            receipt = json.loads((root / '.voltra/terraria-release/release.json').read_text())
            self.assertEqual('1.4.4.9', receipt['version']); self.assertFalse(receipt['native_runtime_verified'])

    def test_invalid_operator_path_precedes_private_framework_publication(self):
        with tempfile.TemporaryDirectory() as temporary, tempfile.TemporaryDirectory() as outside:
            root = Path(temporary)
            (root / 'serverconfig.txt').symlink_to(Path(outside) / 'operator-config')
            selected = {'kind': 'tshock', 'version': '5.2.4', 'runtime_major': 6, 'arch': 'x64'}
            ensure = mock.Mock(side_effect=AssertionError('Private framework must not be published'))
            runtime = __import__('types').SimpleNamespace(ensure_runtime=ensure)
            def download(item, destination, cache):
                destination.write_bytes(b'fixture')
                return 'a' * 64
            with mock.patch.object(m, 'resolve', return_value=selected), mock.patch.object(m, 'unpack'), mock.patch.object(m, 'payload', side_effect=lambda release, extracted, work: extracted), mock.patch.dict(sys.modules, {'tshock_runtime': runtime}):
                with self.assertRaises(ValueError):
                    m.install(root, {'VOLTRA_TERRARIA_KIND': 'tshock', 'TSHOCK_VERSION': '5.2.4', 'MAX_PLAYERS': '8'}, download=download, machine='x86_64')
            ensure.assert_not_called()
            self.assertFalse((Path(outside) / 'operator-config').exists())
            self.assertFalse((root / 'TShock.Server').exists())

    def test_pinned_install_adoption_and_upgrade(self):
        elf = b'\x7fELF\x02\x01' + b'\0' * 12 + (62).to_bytes(2, 'little')
        archives = {}
        for version in ('1.4.5.8', '1.4.4.9'):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as out: out.writestr(version.replace('.', '') + '/Linux/TerrariaServer.bin.x86_64', elf + version.encode())
            archives[version] = buffer.getvalue()
        pinned_hash = __import__('hashlib').sha256(archives['1.4.5.8']).hexdigest()
        pin = ('https://terraria.org/api/download/pc-dedicated-server/terraria-server-1458.zip', pinned_hash)
        for requested in ('1.4.5.8', '1.4.4.9'):
            with self.subTest(version=requested), tempfile.TemporaryDirectory() as temporary, mock.patch.dict(m.PINS, {('vanilla', '1.4.5.8', 'x64'): pin}):
                root = Path(temporary); (root / 'TerrariaServer.bin.x86_64').write_bytes(elf + b'1.4.5.8'); (root / 'serverconfig.txt').write_text('operator')
                def fixture_download(item, destination, cache):
                    destination.write_bytes(archives[item['version']]); return m.digest(destination)
                m.install(root, {'VOLTRA_TERRARIA_KIND': 'vanilla', 'TERRARIA_VERSION': requested}, download=fixture_download, machine='x86_64')
                self.assertEqual(elf + requested.encode(), (root / 'TerrariaServer.bin.x86_64').read_bytes())
                self.assertEqual('operator', (root / 'serverconfig.txt').read_text())
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); ready = root / 'ready'; ready.mkdir(); (ready / 'runtime').write_bytes(b'pin'); (root / 'runtime').write_bytes(b'operator')
            with self.assertRaises(ValueError): m.adopt_pinned(root, ready, {'kind': 'vanilla', 'version': '1.4.5.8', 'arch': 'x64'}, m.PINS[('vanilla','1.4.5.8','x64')][1])

    @unittest.skipUnless(os.name == 'posix', 'Actual Linux fork/interruption and ownership semantics')
    def test_interruption_recovery_after_file_and_receipt_commit(self):
        for checkpoint in ('after:runtime', 'after:receipt'):
            with self.subTest(checkpoint=checkpoint), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); state = root / '.voltra/terraria-release'; state.mkdir(parents=True)
                ready = root / 'ready'; ready.mkdir(); (ready / 'runtime').write_bytes(b'first')
                item = {'kind':'vanilla','version':'1.4.4.9'}; m.publish(root,ready,item,'a'*64,state)
                (root / 'runtime').chmod(0o704)
                if os.geteuid()==0: os.chown(root / 'runtime',1234,2345)
                identity = (root / 'runtime').stat()
                (ready / 'runtime').write_bytes(b'second'); (ready / 'newdir').mkdir(); (ready / 'newdir/newfile').write_bytes(b'new')
                child = os.fork()
                if child == 0:
                    def interrupt(name):
                        if name==checkpoint: os._exit(71)
                    m.publish(root,ready,item,'b'*64,state,interrupt); os._exit(72)
                _,status = os.waitpid(child,0); self.assertEqual(71,os.waitstatus_to_exitcode(status))
                self.assertTrue((state / 'transaction.json').exists()); m.recover(root,state)
                self.assertEqual(b'first',(root / 'runtime').read_bytes())
                restored = (root / 'runtime').stat(); self.assertEqual((identity.st_uid,identity.st_gid,0o704),(restored.st_uid,restored.st_gid,stat.S_IMODE(restored.st_mode)))
                self.assertEqual('a'*64,json.loads((state / 'release.json').read_text())['archive_sha256'])
                self.assertFalse((root / 'newdir').exists()); self.assertFalse((state / 'transaction.json').exists())


if __name__ == '__main__': unittest.main()
