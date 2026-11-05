from pathlib import Path
ROOT=Path('/work')
scripts=ROOT/'internal/panel/game_library/scripts'
NATIVE_SOURCE=(scripts/'native-release.py').read_text()
ZIP_SOURCE=(scripts/'native-zip-release.py').read_text()
INSTALL_SOURCE=(scripts/'xonotic-install.py').read_text()
RUNTIME_SOURCE=(ROOT/'artifacts/game-parity-20261029/xonotic-wave8-password-review-runtime.pending.py').read_text()
import hashlib
import io
import json
from pathlib import Path
import stat
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

native = types.ModuleType('native_release'); exec(NATIVE_SOURCE, native.__dict__); sys.modules['native_release'] = native
zipped = types.ModuleType('native_zip_release'); exec(ZIP_SOURCE, zipped.__dict__); sys.modules['native_zip_release'] = zipped
installer = types.ModuleType('xonotic_install'); exec(INSTALL_SOURCE, installer.__dict__)
runtime = types.ModuleType('xonotic_runtime'); exec(RUNTIME_SOURCE, runtime.__dict__)


def package(binary=b'engine', extra=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name, value in {'xonotic-linux64-dedicated': binary, 'data/stock.pk3': b'data', 'COPYING': b'GPL', 'source/engine.c': b'source', **(extra or {})}.items():
            archive.writestr(zipfile.ZipInfo('Xonotic/' + name, date_time=(2020, 1, 1, 0, 0, 0)), value)
    return output.getvalue()


class XonoticInstallerTests(unittest.TestCase):
    def test_darkplaces_quoting_and_config_preserve_native_data(self):
        self.assertEqual(runtime.quoted('literal $name "quote" \\path;value'), '"literal $$name \\"quote\\" \\\\path;value"')
        for value in ['bad\ncommand', 'bad\x00command', 'x' * 256, '\u00e4' * 128]:
            with self.assertRaises(ValueError): runtime.quoted(value)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); folder = root / '.xonotic/data'; folder.mkdir(parents=True)
            (folder / 'server.cfg').write_bytes(b'operator config')
            with zipfile.ZipFile(folder / 'custom.pk3', 'w') as archive:
                archive.writestr('maps/stormkeep.bsp', b'custom map')
            env = {'SERVER_PORT': '23560', 'SERVER_NAME': 'literal $name "quoted"', 'MIN_PLAYERS': '2'}
            argv = runtime.configure(env, root)
            managed = folder / 'voltra-managed.cfg'; before = managed.stat().st_mtime_ns
            self.assertIn('hostname "literal $$name \\"quoted\\""', managed.read_text())
            self.assertIn('rcon_secure 2', managed.read_text())
            self.assertEqual(managed.stat().st_mode & 0o777, 0o600)
            self.assertEqual((root / '.voltra/xonotic/rcon-password').stat().st_mode & 0o777, 0o600)
            self.assertEqual((folder / 'server.cfg').read_bytes(), b'operator config')
            self.assertEqual(runtime.configure(env, root), argv)
            self.assertEqual(managed.stat().st_mtime_ns, before)
            self.assertEqual(argv[argv.index('-userdir') + 1], str(root / '.xonotic'))
            self.assertLess(argv.index('+sv_public'), argv.index('+startmap_dm'))
            self.assertLess(argv.index('+port'), argv.index('+startmap_dm'))
            self.assertLess(argv.index('+startmap_dm'), argv.index('+exec'))
            self.assertLess(argv.index('+exec'), argv.index('+map'))
            for key, value in [('SERVER_NAME', 'bad\\name'), ('RCON_PASSWORD', 'two passwords'), ('MAX_PLAYERS', '100'), ('MIN_PLAYERS', '17'), ('MIN_PLAYERS_PER_TEAM', '17'), ('BOT_JOIN_EMPTY', 'true'), ('GAME_MAP', '../map'), ('GAME_MAP', 'missing'), ('PUBLIC_SERVER', 'true'), ('BOT_SKILL', '11'), ('GAME_TYPE', 'unknown')]:
                with self.assertRaises(ValueError): runtime.configure({**env, key: value}, root)

    def install(self, root, body, fail_receipt=False):
        release = {'version': 'fixture', 'channel': 'release', 'url': 'https://fixture.invalid/release.zip', 'sha512': hashlib.sha512(body).hexdigest()}
        def fetch(url, destination):
            destination.write_bytes(body)
            return hashlib.sha512(body).hexdigest()
        replace = installer.os.replace
        def publish(source, destination):
            if fail_receipt and Path(source).name == 'receipt.json':
                raise OSError('fixture publication failure')
            return replace(source, destination)
        with patch.object(installer, 'resolve_release', return_value=release), patch.object(installer, 'fetch', side_effect=fetch), patch.object(installer.os, 'replace', side_effect=publish):
            installer.install(root, {})

    def test_default_is_pinned_stable_and_invalid_selection_rejected(self):
        with patch.object(installer, 'fetch', side_effect=AssertionError('no network needed')):
            value = installer.resolve_release({})
            self.assertEqual(value['version'], '0.8.6')
            self.assertEqual(value['sha512'], installer.STABLE_SHA512)
            for env in [{'VERSION': '../oops'}, {'UPDATE_CHANNEL': 'other'}]:
                with self.assertRaises(ValueError): installer.resolve_release(env)

    def test_autobuild_checksum_selection(self):
        checksum = 'a' * 128
        with patch.object(installer, 'fetch', return_value=checksum + '  Xonotic-latest.zip\n'):
            self.assertEqual(installer.resolve_release({'UPDATE_CHANNEL': 'autobuild'})['sha512'], checksum)
        for body in ['', checksum + '  wrong.zip\n', (checksum + '  Xonotic-latest.zip\n') * 2]:
            with patch.object(installer, 'fetch', return_value=body):
                with self.assertRaises(ValueError): installer.resolve_release({'UPDATE_CHANNEL': 'autobuild'})

    def test_install_preserves_source_userdata_operator_changes_and_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            userdata = root / '.xonotic/data/server.cfg'; userdata.parent.mkdir(parents=True); userdata.write_bytes(b'private operator config')
            self.install(root, package())
            self.assertEqual((root / 'xonotic/source/engine.c').read_bytes(), b'source')
            self.assertEqual((root / 'xonotic/xonotic-linux64-dedicated').stat().st_mode & 0o777, 0o755)
            (root / 'xonotic/data/custom.pk3').write_bytes(b'custom')
            (root / 'xonotic/data/stock.pk3').write_bytes(b'modified stock')
            self.install(root, package(b'engine two'))
            self.assertEqual((root / 'xonotic/data/stock.pk3').read_bytes(), b'modified stock')
            self.assertEqual((root / 'xonotic/data/custom.pk3').read_bytes(), b'custom')
            self.assertEqual(userdata.read_bytes(), b'private operator config')
            self.assertTrue(list((root / '.voltra/xonotic').glob('previous-*')))
            before = (root / '.voltra/xonotic/release.json').read_bytes()
            self.install(root, package(b'engine two'))
            self.assertEqual(before, (root / '.voltra/xonotic/release.json').read_bytes())

    def test_receipt_publication_failure_rolls_back_engine_and_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); self.install(root, package())
            before = (root / '.voltra/xonotic/release.json').read_bytes()
            with self.assertRaises(OSError): self.install(root, package(b'new engine'), True)
            self.assertEqual((root / 'xonotic/xonotic-linux64-dedicated').read_bytes(), b'engine')
            self.assertEqual((root / '.voltra/xonotic/release.json').read_bytes(), before)

    def test_checksum_failure_has_no_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(installer, 'resolve_release', return_value={'url': 'https://fixture.invalid', 'sha512': 'bad'}), patch.object(installer, 'fetch', return_value='wrong'):
                with self.assertRaises(ValueError): installer.install(root, {})
            self.assertFalse((root / 'xonotic').exists())

    def test_safe_internal_links_and_unsafe_archives(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for target in ['script.sh', '../../../../outside']:
                archive = root / 'release.zip'
                with zipfile.ZipFile(archive, 'w') as out:
                    out.writestr('Xonotic/misc/script.sh', b'publisher script')
                    link = zipfile.ZipInfo('Xonotic/misc/link.sh'); link.create_system = 3; link.external_attr = (stat.S_IFLNK | 0o777) << 16
                    out.writestr(link, target)
                ready = root / ('safe' if target == 'script.sh' else 'unsafe'); ready.mkdir()
                if target == 'script.sh':
                    installer.unpack(archive, ready)
                    self.assertEqual((ready / 'misc/link.sh').read_bytes(), b'publisher script')
                    self.assertFalse((ready / 'misc/link.sh').is_symlink())
                else:
                    with self.assertRaises(ValueError): installer.unpack(archive, ready)

    def test_linux_package_omits_macos_framework_directory_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); archive = root / 'release.zip'; ready = root / 'ready'; ready.mkdir()
            with zipfile.ZipFile(archive, 'w') as out:
                out.writestr('Xonotic/COPYING', b'GPL')
                out.writestr('Xonotic/source/engine.c', b'publisher source')
                link = zipfile.ZipInfo('Xonotic/Xonotic.app/Contents/Frameworks/SDL2.framework/Versions/Current')
                link.create_system = 3; link.external_attr = (stat.S_IFLNK | 0o777) << 16
                out.writestr(link, 'A')
            installer.unpack(archive, ready)
            self.assertFalse((ready / 'Xonotic.app').exists())
            self.assertEqual((ready / 'COPYING').read_bytes(), b'GPL')
            self.assertEqual((ready / 'source/engine.c').read_bytes(), b'publisher source')




