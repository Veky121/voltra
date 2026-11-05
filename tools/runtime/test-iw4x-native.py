import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import json
import re
import threading
import types

spec = importlib.util.spec_from_file_location('iw4x', 'internal/panel/game_library/scripts/iw4x-native.py')
iw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(iw)


class IW4x(unittest.TestCase):
    def test_publisher_shaped_config(self):
        value = '// native config\r\nset sv_hostname "old" // hostname\r\nset g_password ""\r\nset g_log "logs/games_mp.log"\r\nset sv_mapRotation "gametype war map mp_rust"\r\nexec bans.cfg\r\n'
        patched = iw.patch(value, 'new', 'private')
        self.assertIn('set sv_hostname "new" // hostname\r\n', patched)
        self.assertIn('set g_password "private"\r\n', patched)
        self.assertTrue(patched.endswith(value[value.index('set g_log'):]))

    def test_case_aliases_and_archived_commands(self):
        self.assertIn('set sv_hostname "new"', iw.patch('SeTa SV_HOSTNAME "old"\n', 'new', ''))
        for value in ('set sv_hostname "a"\nsets SV_HOSTNAME "b"\n', 'g_password\n', 'set g_password "a" extra\n'):
            with self.assertRaises(ValueError):
                iw.patch(value, 'new', '')

    def test_chains_quotes_comments(self):
        for value in ('set sv_hostname "x"; quit\n', 'set x "unterminated\n', '/* set sv_hostname "old" */\n', 'set x "a"\x00'):
            with self.assertRaises(ValueError):
                iw.patch(value, 'new', '')
        self.assertIn('set x "https://host/a;b"', iw.patch('set x "https://host/a;b" // comment\n', 'new', ''))

    def test_refusal_does_not_touch_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / 'operator.cfg'
            config.write_bytes(b'private operator state')
            with self.assertRaises(ValueError):
                iw.preflight(root, {'INSTALL_MODE': 'steam'})
            self.assertEqual(config.read_bytes(), b'private operator state')
            self.assertEqual(list(root.iterdir()), [config])

    def test_internal_and_external_links_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'actual').mkdir()
            try:
                (root / 'userraw').symlink_to(root / 'actual', target_is_directory=True)
            except OSError as error:
                if getattr(error, 'winerror', None) == 1314:
                    self.skipTest('Windows symlink privilege absent; prior Linux refusal proof retained')
                raise
            with self.assertRaisesRegex(ValueError, 'links'):
                iw.preflight(root, {})

    def test_preflight_config_authority(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'userraw').mkdir()
            config = root/'userraw/server.cfg'
            for content in ('exec other.cfg', 'vstr rotate', 'set fs_game mods/other', 'set x 1; quit'):
                config.write_text('set sv_motd hello\n'+content+'\n')
                before = config.read_bytes()
                with patch.object(iw.arena, 'validate', return_value=28960):
                    with self.assertRaises(ValueError):
                        iw.preflight(root, {})
                self.assertEqual(config.read_bytes(), before)
            config.write_text('set sv_motd hello\n')
            for name in ('server.cfg', 'main/server.cfg', 'userraw/autoexec.cfg'):
                shadow = root/name
                shadow.parent.mkdir(exist_ok=True)
                shadow.write_text('opaque')
                with patch.object(iw.arena, 'validate', return_value=28960):
                    with self.assertRaises(ValueError):
                        iw.preflight(root, {})
                shadow.unlink()

    def test_query_validation(self):
        info = {'challenge': 'nonce', 'gamename': 'IW4', 'sv_running': '1',
                'matchtype': '2', 'mapname': 'mp_rust', 'gametype': 'war',
                'fs_game': '', 'protocol': '150', 'version': 'fixture'}
        def packet(values):
            return b'\xff\xff\xff\xffinfoResponse\n' + ''.join('\\'+k+'\\'+v for k,v in values.items()).encode()
        self.assertTrue(iw.valid_info(packet(info), 'nonce', ''))
        for key, value in [('challenge','stale'), ('gamename','other'), ('sv_running','0'),
                           ('matchtype','1'), ('mapname',''), ('gametype',''), ('fs_game','mods/other')]:
            with self.subTest(key=key):
                self.assertFalse(iw.valid_info(packet({**info,key:value}), 'nonce', ''))
        for bad in [b'heartbeat', packet(info)+b'\\challenge\\nonce', packet(info)+b'\\odd',
                    packet(info)+b'\x00', b'x'*8193, packet(info).replace(b'IW4',b'\xff')]:
            self.assertFalse(iw.valid_info(bad, 'nonce', ''))

    def test_process_backed_gate(self):
        for polls, reply, expected in [([1], True, False), ([None, 7, 7], True, False),
                                        ([None, None], True, True)]:
            child = Mock(); child.poll.side_effect = polls
            finished = threading.Event(); emit = Mock(); query = Mock(return_value=reply)
            iw.readiness(child, finished, query, emit)
            self.assertEqual(emit.called, expected)
        child = Mock(); child.poll.return_value = None
        finished = threading.Event(); emit = Mock()
        def malformed():
            finished.set()
            return False
        iw.readiness(child, finished, malformed, emit)
        emit.assert_not_called()
        finished.clear()
        def timeout():
            finished.set()
            raise TimeoutError()
        iw.readiness(child, finished, timeout, emit)
        emit.assert_not_called()

    def test_exact_emitted_layout_and_scalar_preservation(self):
        profile = json.loads(Path('internal/panel/game_library/overrides.json').read_text())
        egg = profile['cod/iw4x/egg-iw4x-mw2.json']['egg']
        self.assertEqual(json.loads(egg['config']['startup'])['done'], iw.READY)
        self.assertIn('.voltra/iw4x-native.py run', egg['startup'])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for file, delimiter, body in re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n([\s\S]*?)\n\2\n", egg['scripts']['installation']['script']):
                (root/file).write_text(body, encoding='utf-8', newline='')
            spec = importlib.util.spec_from_file_location('emitted_iw4x', root/'iw4x-native.py')
            emitted = importlib.util.module_from_spec(spec); spec.loader.exec_module(emitted)
            cfg = 'set sv_hostname "old"\r\nset g_password "secret"\r\nset sv_motd "hello"\r\nset g_allowVote "1"\r\nset sv_voice "0"\r\nset sv_alltalk "1"\r\nset scr_teambalance "0"\r\nset scr_game_allowkillcam "1"\r\nset scr_thirdperson "0"\r\nset unknown "opaque" // keep\r\n'
            (root/'userraw').mkdir(); (root/'userraw/server.cfg').write_text(cfg, newline='')
            def publish(root, name, writer, mode):
                with (root/name).open('wb') as output:
                    writer(output)
            with patch.object(emitted.arena, 'validate', return_value=28960), patch.object(emitted.arena.steam, '_publish', side_effect=publish):
                emitted.preflight(root, {})
                argv, _ = emitted.arena.configure(root, 'iw4x', {'SERVER_PORT':'28960'})
            self.assertEqual(argv[argv.index('+exec')+1], 'server.cfg')
            self.assertEqual(argv[argv.index('fs_game')+1], '')
            with (root/'userraw/server.cfg').open(newline='') as stream:
                after = stream.read()
            self.assertEqual(after[after.index('set sv_motd'):], cfg[cfg.index('set sv_motd'):])
            (root/'mods/test').mkdir(parents=True)
            (root/'mods/test/server.cfg').write_text('set sv_motd "shadow"')
            with patch.object(emitted.arena, 'validate', return_value=28960):
                with self.assertRaisesRegex(ValueError, 'shadows'):
                    emitted.preflight(root, {'MOD_DIR':'mods/test'})

    def test_supervisor_raw_exit_and_update_exclusion(self):
        for raw in [0, 7, -2]:
            console = types.SimpleNamespace(subprocess=types.SimpleNamespace(Popen=Mock()), run=Mock(return_value=raw))
            self.assertEqual(iw.supervised_run(console, '.', ['launcher','--update'], {}, 'stop'), raw)

    def test_mocked_wire_and_supervised_child(self):
        wire = Mock()
        context = Mock(); context.__enter__ = Mock(return_value=wire); context.__exit__ = Mock(return_value=False)
        wire.recv.return_value = b'malformed'
        with patch.object(iw.socket, 'socket', return_value=context), patch.object(iw.secrets, 'token_hex', return_value='nonce'):
            self.assertFalse(iw.local_query(28960, ''))
        wire.connect.assert_called_once_with(('127.0.0.1', 28960))
        wire.send.assert_called_once_with(b'\xff\xff\xff\xffgetinfo\nnonce')
        child = Mock(); child.poll.return_value = 7
        process = types.SimpleNamespace(Popen=Mock(return_value=child))
        console = types.SimpleNamespace(subprocess=process)
        def native(*args, **kwargs):
            self.assertIs(console.subprocess.Popen(['wine']), child)
            return 7
        console.run = native
        argv = ['wine', '-dedicated', '+set', 'net_port', '28960', '+set', 'fs_game', '']
        with patch.object(iw.socket, 'socket', return_value=context), patch.object(iw, 'local_query') as query:
            self.assertEqual(iw.supervised_run(console, '.', argv, {}, 'stop'), 7)
            query.assert_not_called()
        self.assertIs(console.subprocess, process)
        context.__enter__.return_value.bind.side_effect = OSError('occupied')
        process.Popen.reset_mock()
        with patch.object(iw.socket, 'socket', return_value=context):
            with self.assertRaises(OSError):
                iw.supervised_run(console, '.', argv, {}, 'stop')
        process.Popen.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
