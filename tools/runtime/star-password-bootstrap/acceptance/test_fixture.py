"""MIT. Actual harmless child fixtures; no Wine, DLL or game execution."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('fixture.py'))
f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)
acquire = f.module('star_acquire_fixture', Path(__file__).with_name('acquire.py'))


class FixtureTests(unittest.TestCase):
    def test_pe_version_resource_exact_and_out_of_range_rejected(self):
        inspection=f.module('star_pe_fixture',Path(__file__).with_name('inspect-payload.py'))
        import struct
        body=bytearray(2048)
        def word(offset,value): struct.pack_into('<H',body,offset,value)
        def dword(offset,value): struct.pack_into('<I',body,offset,value)
        body[:2]=b'MZ';dword(60,128);body[128:132]=b'PE\0\0';word(132,0x8664);word(134,1);word(148,240);word(152,0x20b)
        dword(152+128,0x1000);dword(152+132,1024)
        section=152+240;dword(section+12,0x1000);dword(section+16,1024);dword(section+20,512)
        for offset,key,value in ((0,16,0x80000020),(32,1,0x80000040),(64,1033,96)):
            word(512+offset+14,1);dword(512+offset+16,key);dword(512+offset+20,value)
        dword(512+96,0x1100);dword(512+100,92)
        data=768;word(data,92);word(data+2,52);key='VS_VERSION_INFO'.encode('utf-16-le')+b'\0\0';body[data+6:data+6+len(key)]=key
        fixed=data+40;dword(fixed,0xfeef04bd);dword(fixed+8,5<<16|6);dword(fixed+12,1<<16);dword(fixed+16,5<<16|6);dword(fixed+20,1<<16)
        self.assertEqual(inspection.fixed_versions(body),[{'file_version':[5,6,1,0],'product_version':[5,6,1,0]}])
        with self.assertRaises(ValueError): inspection.fixed_versions(body[:500])
        pristine=bytes(body)
        dword(512+100,10)
        with self.assertRaises(ValueError): inspection.fixed_versions(body)
        body[:]=pristine;word(512+64+14,0)
        with self.assertRaises(ValueError): inspection.fixed_versions(body)
        body[:]=pristine
        word(512+64+14,2);dword(512+88,1034);dword(512+92,112)
        dword(512+112,0x1200);dword(512+116,92)
        body[1024:1116]=pristine[768:860];dword(1024+40+8,5<<16|7)
        with self.assertRaises(ValueError): inspection.fixed_versions(body)
        body[:]=pristine
        dword(512+64+20,1020)
        with self.assertRaises(ValueError): inspection.fixed_versions(body)
        body[:]=pristine
        dword(512+96,0xfffffffe)
        with self.assertRaises(ValueError): inspection.fixed_versions(body)
    def test_installed_depot_ids_are_exact_strings_and_drift_stops(self):
        acf = '"InstalledDepots" { "3809401" { "manifest" "3659990775896995763" "size" "21349240119" } } "SharedDepots" { "228989" "228980" }'
        shared = '"appid" "228980" "StateFlags" "4" "InstalledDepots" { "228989" { "manifest" "5753583882400741046" "size" "25674515" } }'
        self.assertEqual(acquire.verify_manifest(acf, shared)['228989'], '5753583882400741046')
        for main, other in ((acf, shared.replace('5753583882400741046', '5753583882400741047')),
                            (acf, shared + ' "228989" { "manifest" "5753583882400741046" "size" "25674515" }'),
                            (acf, shared.replace('25674515', '25674514')),
                            (acf, shared.replace('"4"', '"6"')),
                            (acf.replace('"228980"', '"228981"'), shared),
                            (acf + ' "SharedDepots" { "228989" "228980" }', shared),
                            ('', shared), (acf, '')):
            with self.assertRaises(ValueError): acquire.verify_manifest(main, other)

    @unittest.skipUnless(os.name == 'posix', 'Production typed-settings module on Linux')
    def test_original_typed_settings_reuse_does_not_launch_or_reset_unknown(self):
        native = f.module('star_native_once_fixture', Path(__file__).with_name('native-once.py'))
        adapter = native.shared_adapter()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root/'DSSettings.txt').write_text('{"operator":"retain"}')
            adapter.configure(root, 'starrupture', {'SERVER_PORT':'28010','SESSION_NAME':'OwnedFixture', 'SAVE_INTERVAL':'60', 'START_NEW':'true','LOAD_SAVE':'false','SAVEGAME_NAME':'AutoSave0.sav'})
            import json
            value = json.loads((root/'DSSettings.txt').read_text())
            self.assertEqual(value['operator'], 'retain')
            self.assertEqual(value['SessionName'], 'OwnedFixture')
            self.assertEqual(value['StartNewGame'], 'true')
            self.assertEqual(value['LoadSavedGame'], 'false')
            self.assertFalse((root/'Password.json').exists())

    @unittest.skipUnless(os.name == 'posix', 'Actual Linux asset ownership/modes')
    def test_mod_private_directory_before_packet_and_existing_assets_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root/Path(f.PINS['binary']).parent).mkdir(parents=True)
            cache = f.HERE.parents[3]/'.local/star-password-bootstrap/public-cache/sha256'
            mod = f.install_assets(root, f.assets(cache))
            self.assertEqual(mod.stat().st_mode&0o777, 0o700)
            f.prepare.private_directory(mod)
            with self.assertRaises(ValueError): f.install_assets(root, f.assets(cache))

    @unittest.skipUnless(os.name == 'posix', 'Actual POSIX signal delivery')
    def test_graceful_interrupt_and_license_prompt_stop_without_acceptance(self):
        with tempfile.TemporaryDirectory() as d:
            result = f.supervise([sys.executable,'-c','import signal,time,sys;signal.signal(signal.SIGINT,lambda *args:sys.exit(0));print("ready",flush=True);time.sleep(10)'],d,dict(os.environ),2,stop_after=.2)
            self.assertEqual(result['raw_exit'],0)
            self.assertTrue(result['graceful_stop_requested'])
            result = f.supervise([sys.executable,'-c','import time;print("Accept the EULA",flush=True);time.sleep(10)'],d,dict(os.environ),2)
            self.assertEqual(result['failure'],'runtime_license_prompt')
            self.assertNotEqual(result['raw_exit'],0)

    def test_engine_marker_stream_boundary_is_static_not_boot(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'not-an-executable'
            path.write_bytes(b'x'*(1024**2-7)+b'++UE5+Release-5.6\0')
            self.assertEqual(acquire.engine_markers(path), ['++UE5+Release-5.6'])
    def test_shared_public_acquisition_argv_is_plan_only(self):
        argv = f.acquisition_plan(Path('/owned'))
        self.assertEqual(argv[argv.index('+login')+1], 'anonymous')
        self.assertLess(argv.index('+@sSteamCmdForcePlatformType'), argv.index('+login'))
        self.assertLess(argv.index('+app_info_print'), argv.index('+app_update'))
        self.assertEqual(argv[argv.index('+app_update')+1], '3809400')
        self.assertEqual(argv[-2:], ['validate', '+quit'])
    def test_exact_reviewed_assets(self):
        cache = f.HERE.parents[3] / '.local/star-password-bootstrap/public-cache/sha256'
        data = f.assets(cache)
        self.assertEqual(len(data), 7)
        for name in ('dwmapi.dll', 'ue4ss/UE4SS.dll'): f.amd64(data[name])
        self.assertNotIn('ue4ss/Mods/mods.txt', data)

    def test_wrong_pin_missing_dll(self):
        with self.assertRaisesRegex(ValueError, 'pin mismatch'):
            f.checked(b'wrong', {'bytes': 5, 'sha256': '0'*64})
        with self.assertRaisesRegex(ValueError, 'Windows payload'): f.amd64(b'')
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(FileNotFoundError):
                f.launch_plan(Path(d).resolve(), 28000, f.PINS['wine_image'])

    def test_environment_never_inherits_secrets_or_installers(self):
        with patch.dict(os.environ, {'ADMIN_PASSWORD': 'secret', 'PLAYER_PASSWORD': 'secret', 'WINETRICKS_RUN': 'vcrun2022', 'ACCEPT_WINDOWS_RUNTIME_LICENSES': 'true'}):
            env = f.environment('/owned')
        self.assertNotIn('ADMIN_PASSWORD', env)
        self.assertNotIn('PLAYER_PASSWORD', env)
        self.assertNotIn('WINETRICKS_RUN', env)
        self.assertNotIn('ACCEPT_WINDOWS_RUNTIME_LICENSES', env)

    def test_allowed_password_controls_and_original_bound(self):
        body = f.prepare.packet('tab\tline\n\r\x7f', 'é')
        f.prepare.validate(body)
        with self.assertRaises(ValueError): f.prepare.packet('a\0b', None)
        with self.assertRaises(ValueError): f.prepare.packet('x'*(f.prepare.MAX_VALUE+1), None)
        with self.assertRaisesRegex(ValueError, 'Aggregate API'):
            f.validate_input(f.prepare.packet('a'*(2*1024**2), 'b'*(2*1024**2)))

    @unittest.skipUnless(os.name == 'posix', 'Actual Linux protected FD boundary')
    def test_fd_input_read_is_aggregate_bounded(self):
        import fcntl
        with tempfile.TemporaryFile() as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(b'x' * (f.MAX_INPUT + 100)); stream.seek(0)
            flags = fcntl.fcntl(stream.fileno(), fcntl.F_GETFL)
            with self.assertRaisesRegex(ValueError, 'Aggregate API'):
                f.protected_input(stream.fileno(), timeout=1)
            self.assertLessEqual(stream.tell(), f.MAX_INPUT + 1)
            self.assertEqual(fcntl.fcntl(stream.fileno(), fcntl.F_GETFL), flags)

    @unittest.skipUnless(os.name == 'posix', 'Actual Linux FIFO/select boundary')
    def test_pipe_delayed_data_and_eof_preserve_original_fd_flags(self):
        import fcntl
        import threading
        import time
        read, write = os.pipe()
        expected = f.prepare.packet('tab\tline\n', 'private')
        original = fcntl.fcntl(read, fcntl.F_GETFL)
        def writer():
            try:
                time.sleep(.03); os.write(write, expected[:9])
                time.sleep(.03); os.write(write, expected[9:])
            finally: os.close(write)
        thread = threading.Thread(target=writer); thread.start()
        try:
            self.assertEqual(f.protected_input(read, timeout=1), expected)
            self.assertEqual(fcntl.fcntl(read, fcntl.F_GETFL), original)
        finally: os.close(read); thread.join(timeout=2)
        self.assertFalse(thread.is_alive())

    @unittest.skipUnless(os.name == 'posix', 'Actual Linux FIFO/select boundary')
    def test_pipe_valid_packet_without_eof_has_deadline(self):
        import fcntl
        import time
        read, write = os.pipe()
        original = fcntl.fcntl(read, fcntl.F_GETFL)
        os.write(write, f.prepare.packet('secret', None))
        started = time.monotonic()
        try:
            with self.assertRaisesRegex(ValueError, 'deadline exceeded'):
                f.protected_input(read, timeout=.1)
            self.assertLess(time.monotonic() - started, 1)
            self.assertEqual(fcntl.fcntl(read, fcntl.F_GETFL), original)
            os.fstat(read)  # Caller still owns an open FD.
        finally: os.close(read); os.close(write)

    @unittest.skipUnless(os.name == 'posix', 'Actual Linux FIFO/select boundary')
    def test_pipe_never_writes_and_cancelled_input_are_bounded(self):
        import fcntl
        import threading
        import time
        read, write = os.pipe()
        original = fcntl.fcntl(read, fcntl.F_GETFL)
        try:
            with self.assertRaisesRegex(ValueError, 'deadline exceeded'):
                f.protected_input(read, timeout=.05)
            cancelled = threading.Event()
            timer = threading.Timer(.03, cancelled.set); timer.start()
            started = time.monotonic()
            try:
                with self.assertRaisesRegex(ValueError, 'cancelled'):
                    f.protected_input(read, timeout=1, cancelled=cancelled)
            finally: timer.join(timeout=2)
            self.assertLess(time.monotonic() - started, .5)
            self.assertEqual(fcntl.fcntl(read, fcntl.F_GETFL), original)
        finally: os.close(read); os.close(write)

    def test_real_child_raw_exit_and_redaction(self):
        with tempfile.TemporaryDirectory() as d:
            result = f.supervise([sys.executable, '-c', "import sys;sys.stdout.buffer.write(b'password-secret');sys.exit(7)"], d, dict(os.environ), 5)
        self.assertEqual(result['raw_exit'], 7)
        self.assertEqual(result['failure'], None)
        self.assertNotIn(b'password-secret', f.redact(result['output'], f.prepare.packet('password-secret', None)))

    def test_actual_child_timeout_and_output_bound(self):
        with tempfile.TemporaryDirectory() as d:
            result = f.supervise([sys.executable, '-c', 'import time;time.sleep(10)'], d, dict(os.environ), .1)
            self.assertEqual(result['failure'], 'timeout')
            self.assertNotEqual(result['raw_exit'], 0)
            result = f.supervise([sys.executable, '-c', "print('x'*10000)"], d, dict(os.environ), 5, 128)
            self.assertEqual(result['failure'], 'output_limit')
            self.assertLessEqual(len(result['output']), 128)

    def test_production_private_packet_boundary(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d); path.chmod(0o700)
            if os.name != 'posix':
                with self.assertRaisesRegex(ValueError, 'Linux node'): f.prepare.stage(path, f.prepare.packet('x', None))
                return
            f.prepare.stage(path, f.prepare.packet('x', None))
            self.assertEqual((path/'request.bin').stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError): f.prepare.stage(path, f.prepare.packet('y', None))

    def test_attempt_unlinks_and_refuses_replay_even_on_spawn_failure(self):
        # Windows has no POSIX private-mode equivalence: these two mocked
        # boundary functions ONLY test orchestration, not security. The Linux
        # packet boundary has separate actual nonroot acceptance already.
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)
            def stage(directory, body): (Path(directory)/'request.bin').write_bytes(body)
            with patch.object(f.prepare, 'private_directory', return_value=path), patch.object(f.prepare, 'stage', side_effect=stage), patch.object(f.os, 'O_NOFOLLOW', getattr(os, 'O_NOFOLLOW', 0), create=True):
                packet = f.prepare.packet('secret', None)
                with self.assertRaises(FileNotFoundError): f.run_once(path, packet, [str(path/'missing-child')], d, dict(os.environ))
                self.assertFalse((path/'request.bin').exists())
                self.assertTrue((path/'acceptance-attempted').exists())
                self.assertEqual(set(packet), {0})
                with self.assertRaises(FileExistsError): f.run_once(path, f.prepare.packet('different', None), [], d, {})

    def test_existing_packet_is_never_deleted_and_missing_dll_is_failure(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)
            with patch.object(f.prepare, 'private_directory', return_value=path), patch.object(f.os, 'O_NOFOLLOW', getattr(os, 'O_NOFOLLOW', 0), create=True):
                request = path/'request.bin'; request.write_bytes(b'operator-original')
                with patch.object(f.prepare, 'stage', side_effect=FileExistsError):
                    with self.assertRaises(FileExistsError): f.run_once(path, f.prepare.packet('x', None), [], d, {})
                self.assertEqual(request.read_bytes(), b'operator-original')
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)
            def stage(directory, body): (Path(directory)/'request.bin').write_bytes(body)
            with patch.object(f.prepare, 'private_directory', return_value=path), patch.object(f.prepare, 'stage', side_effect=stage), patch.object(f.os, 'O_NOFOLLOW', getattr(os, 'O_NOFOLLOW', 0), create=True):
                result = f.run_once(path, f.prepare.packet('x', None), [sys.executable, '-c', "print('err:module:import_dll missing.dll c0000135')"], d, {}, 5)
                self.assertEqual(result['raw_exit'], 0)
                self.assertEqual(result['failure'], 'missing_native_dependency')
                self.assertFalse(result['native_encrypted_files_verified'])


if __name__ == '__main__': unittest.main()