class XonoticParityPreflight(unittest.TestCase):
    def prepare(self, root):
        target=root/'xonotic/data';target.mkdir(parents=True)
        with zipfile.ZipFile(target/'stock.pk3','w') as archive:archive.writestr('maps/stormkeep.bsp',b'fixture')
    def snapshot(self, root):
        return [(str(p.relative_to(root)),str(p.readlink()) if p.is_symlink() else p.read_bytes() if p.is_file() else None,p.lstat().st_mode) for p in sorted(root.rglob('*'))]
    def test_invalid_configuration_has_no_credential_or_file_writes(self):
        for extra in [{'SERVER_PASSWORD':'bad\ncommand'},{'RCON_PASSWORD':'bad\ncommand'},{'RCON_PASSWORD':'two words'},{'SERVER_NAME':'x'*256},{'VOLTRA_ALLOCATED_PORTS':'29101'},{'MAX_PLAYERS':'100'},{'GAME_MAP':'missing'}]:
            with self.subTest(extra=extra),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);self.prepare(root);before=self.snapshot(root)
                with self.assertRaises(ValueError):runtime.configure({'SERVER_PORT':'29100',**extra},root)
                self.assertEqual(self.snapshot(root),before)
    def test_unsafe_config_paths_refuse_before_publication(self):
        for relative in ['.xonotic/data/server.cfg','.xonotic/data/voltra-managed.cfg','.voltra/xonotic/rcon-password']:
            with self.subTest(relative=relative),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);self.prepare(root);(root/relative).mkdir(parents=True);before=self.snapshot(root)
                with self.assertRaises(ValueError):runtime.configure({'SERVER_PORT':'29100'},root)
                self.assertEqual(self.snapshot(root),before)
    def test_symlinked_config_parent_cannot_publish_outside(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'owned';root.mkdir();self.prepare(root);outside=Path(directory)/'outside';outside.mkdir();(root/'.xonotic').symlink_to(outside,target_is_directory=True);before=self.snapshot(root)
            with self.assertRaises(ValueError):runtime.configure({'SERVER_PORT':'29100'},root)
            self.assertEqual(self.snapshot(root),before);self.assertEqual(list(outside.iterdir()),[])
    def test_selected_loose_map_symlink_refuses_before_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'owned';root.mkdir();self.prepare(root);outside=Path(directory)/'outside';outside.mkdir();(outside/'stormkeep.bsp').write_bytes(b'outside-map');(root/'xonotic/data/maps').symlink_to(outside,target_is_directory=True);before=self.snapshot(root)
            with self.assertRaises(ValueError):runtime.configure({'SERVER_PORT':'29100'},root)
            self.assertEqual(self.snapshot(root),before);self.assertEqual((outside/'stormkeep.bsp').read_bytes(),b'outside-map')
    def test_existing_credential_validation_precedes_config_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.prepare(root);p=root/'.voltra/xonotic/rcon-password';p.parent.mkdir(parents=True);p.write_text('bad\ncredential');before=self.snapshot(root)
            with self.assertRaises(ValueError):runtime.configure({'SERVER_PORT':'29100'},root)
            self.assertEqual(self.snapshot(root),before)


class XonoticNativeSeedAndSupervisor(unittest.TestCase):
    def test_native_seed_is_initial_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);folder=root/'xonotic/data';folder.mkdir(parents=True)
            with zipfile.ZipFile(folder/'stock.pk3','w') as archive:archive.writestr('maps/stormkeep.bsp',b'fixture')
            original=root/'xonotic/server/server.cfg';original.parent.mkdir();original.write_text('// publisher example\n')
            runtime.configure({'SERVER_PORT':'29100'},root);config=root/'.xonotic/data/server.cfg'
            self.assertEqual(config.read_text(),'// publisher example\n'+runtime.native_seed())
            edited=b'// operator\r\nsv_taunt "0"\r\nexec custom.cfg\r\n'
            config.write_bytes(edited);runtime.configure({'SERVER_PORT':'29100'},root);self.assertEqual(config.read_bytes(),edited)
    def test_actual_shared_supervisor_delegates_stdin_redacts_and_keeps_exit(self):
        import subprocess,os,socket
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'xonotic').mkdir();credential=root/'.voltra/xonotic/rcon-password';credential.parent.mkdir(parents=True);credential.write_text('fixture-generated-rcon')
            worker=root/'worker.py'
            code="import importlib.util,sys,os;from pathlib import Path\n"
            for name,file in [('steam_template',scripts/'steam-template.py'),('native_console',scripts/'native-console.py'),('candidate',ROOT/'artifacts/game-parity-20261029/xonotic-wave8-password-review-runtime.pending.py')]:
                code+=f"spec=importlib.util.spec_from_file_location({name!r},{str(file)!r});mod=importlib.util.module_from_spec(spec);sys.modules[{name!r}]=mod;spec.loader.exec_module(mod)\n"
            code+="raise SystemExit(mod.run(Path(sys.argv[1]),[sys.executable,'-c',sys.argv[2]]))\n";worker.write_text(code)
            with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
            env={**os.environ,'SERVER_PORT':str(port),'SERVER_PASSWORD':'fixture-join-secret'}
            child="import sys;print('fixture-join-secret',flush=True);print(sys.stdin.readline().strip(),flush=True)"
            result=subprocess.run([sys.executable,str(worker),str(root),child],input='quit\n',text=True,capture_output=True,env=env,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr);self.assertIn('quit',result.stdout);self.assertNotIn('fixture-join-secret',result.stdout)
            result=subprocess.run([sys.executable,str(worker),str(root),'import sys;sys.exit(7)'],input='',text=True,capture_output=True,env=env,timeout=10)
            self.assertEqual(result.returncode,7,result.stderr);self.assertIn('[ERROR] Native process exited: raw_status=7',result.stdout)


