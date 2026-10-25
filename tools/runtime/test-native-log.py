import importlib.util
import io
import fcntl
import os
import subprocess
import sys
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('native_log', Path('internal/panel/game_library/scripts/native-log.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Output:
    def __init__(self):
        self.file = tempfile.TemporaryFile(buffering=0)
        self.buffer = self

    def fileno(self):
        return self.file.fileno()

    def getvalue(self):
        return os.pread(self.fileno(), os.fstat(self.fileno()).st_size, 0)

    def __del__(self):
        self.file.close()


class Error(Output):
    def getvalue(self):
        return super().getvalue().decode('utf8')


class Descriptor:
    def __init__(self, fd):
        self.fd = fd

    def fileno(self):
        return self.fd


class RelayTests(unittest.TestCase):
    def wait(self, predicate):
        end = time.monotonic() + 2
        while not predicate() and time.monotonic() < end:
            time.sleep(.01)
        self.assertTrue(predicate())

    def fixture(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        logs = root / 'Logs_DS'
        logs.mkdir()
        return root, logs

    def test_existing_ready_never_replayed_on_append_and_current_ready_is_forwarded(self):
        root, logs = self.fixture()
        path = logs / 'PlayerLog_old.log'
        path.write_bytes(b'old World is loaded!\n')
        output = Output()
        with patch.object(module.sys, 'stdout', output):
            relay = module.NativeLogRelay(root).start()
            with path.open('ab') as f:
                f.write(b'fresh nonready\n')
            self.wait(lambda: b'fresh nonready' in output.buffer.getvalue())
            self.assertNotIn(b'World is loaded!', output.buffer.getvalue())
            with path.open('ab') as f:
                f.write(b'current World is loaded!\n')
            self.assertTrue(relay.finish())
            self.assertIn(b'current World is loaded!', output.buffer.getvalue())
            self.assertNotIn(b'old ', output.buffer.getvalue())
            self.assertFalse(relay.thread.is_alive())
            self.assertIsNone(relay.root_fd)

    def test_large_history_1205_files_is_metadata_only_and_new_unicode_ready_redacted(self):
        root, logs = self.fixture()
        for i in range(1205):
            (logs / ('PlayerLog_old_%04d.log' % i)).write_bytes(b'historical World is loaded!\n')
        secret = 'private-' + '\u20ac\U0001f600'
        output = Output()
        with patch.object(module.sys, 'stdout', output):
            relay = module.NativeLogRelay(root, credentials=[secret]).start()
            self.assertFalse(relay.failed)
            self.assertEqual(len(relay.states), 1205)
            self.assertEqual(sum(state.active for state in relay.states.values()), 0)
            (logs / 'PlayerLog_current.log').write_bytes(b'\xff\xfe' + ('fresh \U0001f600 ' + secret + '\nWorld is loaded!\n').encode('utf-16-le'))
            self.assertTrue(relay.finish())
        actual = output.buffer.getvalue().decode()
        self.assertNotIn('historical', actual)
        self.assertNotIn(secret, actual)
        self.assertIn('fresh \U0001f600 [redacted]', actual)
        self.assertEqual(actual.count('World is loaded!'), 1)

    def test_quiescent_streams_retire_beyond_sixteen_sequential_rotations(self):
        root, logs = self.fixture()
        output, error = Output(), Error()
        with patch.object(module.sys, 'stdout', output), patch.object(module.sys, 'stderr', error):
            relay = module.NativeLogRelay(root)
            relay.start()
            for index in range(24):
                marker = ('fresh-%02d World is loaded!\n' % index).encode()
                (logs / ('PlayerLog_%02d.log' % index)).write_bytes(marker)
                self.wait(lambda: marker in output.getvalue())
                self.assertEqual(sum(state.active for state in relay.identities.values()), 0)
            self.assertTrue(relay.finish())
        self.assertEqual(error.getvalue(), '')
        self.assertEqual(output.getvalue().count(b'World is loaded!'), 24)

    def test_retired_secret_prefix_survives_append_and_current_ready_flushes_before_finish(self):
        root, logs = self.fixture()
        secret = 'private-prefix-' + '\u20ac\U0001f600'
        output = Output()
        with patch.object(module.sys, 'stdout', output):
            relay = module.NativeLogRelay(root, credentials=[secret]).start()
            path = logs / 'PlayerLog_new.log'
            path.write_bytes(('safe ' + secret[:9]).encode())
            self.wait(lambda: b'safe ' in output.getvalue())
            self.assertNotIn(secret[:9].encode(), output.getvalue())
            self.wait(lambda: relay.states and all(not state.active for state in relay.states.values()))
            with path.open('ab') as stream:
                stream.write((secret[9:] + '\nWorld is loaded!\n').encode())
            self.wait(lambda: b'World is loaded!' in output.getvalue())
            self.assertTrue(relay.finish())
        self.assertNotIn(secret.encode(), output.getvalue())
        self.assertIn(b'[redacted]', output.getvalue())

    def test_active_limit_still_bounds_simultaneously_unread_hot_streams(self):
        root, logs = self.fixture()
        output, error = Output(), Error()
        with patch.object(module.sys, 'stdout', output), patch.object(module.sys, 'stderr', error):
            relay = module.NativeLogRelay(root)
            relay.MAX_ACTIVE = 1
            relay.FILE_READ = 8
            relay.POLL_READ = 16
            relay.INTERVAL = 60
            relay.start()
            (logs / 'PlayerLog_a.log').write_bytes(b'a' * 100)
            (logs / 'PlayerLog_b.log').write_bytes(b'b' * 100)
            self.assertFalse(relay.finish())
        self.assertFalse(relay.thread.is_alive())
        self.assertEqual(error.getvalue(), 'Native log relay unavailable.\n')

    def test_baseline_inode_rename_never_becomes_fresh_history(self):
        root, logs = self.fixture()
        old = logs / 'PlayerLog_a.log'
        old.write_bytes(b'historical World is loaded!\n')
        output = Output()
        with patch.object(module.sys, 'stdout', output):
            relay = module.NativeLogRelay(root).start()
            old.rename(logs / 'PlayerLog_z.log')
            old.write_bytes(b'genuine current World is loaded!\n')
            self.assertTrue(relay.finish())
        self.assertNotIn(b'historical', output.buffer.getvalue())
        self.assertEqual(output.buffer.getvalue().count(b'World is loaded!'), 1)

    def test_thread_start_failure_finish_is_safe_and_idempotent(self):
        root, logs = self.fixture()
        error = Error()
        with patch.object(module.sys, 'stderr', error), patch.object(module.threading.Thread, 'start', side_effect=RuntimeError('PRIVATE ERROR')):
            relay = module.NativeLogRelay(root).start()
            self.assertFalse(relay.finish())
            self.assertFalse(relay.finish())
        self.assertEqual(error.getvalue(), 'Native log relay unavailable.\n')

    def test_utf16_boms_unicode_surrogates_and_secrets_at_every_byte_boundary(self):
        secret = 'credential-' + '\u00e9\u20ac\U0001f600' * 3
        text = 'fresh \u00e9 \U0001f600 ' + secret + '\nWorld is loaded!\n'
        for encoding, bom in [('utf-16-le', b'\xff\xfe'), ('utf-16-be', b'\xfe\xff'), ('utf-8', b'\xef\xbb\xbf'), ('utf-8', b'')]:
            data = bom + text.encode(encoding)
            for split in range(len(data) + 1):
                stream = module._Stream((1, 1), 0, b'', [secret])
                actual = stream.feed(data[:split]) + stream.feed(data[split:]) + stream.feed(b'', final=True)
                self.assertEqual(actual.decode('utf8'), text.replace(secret, '[redacted]'))
            stream = module._Stream((1, 1), 0, b'', [secret])
            actual = b''.join(stream.feed(bytes([byte])) for byte in data) + stream.feed(b'', final=True)
            self.assertNotIn(secret.encode(), actual)
            self.assertIn('[redacted]', actual.decode())
            stream = module._Stream((1, 1), 0, b'', [secret])
            output = []
            for byte in data:
                output.extend([stream.feed(bytes([byte])), stream.quiesce()])
                self.assertFalse(stream.active)
            output.append(stream.feed(b'', final=True))
            self.assertEqual(b''.join(output).decode(), text.replace(secret, '[redacted]'))

    def full_pipe(self):
        read_fd, write_fd = os.pipe()
        self.addCleanup(os.close, read_fd)
        self.addCleanup(os.close, write_fd)
        fill_fd = os.open('/proc/self/fd/%d' % write_fd, os.O_WRONLY | os.O_NONBLOCK)
        try:
            while True:
                os.write(fill_fd, b'padding' * 1024)
        except BlockingIOError:
            # A large atomic write may leave less than PIPE_BUF free. Fill the
            # remaining bytes too so a short native line really sees EAGAIN.
            try:
                while True:
                    os.write(fill_fd, b'x')
            except BlockingIOError:
                pass
        finally:
            os.close(fill_fd)
        return read_fd, write_fd

    def test_full_stdout_and_stderr_pipes_bound_finish_without_mutating_caller_flags(self):
        root, logs = self.fixture()
        _, write_fd = self.full_pipe()
        flags = fcntl.fcntl(write_fd, fcntl.F_GETFL)
        with patch.object(module.sys, 'stdout', Descriptor(write_fd)), patch.object(module.sys, 'stderr', Descriptor(write_fd)):
            relay = module.NativeLogRelay(root)
            relay.INTERVAL = 60
            relay.start()
            (logs / 'PlayerLog_new.log').write_bytes(b'new native World is loaded!\n')
            start = time.monotonic()
            self.assertFalse(relay.finish())
            self.assertLess(time.monotonic() - start, 1)
        self.assertFalse(relay.thread.is_alive())
        self.assertIsNone(relay.root_fd)
        self.assertIsNone(relay.sink)
        self.assertEqual(fcntl.fcntl(write_fd, fcntl.F_GETFL), flags)

    def test_backpressure_subprocess_retains_caller_raw_exit_250(self):
        root, logs = self.fixture()
        _, write_fd = self.full_pipe()
        code = '''import importlib.util, pathlib, sys, fcntl
spec=importlib.util.spec_from_file_location('relay',%r)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
before=fcntl.fcntl(1,fcntl.F_GETFL)
relay=m.NativeLogRelay(%r);relay.INTERVAL=60;relay.start()
pathlib.Path(%r).write_bytes(b'current World is loaded!\\n')
try:
 raw_native_exit=250
finally:
 assert not relay.finish()
 assert not relay.thread.is_alive()
 assert fcntl.fcntl(1,fcntl.F_GETFL)==before
sys.exit(raw_native_exit)
''' % (str(Path(module.__file__).resolve()), str(root), str(logs / 'PlayerLog_child.log'))
        result = subprocess.run([sys.executable, '-B', '-c', code], stdout=write_fd, stderr=subprocess.PIPE, timeout=3)
        self.assertEqual(result.returncode, 250, result.stderr)
        self.assertEqual(result.stderr, b'Native log relay unavailable.\n')

    @unittest.skipUnless(os.geteuid() == 0, 'requires fixture root to spawn actual UID988')
    def test_nonroot_uid988_inherited_root_owned_full_pipe_and_readiness_pipe(self):
        root, logs = self.fixture()
        os.chmod(root, 0o777)
        os.chmod(logs, 0o777)
        _, write_fd = self.full_pipe()
        self.assertEqual(os.fstat(write_fd).st_uid, 0)
        flags = fcntl.fcntl(write_fd, fcntl.F_GETFL)
        code = '''import importlib.util,pathlib,os,fcntl,sys
assert os.geteuid()==988 and os.getegid()==988
assert os.fstat(1).st_uid==0
try:
 fd=os.open('/proc/self/fd/1',os.O_WRONLY|os.O_NONBLOCK)
except PermissionError:
 pass
else:
 os.close(fd);raise AssertionError('fixture must deny DAC reopen')
spec=importlib.util.spec_from_file_location('relay',%r)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
before=fcntl.fcntl(1,fcntl.F_GETFL)
relay=m.NativeLogRelay(%r);relay.INTERVAL=60;relay.start()
pathlib.Path(%r).write_bytes(b'current World is loaded!\\n')
assert not relay.finish()
assert not relay.thread.is_alive()
assert relay.root_fd is None and relay.sink is None
assert fcntl.fcntl(1,fcntl.F_GETFL)==before
sys.exit(250)
''' % (str(Path(module.__file__).resolve()), str(root), str(logs / 'PlayerLog_uid988.log'))
        result = subprocess.run([sys.executable, '-B', '-c', code], stdout=write_fd, stderr=subprocess.PIPE, timeout=3, user=988, group=988, extra_groups=[])
        self.assertEqual(result.returncode, 250, result.stderr)
        self.assertEqual(result.stderr, b'Native log relay unavailable.\n')
        self.assertEqual(fcntl.fcntl(write_fd, fcntl.F_GETFL), flags)
        # Same denied-reopen identity with a writable inherited pipe succeeds.
        code = code.replace('assert not relay.finish()', 'assert relay.finish()').replace('sys.exit(250)', 'sys.exit(0)').replace("PlayerLog_uid988", "PlayerLog_uid988_second")
        code = code.replace(str(logs / 'PlayerLog_uid988.log'), str(logs / 'PlayerLog_uid988_second.log'))
        result = subprocess.run([sys.executable, '-B', '-c', code], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3, user=988, group=988, extra_groups=[])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, b'current World is loaded!\n')
        self.assertEqual(result.stderr, b'')

    def test_regular_sink_appends_without_changing_original_file_flags(self):
        root, logs = self.fixture()
        output = Output()
        os.write(output.fileno(), b'caller prefix\n')
        flags = fcntl.fcntl(output.fileno(), fcntl.F_GETFL)
        with patch.object(module.sys, 'stdout', output):
            relay = module.NativeLogRelay(root).start()
            (logs / 'PlayerLog_new.log').write_bytes(b'actual native suffix\n')
            self.assertTrue(relay.finish())
        self.assertEqual(output.getvalue(), b'caller prefix\nactual native suffix\n')
        self.assertEqual(fcntl.fcntl(output.fileno(), fcntl.F_GETFL), flags)

    def test_existing_utf16_eof_decoder_does_not_emit_bom_or_old_ready(self):
        root, logs = self.fixture()
        path = logs / 'PlayerLog_old.log'
        path.write_bytes(b'\xff\xfe' + 'old World is loaded!\n'.encode('utf-16-le'))
        output = Output()
        with patch.object(module.sys, 'stdout', output):
            relay = module.NativeLogRelay(root).start()
            with path.open('ab') as f:
                f.write('fresh \U0001f600\n'.encode('utf-16-le'))
            self.assertTrue(relay.finish())
        self.assertEqual(output.buffer.getvalue().decode(), 'fresh \U0001f600\n')

    def test_rotation_truncation_new_files_and_multiple_redactors(self):
        root, logs = self.fixture()
        a = logs / 'PlayerLog_a.log'
        a.write_bytes(b'historical World is loaded!\n')
        output = Output()
        with patch.object(module.sys, 'stdout', output):
            relay = module.NativeLogRelay(root, credentials=['sensitive-value']).start()
            a.write_bytes(b'new truncated sensitive-value\n')
            self.wait(lambda: b'new truncated' in output.buffer.getvalue())
            a.unlink()
            a.write_bytes(b'new inode sensitive-value\n')
            (logs / 'PlayerLog_b.log').write_bytes(b'other sensitive-value\n')
            self.assertTrue(relay.finish())
        actual = output.buffer.getvalue()
        self.assertNotIn(b'historical', actual)
        self.assertNotIn(b'sensitive-value', actual)
        self.assertEqual(actual.count(b'[redacted]'), 3)
        self.assertIn(b'new inode', actual)
        self.assertIn(b'other', actual)

    def test_missing_directory_can_appear_after_start(self):
        root, logs = self.fixture()
        logs.rmdir()
        output = Output()
        with patch.object(module.sys, 'stdout', output):
            relay = module.NativeLogRelay(root).start()
            logs.mkdir()
            (logs / 'PlayerLog_new.log').write_bytes(b'actual current ready\n')
            self.assertTrue(relay.finish())
        self.assertIn(b'actual current ready', output.buffer.getvalue())

    def test_unsafe_parents_leaf_fifo_and_paths_fail_without_content(self):
        for unsafe in ['leaf', 'parent', 'fifo', 'absolute', 'traversal']:
            root, logs = self.fixture()
            outside = root / 'outside'
            outside.mkdir()
            payload = outside / 'secret.log'
            payload.write_bytes(b'PRIVATE World is loaded!')
            directory = 'Logs_DS'
            if unsafe == 'leaf':
                (logs / 'PlayerLog_bad.log').symlink_to(payload)
            elif unsafe == 'parent':
                logs.rmdir()
                logs.symlink_to(outside, target_is_directory=True)
            elif unsafe == 'fifo':
                os.mkfifo(logs / 'PlayerLog_bad.log')
            elif unsafe == 'absolute':
                directory = str(outside)
            else:
                directory = '../outside'
            output, error = Output(), Error()
            with patch.object(module.sys, 'stdout', output), patch.object(module.sys, 'stderr', error):
                relay = module.NativeLogRelay(root, relative_directory=directory).start()
                self.assertFalse(relay.finish())
            self.assertEqual(output.buffer.getvalue(), b'')
            self.assertEqual(error.getvalue(), 'Native log relay unavailable.\n')
            self.assertIsNone(relay.root_fd)

    def test_scan_file_and_lifetime_name_limits_fail_closed(self):
        for limit in ['entries', 'files']:
            root, logs = self.fixture()
            count = 5
            for i in range(count):
                (logs / (('unrelated_' if limit == 'entries' else 'PlayerLog_') + str(i) + '.log')).touch()
            with patch.object(module.sys, 'stderr', Error()):
                relay = module.NativeLogRelay(root)
                relay.MAX_ENTRIES = 4
                relay.MAX_FILES = 3
                relay.start()
                self.assertFalse(relay.finish())
        root, logs = self.fixture()
        with patch.object(module.sys, 'stderr', Error()):
            relay = module.NativeLogRelay(root)
            relay.MAX_NAMES = 0
            (logs / 'PlayerLog_a.log').touch()
            relay.start()
            self.assertFalse(relay.finish())

    def test_read_budget_and_final_flush_are_bounded_and_thread_stops(self):
        root, logs = self.fixture()
        output = Output()
        with patch.object(module.sys, 'stdout', output):
            relay = module.NativeLogRelay(root)
            relay.INTERVAL = 60
            relay.FILE_READ = 8
            relay.POLL_READ = 12
            relay.start()
            for i in range(3):
                (logs / ('PlayerLog_%d.log' % i)).write_bytes(b'x' * 100)
            start = time.monotonic()
            self.assertTrue(relay.finish())
            self.assertLess(time.monotonic() - start, .5)
        self.assertEqual(len(output.buffer.getvalue()), 12)
        self.assertFalse(relay.thread.is_alive())
        self.assertTrue(relay.finish())

    def test_bad_encoding_is_safe_diagnostic_and_partial_bom_waits(self):
        root, logs = self.fixture()
        output, error = Output(), Error()
        with patch.object(module.sys, 'stdout', output), patch.object(module.sys, 'stderr', error):
            relay = module.NativeLogRelay(root).start()
            (logs / 'PlayerLog_bad.log').write_bytes(b'\xff\xfe\x00')
            self.assertFalse(relay.finish())
        self.assertNotIn(b'World is loaded!', output.buffer.getvalue())
        self.assertEqual(error.getvalue(), 'Native log relay unavailable.\n')


if __name__ == '__main__':
    unittest.main()
