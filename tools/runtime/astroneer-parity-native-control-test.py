import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT/'internal/panel/game_library/scripts/astroneer-rcon.py'
spec = importlib.util.spec_from_file_location('astro_rcon', HELPER)
astro = importlib.util.module_from_spec(spec); spec.loader.exec_module(astro)
STATS = {'build': '1.45.1.0', 'secondsInGame': 1, 'averageFPS': 30.5, 'playersInGame': 0, 'maxInGamePlayers': 8}


class ControlTests(unittest.TestCase):
    def failure_driver(self, directory):
        driver = Path(directory)/'failure_driver.py'
        driver.write_text('''import importlib.machinery,importlib.util,sys,os,time,pathlib
steam_loader=importlib.machinery.SourceFileLoader('steam_template',sys.argv[2]+'/steam-template.py');steam_spec=importlib.util.spec_from_loader(steam_loader.name,steam_loader);steam=importlib.util.module_from_spec(steam_spec);steam_loader.exec_module(steam);sys.modules['steam_template']=steam
loader=importlib.machinery.SourceFileLoader('staged_console',sys.argv[1]);spec=importlib.util.spec_from_loader(loader.name,loader);module=importlib.util.module_from_spec(spec);loader.exec_module(module)
folder=pathlib.Path(sys.argv[3]);mode=sys.argv[4]
class Control:
 def start(self,child,emit):
  self.child=child
  (folder/'leader.pid').write_text(str(child.pid))
  if mode=='start':
   deadline=time.monotonic()+5
   while not (folder/'descendant.pid').exists() and time.monotonic()<deadline:time.sleep(.01)
   if not (folder/'descendant.pid').exists():raise RuntimeError('descendant fixture did not start')
   raise RuntimeError('private-start-failure')
 def command(self,line):pass
 def stop(self):pass
 def close(self):
  (folder/'closed').write_text('called')
  raise RuntimeError('private-close-failure')
if mode=='start':
 descendant='import os,signal,time,pathlib;signal.signal(signal.SIGTERM,signal.SIG_IGN);pathlib.Path('+repr(str(folder/'descendant.pid'))+').write_text(str(os.getpid()));time.sleep(60)'
 child='import subprocess,sys,signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);subprocess.Popen([sys.executable,"-u","-c",'+repr(descendant)+']);time.sleep(60)'
else:child='raise SystemExit(7)'
try:
 result=module.run('.', [sys.executable,'-u','-c',child],dict(os.environ),'stop',control_transport=Control(),terminal_input=sys.argv[5]=='pty')
 print('RAW_EXIT='+str(result),flush=True)
except RuntimeError as error:print('CAUGHT='+str(error),flush=True)
''')
        return driver

    def test_transport_close_failure_preserves_actual_native_exit(self):
        proposal = ROOT/'internal/panel/game_library/scripts/native-console.py'
        with tempfile.TemporaryDirectory() as directory:
            driver = self.failure_driver(directory)
            result = subprocess.run([sys.executable, '-B', str(driver), str(proposal), str(HELPER.parent), directory, 'close', 'pipe'], input='', text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('RAW_EXIT=7', result.stdout)
            self.assertIn('original exit retained', result.stdout)
            self.assertTrue((Path(directory)/'closed').exists())
            self.assertNotIn('private-close-failure', result.stdout+result.stderr)

    @unittest.skipUnless(os.name == 'posix', 'Linux owned-process-group/PTY regression')
    def test_transport_start_failure_kills_group_and_closes_even_when_close_raises(self):
        proposal = ROOT/'internal/panel/game_library/scripts/native-console.py'
        for mode in ('pipe', 'pty'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                driver = self.failure_driver(directory)
                result = subprocess.run([sys.executable, '-B', str(driver), str(proposal), str(HELPER.parent), directory, 'start', mode], input='', text=True, capture_output=True, timeout=12)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('CAUGHT=Native control startup failed', result.stdout)
                self.assertNotIn('private-start-failure', result.stdout+result.stderr)
                self.assertNotIn('private-close-failure', result.stdout+result.stderr)
                self.assertTrue((Path(directory)/'closed').exists())
                for name in ('leader.pid', 'descendant.pid'):
                    pid = int((Path(directory)/name).read_text())
                    process = Path('/proc')/str(pid)/'stat'
                    # Container init may not have reaped an orphan yet; Z is dead.
                    if process.exists(): self.assertEqual(process.read_text().split(') ', 1)[1].split()[0], 'Z')

    def wrapper(self):
        module = types.ModuleType('astro_candidate')
        module.__file__ = str(HELPER.with_name('astroneer-parity.py'))
        proposal = ROOT/'internal/panel/game_library/scripts/astroneer-parity.py'
        exec(compile(proposal.read_text(), str(proposal), 'exec'), module.__dict__)
        return module

    def test_wrapper_seed_once_private_credential_operator_bytes(self):
        wrapper = self.wrapper()
        env = {'PUBLIC_IP': '8.8.8.8', 'OWNER_NAME': 'Fixture', 'OWNER_GUID': '0', 'SERVER_PORT': '29101', 'VOLTRA_ALLOCATED_PORTS': '29101', 'SERVER_PWD': 'join-password'}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); wrapper.configure(root, env)
            ini = root/'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini'
            content = ini.read_text()+'\n; retained\nUnknown=value\nPlayerProperties=(Guid="one")\nPlayerProperties=(Guid="two")\n'
            ini.write_text(content)
            before = ini.read_bytes(); password = astro.scalar(content, 'ConsolePassword')
            self.assertEqual(len(password), 48)
            self.assertEqual(astro.scalar(content, 'ConsolePort'), '39000')
            wrapper.configure(root, dict(env, SERVER_NAME='changed startup seed'))
            self.assertEqual(ini.read_bytes(), before)
            self.assertEqual(astro.scalar(ini.read_text(), 'ConsolePassword'), password)

    def test_wrapper_refuses_ports_address_before_acquisition_or_writes(self):
        wrapper = self.wrapper()
        env = {'PUBLIC_IP': '8.8.8.8', 'OWNER_NAME': 'Fixture', 'OWNER_GUID': '0', 'SERVER_PORT': '29101', 'VOLTRA_ALLOCATED_PORTS': '29101', 'SERVER_PWD': ''}
        for changed in ({'PUBLIC_IP': '127.0.0.1'}, {'SERVER_PORT': '29102'}):
            with tempfile.TemporaryDirectory() as directory, patch.object(wrapper.legacy, 'install') as install:
                with self.assertRaises(ValueError): wrapper.run(Path(directory), dict(env, **changed))
                install.assert_not_called(); self.assertEqual(list(Path(directory).iterdir()), [])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); wrapper.configure(root, env)
            ini = root/'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini'
            ini.write_text(ini.read_text().replace('ConsolePort=39000', 'ConsolePort=29101'))
            before = {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
            with patch.object(wrapper.legacy, 'install') as install:
                with self.assertRaises(ValueError): wrapper.run(root, env)
                install.assert_not_called()
            self.assertEqual({str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}, before)

    def test_stats_rejects_false_or_nonfinite_readiness(self):
        self.assertTrue(astro.valid_stats(STATS))
        for extra in ({'secondsInGame': True}, {'secondsInGame': float('nan')}, {'averageFPS': float('inf')}, {'playersInGame': 9}, {'build': 'wine warning'}, {'maxInGamePlayers': 0}):
            self.assertFalse(astro.valid_stats(dict(STATS, **extra)))
        self.assertFalse(astro.valid_players({'playerInfo': 'not array'}))
        for bad in (b'{"secondsInGame":1,"secondsInGame":2}', b'{"secondsInGame":NaN}'):
            with self.assertRaises(ValueError): astro.native_json(bad)

    def test_control_plan_native_authority_and_private_port(self):
        body = '[%s]\nPublicIP=8.8.8.8\nConsolePort=39990\nConsolePassword=%s\nUnknown=retain\n' % (astro.SECTION, 'a'*32)
        self.assertEqual(astro.plan(body, [29101], [29101]), {'ConsolePort': '39990', 'ConsolePassword': 'a'*32})
        self.assertIn('Unknown=retain', body)
        generated = astro.plan('[%s]\nPublicIP=8.8.8.8\n' % astro.SECTION, [29101], [29101])
        self.assertEqual(len(generated['ConsolePassword']), 48)
        self.assertNotEqual(generated['ConsolePort'], '29101')

    def test_staged_setup_public_ipv4_vectors_match_native_preacquisition(self):
        metadata = json.loads((ROOT/'artifacts/game-parity-20261029/astroneer-native-setup-validation.json').read_text())
        self.assertEqual(metadata['validation']['environment'], 'PUBLIC_IP')
        self.assertEqual(metadata['validation']['type'], 'public_ipv4')
        wrapper = self.wrapper()
        env = {'OWNER_NAME': 'Fixture', 'OWNER_GUID': '0', 'SERVER_PORT': '29101', 'VOLTRA_ALLOCATED_PORTS': '29101', 'SERVER_PWD': ''}
        for address in metadata['vectors']['accept']:
            self.assertTrue(astro.plan('[%s]\nPublicIP=%s\n' % (astro.SECTION,address),[29101],[29101]))
        for address in metadata['vectors']['reject']:
            with self.subTest(address=address), tempfile.TemporaryDirectory() as directory, patch.object(wrapper,'install') as install:
                with self.assertRaises(ValueError): wrapper.run(Path(directory),dict(env,PUBLIC_IP=address))
                install.assert_not_called();self.assertEqual(list(Path(directory).iterdir()),[])

    def test_preflight_rejects_bad_authority_and_exposure(self):
        base = '[%s]\nPublicIP=8.8.8.8\n' % astro.SECTION
        for suffix in ('ConsolePort=29101\n', 'ConsolePort=39990\nConsolePort=39991\n', 'ConsolePassword=short\n'):
            with self.assertRaises(ValueError): astro.plan(base+suffix, [29101], [29101])
        for address in ('127.0.0.1', '0.0.0.0', '192.168.1.4', '', '224.0.0.1', '::1'):
            with self.assertRaises(ValueError): astro.plan('[%s]\nPublicIP=%s\n' % (astro.SECTION, address), [29101], [])

    def test_ready_needs_genuine_clock_and_owned_udp(self):
        t = astro.Transport(39990, 'a'*32, 29101)
        t.child = type('Child', (), {'pid': 42})()
        emitted = []; t.emit = emitted.append
        values = iter([dict(STATS), {'playerInfo': []}, dict(STATS), {'playerInfo': []}, dict(STATS, secondsInGame=2), {'playerInfo': []}, dict(STATS, secondsInGame=3), {'playerInfo': []}])
        t.request = lambda _: next(values)
        with patch.object(astro, 'owned_udp', return_value=False):
            t.sample(); t.sample(); t.sample()
        self.assertFalse(t.ready); self.assertEqual(emitted, [])
        with patch.object(astro, 'owned_udp', return_value=True): t.sample()
        self.assertEqual(emitted, [astro.READY])

    def test_readiness_resets_after_invalid_response(self):
        t = astro.Transport(39990, 'a'*32, 29101); t.previous = 4
        t.request = lambda _: {'status': True}
        with self.assertRaises(ValueError): t.sample()
        self.assertIsNone(t.previous); self.assertFalse(t.ready)

    def test_real_tcp_auth_framing_and_sanitized_response(self):
        server = socket.socket(); server.bind(('127.0.0.1', 0)); server.listen(1)
        port = server.getsockname()[1]; received = []
        def accept():
            conn, _ = server.accept()
            with conn, conn.makefile('rb') as reader:
                received.append(reader.readline().decode().strip())
                for _ in range(3):
                    command = reader.readline().decode().strip(); received.append(command)
                    if command == 'DSServerStatistics': body = dict(STATS, ownerName='private-owner', serverURL='private-address')
                    elif command == 'DSListPlayers': body = {'playerInfo': []}
                    else: break
                    encoded = (json.dumps(body)+'\r\n').encode(); conn.sendall(encoded[:5]); conn.sendall(encoded[5:])
            server.close()
        thread = threading.Thread(target=accept); thread.start()
        t = astro.Transport(port, 'b'*32, 29101, timeout=1); output = []; t.emit = output.append
        t.command('status'); t.command('players'); t.command('DSServerStatistics\nDSServerShutdown')
        t.disconnect(); thread.join(timeout=3)
        self.assertEqual(received[0], 'b'*32)
        self.assertEqual(received[1:3], ['DSServerStatistics', 'DSListPlayers'])
        self.assertNotIn('private-owner', ''.join(output)); self.assertNotIn('private-address', ''.join(output)); self.assertNotIn('b'*32, ''.join(output))
        self.assertIn('Unsupported', output[-1])

    def test_save_shutdown_order_without_fake_save_ack(self):
        t = astro.Transport(39990, 'a'*32, 29101); calls = []; messages = []
        def request(command, response=True):
            calls.append((command, response))
            return dict(STATS) if command == 'DSServerStatistics' else None
        t.request = request; t.emit = messages.append
        t.stop()
        self.assertEqual(calls, [('DSSaveGame', False), ('DSServerStatistics', True), ('DSServerShutdown', False)])
        self.assertIn('unconfirmed', messages[0]); self.assertNotIn('complete', ''.join(messages))

    def test_closed_socket_reconnect_is_limited_to_allowed_commands(self):
        t = astro.Transport(39990, 'a'*32, 29101); sent = []
        class Closed:
            def sendall(self, _): raise BrokenPipeError()
            def close(self): pass
        class Connected:
            def sendall(self, value): sent.append(value)
        t.socket = Closed()
        def connect():
            if t.socket is None: t.socket = Connected()
        t.connect = connect
        t.request('DSServerShutdown', response=False)
        self.assertEqual(sent, [b'DSServerShutdown\n'])
        with self.assertRaises(ValueError): t.request('DSServerShutdown\nInjected', response=False)
        self.assertEqual(sent, [b'DSServerShutdown\n'])

    def test_wine_orphan_owned_socket_needs_namespace_uid_exact_path_starttime_inode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); proc = root/'proc'
            binary = root/'server/Astro/Binaries/Win64/AstroServer-Win64-Shipping.exe'
            binary.parent.mkdir(parents=True); binary.write_bytes(b'native fixture')
            wine = root/'server/.voltra/proton/GE-Proton11-9/files/lib/wine/i386-unix/wine64-preloader'
            wine.parent.mkdir(parents=True); wine.write_bytes(b'wine fixture')
            links = {}
            def stat(pid, ticks):
                fields = ['S', '1', str(pid), str(pid)] + ['0']*15 + [str(ticks)]
                return str(pid)+' (native) '+' '.join(fields)
            for pid, ticks in ((42,100),(43,101)):
                p = proc/str(pid); (p/'ns').mkdir(parents=True); (p/'fd').mkdir()
                (p/'stat').write_text(stat(pid,ticks)); (p/'status').write_text('Uid:\t1000\t1000\t1000\t1000\n')
                (p/'cmdline').write_bytes(binary.as_posix().encode()+b'\0-log\0')
                links[str(p/'ns/pid')]='pid:[77]';links[str(p/'ns/net')]='net:[88]'
            links[str(proc/'self/ns/pid')]='pid:[77]';links[str(proc/'self/ns/net')]='net:[88]'
            links[str(proc/'43/exe')]=str(wine); (proc/'43/fd/5').write_text('')
            links[str(proc/'43/fd/5')]='socket:[999]'
            (proc/'net').mkdir();(proc/'net/udp6').write_text('header\n')
            (proc/'net/udp').write_text('header\n0: 00000000:%04X 00000000:0000 07 0 0 0 1000 0 999\n' % 29101)
            def readlink(path):
                if str(path) not in links: raise OSError('not mapped')
                return links[str(path)]
            with patch.object(astro.os, 'readlink', side_effect=readlink), patch.object(astro.os, 'geteuid', return_value=1000, create=True):
                self.assertTrue(astro.owned_udp(42,29101,binary,proc))
                for key, invalid in ((str(proc/'43/ns/pid'),'pid:[unrelated]'),(str(proc/'43/ns/net'),'net:[unrelated]'),(str(proc/'43/exe'),str(binary)),(str(proc/'43/fd/5'),'socket:[1000]')):
                    previous=links[key];links[key]=invalid
                    self.assertFalse(astro.owned_udp(42,29101,binary,proc));links[key]=previous
                status=proc/'43/status';before=status.read_text();status.write_text('Uid:\t999\t999\t999\t999\n')
                self.assertFalse(astro.owned_udp(42,29101,binary,proc));status.write_text(before)
                (proc/'43/stat').write_text(stat(43,99));self.assertFalse(astro.owned_udp(42,29101,binary,proc));(proc/'43/stat').write_text(stat(43,101))
                (proc/'43/cmdline').write_bytes(b'/unrelated/AstroServer-Win64-Shipping.exe\0')
                self.assertFalse(astro.owned_udp(42,29101,binary,proc))
                (proc/'43/cmdline').write_bytes(b'c:\\windows\\system32\\steam.exe\0'+binary.as_posix().encode()+b'\0')
                self.assertFalse(astro.owned_udp(42,29101,binary,proc))

    def test_staged_supervisor_real_process_and_input_boundaries(self):
        proposal = ROOT/'internal/panel/game_library/scripts/native-console.py'
        with tempfile.TemporaryDirectory() as directory:
            driver = Path(directory)/'driver.py'
            driver.write_text('''import importlib.machinery,importlib.util,sys,time
sys.path.insert(0, sys.argv[2])
steam_loader=importlib.machinery.SourceFileLoader('steam_template',sys.argv[2]+'/steam-template.py');steam_spec=importlib.util.spec_from_loader(steam_loader.name,steam_loader);steam=importlib.util.module_from_spec(steam_spec);steam_loader.exec_module(steam);sys.modules['steam_template']=steam
loader=importlib.machinery.SourceFileLoader('staged_console',sys.argv[1]);spec=importlib.util.spec_from_loader(loader.name,loader);module=importlib.util.module_from_spec(spec);loader.exec_module(module)
class Control:
 def start(self,child,emit):self.child=child;self.emit=emit;emit('[INFO] fixture transport attached')
 def command(self,line):self.emit('[INFO] command '+line+' private-password')
 def stop(self):self.emit('[INFO] protocol stop requested');self.child.terminate()
 def close(self):self.emit('[INFO] transport closed')
code=module.run('.', [sys.executable,'-u','-c','import time; print("native-child-output",flush=True); time.sleep(30)'], dict(__import__('os').environ),'stop',('private-password',),control_transport=Control(),stop_signal_timeout=1)
print('ACTUAL_CHILD_STATUS='+str(code),flush=True)
''')
            result = subprocess.run([sys.executable, '-B', str(driver), str(proposal), str(HELPER.parent)], input='status\n'+'x'*4100+'\nstop\n', text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('fixture transport attached', result.stdout)
            self.assertIn('command status', result.stdout)
            self.assertIn('input exceeds limit', result.stdout)
            self.assertNotIn('private-password', result.stdout)
            self.assertNotIn('command '+'x'*100, result.stdout)
            self.assertIn('protocol stop requested', result.stdout)
            self.assertIn('transport closed', result.stdout)
            self.assertNotIn('ACTUAL_CHILD_STATUS=0\n', result.stdout)

    def test_staged_supervisor_default_real_process_preserves_raw_exit(self):
        proposal = ROOT/'internal/panel/game_library/scripts/native-console.py'
        with tempfile.TemporaryDirectory() as directory:
            driver = Path(directory)/'driver.py'
            driver.write_text('''import importlib.machinery,importlib.util,sys,os
steam_loader=importlib.machinery.SourceFileLoader('steam_template',sys.argv[2]+'/steam-template.py');steam_spec=importlib.util.spec_from_loader(steam_loader.name,steam_loader);steam=importlib.util.module_from_spec(steam_spec);steam_loader.exec_module(steam);sys.modules['steam_template']=steam
loader=importlib.machinery.SourceFileLoader('staged_console',sys.argv[1]);spec=importlib.util.spec_from_loader(loader.name,loader);module=importlib.util.module_from_spec(spec);loader.exec_module(module)
result=module.run('.', [sys.executable,'-u','-c','print("real-native-output"); raise SystemExit(7)'],dict(os.environ),'stop')
print('RAW_EXIT='+str(result))
''')
            result = subprocess.run([sys.executable, '-B', str(driver), str(proposal), str(HELPER.parent)], input='', text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('real-native-output', result.stdout)
            self.assertIn('RAW_EXIT=7', result.stdout)
            self.assertIn('raw_status=7', result.stdout)


if __name__ == '__main__': unittest.main()