class XonoticFinalMapReadiness(unittest.TestCase):
    def test_challenge_and_final_map_are_both_required(self):
        prefix=b'\xff\xff\xff\xffinfoResponse\n';body=b'\\challenge\\ownedtoken\\gamename\\Xonotic\\mapname\\stormkeep'
        self.assertTrue(runtime.ready_response(prefix+body,('127.0.0.1',29100),29100,b'ownedtoken','stormkeep'))
        for data in [body.replace(b'ownedtoken',b'ownedtoken-extra'),body.replace(b'stormkeep',b'_init/_init'),body.replace(b'Xonotic',b'other'),body+b'\\mapname\\stormkeep']:
            self.assertFalse(runtime.ready_response(prefix+data,('127.0.0.1',29100),29100,b'ownedtoken','stormkeep'))
        self.assertFalse(runtime.ready_response(prefix+body,('127.0.0.1',29101),29100,b'ownedtoken','stormkeep'))


class XonoticJoinPasswordRefusal(unittest.TestCase):
    def prepare(self,root):
        folder=root/'xonotic/data';folder.mkdir(parents=True)
        with zipfile.ZipFile(folder/'stock.pk3','w') as archive:archive.writestr('maps/stormkeep.bsp',b'fixture')
    def snapshot(self,root):
        return [(str(p.relative_to(root)),str(p.readlink()) if p.is_symlink() else p.read_bytes() if p.is_file() else None,p.lstat().st_mode) for p in sorted(root.rglob('*'))]
    def test_nonblank_join_password_refuses_before_any_write(self):
        for value in ['valid-looking-fixture-password','quoted "value"','unicode-?']:
            with self.subTest(value=value),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);self.prepare(root);before=self.snapshot(root)
                with self.assertRaisesRegex(ValueError,'cannot enforce a join password'):runtime.configure({'SERVER_PORT':'29100','SERVER_PASSWORD':value},root)
                self.assertEqual(self.snapshot(root),before)
    def test_blank_default_does_not_emit_unknown_password_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.prepare(root);runtime.configure({'SERVER_PORT':'29100','SERVER_PASSWORD':''},root)
            data=(root/'.xonotic/data/voltra-managed.cfg').read_text()
            self.assertFalse(any(row.startswith('password ') for row in data.splitlines()))
            self.assertIn('rcon_password ',data);self.assertIn('rcon_secure 2',data)

unittest.main()
