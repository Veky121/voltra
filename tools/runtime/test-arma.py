#!/usr/bin/env python3
"""MIT. Offline source/config/process fixtures; deliberately not game acceptance."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE = Path('internal/panel/game_library/scripts/arma-native.py').resolve()
spec = importlib.util.spec_from_file_location('arma', SOURCE)
arma = importlib.util.module_from_spec(spec)
spec.loader.exec_module(arma)


class ArmaTests(unittest.TestCase):
    def env(self, **values):
        return dict(SERVER_PORT='28000', VOLTRA_ALLOCATED_PORTS='28000,28001,28002,28003,28004',
                    INSTALL_MODE='existing', UPDATE_SERVER='0', DISABLE_MOD_UPDATES='1', **values)

    def test_reforger_literal_schema_preserves_operator(self):
        previous = {'game': {'mods': [{'modId': 'A', 'name': 'true'}], 'admins': ['operator'],
                             'gameProperties': {'missionHeader': {'literal': 'false'}}},
                    'operating': {'playerSaveTime': 51}, 'unknown': 'retained'}
        result = arma.reforger_config(previous, self.env(SERVER_NAME='"true" $ +', SERVER_PASS='true',
                    ADMIN_PASS='false', VISIBLE='false', DISABLE_THIRD='true', BATTLEYE='0'))
        self.assertEqual(result['game']['name'], '"true" $ +')
        self.assertEqual(result['game']['password'], 'true')
        self.assertEqual(result['game']['passwordAdmin'], 'false')
        self.assertIs(result['game']['visible'], False)
        self.assertIs(result['game']['gameProperties']['disableThirdPerson'], True)
        self.assertEqual(result['game']['mods'], previous['game']['mods'])
        self.assertEqual(result['game']['admins'], previous['game']['admins'])
        self.assertEqual(result['operating'], previous['operating'])
        self.assertEqual(result['game']['gameProperties']['missionHeader'], {'literal': 'false'})
        self.assertEqual(previous['game']['gameProperties'], {'missionHeader': {'literal': 'false'}})
        self.assertNotIn('region', result)
        self.assertNotIn('autoJoinable', result['game'])

    def test_ports_ip_and_typed_values(self):
        for values in [dict(A2S_PORT='28000'), dict(A2S_PORT='28001', RCON_PORT='28001'),
                       dict(A2S_PORT='27999'), dict(PUBLIC_ADDRESS='::1'), dict(VISIBLE='yes'),
                       dict(MAX_PLAYERS='0'), dict(RCON_PORT='28001', RCON_PASSWORD='short'),
                       dict(ADMIN_PASS='has space')]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                arma.reforger_config({}, self.env(**values))
        result = arma.reforger_config({'rcon': {'blacklist': ['shutdown']}},
                   self.env(A2S_PORT='28001', RCON_PORT='28002', RCON_PASSWORD='fixture-only-password', PUBLIC_ADDRESS='local'))
        self.assertEqual(result['a2s']['port'], 28001)
        self.assertEqual(result['rcon']['permission'], 'monitor')
        self.assertEqual(result['rcon']['blacklist'], ['shutdown'])
        self.assertEqual(arma.reforger_config(result, self.env())['rcon']['port'], 0)

    def test_cfg_nested_comments_literals_and_duplicate_failclosed(self):
        original = '// password="comment";\npassword = "old"; // keep\nclass Missions { class A {password="nested";};};\nmaxPlayers=8;\nmotd[]={"{} // literal"};\n'
        result = arma.patch_cfg(original, {'password': arma.cfg_string('"true" $ \\ +'), 'maxPlayers': '12', 'headlessClients[]': '{"127.0.0.1"}'})
        self.assertIn('password = """true"" $ \\ +";', result)
        self.assertIn('class A {password="nested";}', result)
        self.assertIn('// password="comment";', result)
        self.assertIn('// keep', result)
        self.assertIn('motd[]={"{} // literal"};', result)
        self.assertIn('headlessClients[] = {"127.0.0.1"};', result)
        for bad in ['password="a";password="b";', '/* unterminated', 'password="oops', '} {']:
            with self.assertRaises(ValueError):
                arma.patch_cfg(bad, {'password': '"new"'})

    def test_private_transport_never_spawns_or_sends_credentials(self):
        with patch.object(arma.steam, 'update', side_effect=AssertionError('no private transport')), patch.object(arma.subprocess, 'run', side_effect=AssertionError('no spawn')):
            with tempfile.TemporaryDirectory() as folder:
                with self.assertRaisesRegex(ValueError, 'No credentials have been sent'):
                    arma.install(Path(folder), 'arma3', {'STEAM_USER': 'fixture-user', 'STEAM_PASS': 'fixture-secret'})
        self.assertEqual(arma.branch({'CDLC': '1'}), 'creatordlc')
        self.assertEqual(arma.branch({'CDLC': '1', 'STEAMCMD_EXTRA_FLAGS': '-beta profiling'}), 'profiling')
        for flags in ['+login fake', '-beta safe +quit', '-beta safe -betapassword x +quit', '-beta $(bad)']:
            with self.assertRaises(ValueError):
                arma.branch({'STEAMCMD_EXTRA_FLAGS': flags})

    def test_launcher_mod_roles_key_ownership_and_lowercase(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / '.voltra').mkdir()
            for name in ['@10', '@20', '@30']:
                (root / name / 'Keys').mkdir(parents=True)
                (root / name / 'Keys/key.bikey').write_bytes(name.encode())
            (root / '@20/Keys/key.bikey').rename(root / '@20/Keys/server.bikey')
            (root / 'modlist.html').write_text('Created by Arma 3 Launcher<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=10">mod</a><a href="https://evil.test/?id=999">ignored</a>')
            env = self.env(MODIFICATIONS='@10;@10', SERVERMODS='@20', OPTIONALMODS='@30')
            main, hc, lists = arma.arma_arguments(root, env)
            self.assertEqual(lists, (['@10'], ['@20'], ['@30']))
            self.assertIn('-mod=@10', main)
            self.assertIn('-serverMod=@20', main)
            self.assertNotIn('@30', ';'.join(main))
            self.assertIn('-connect=127.0.0.1', hc)
            arma.publish_keys(root, lists)
            self.assertEqual((root / 'keys/optional_30_key.bikey').read_bytes(), b'@30')
            (root / 'keys/manual.bikey').write_bytes(b'operator')
            arma.publish_keys(root, (['@10'], ['@20'], []))
            self.assertFalse((root / 'keys/optional_30_key.bikey').exists())
            self.assertEqual((root / 'keys/manual.bikey').read_bytes(), b'operator')
            # Identical pre-existing operator files must never become adapter-owned.
            (root / 'keys/optional_30_key.bikey').write_bytes(b'@30')
            arma.publish_keys(root, lists)
            arma.publish_keys(root, (['@10'], ['@20'], []))
            self.assertEqual((root / 'keys/optional_30_key.bikey').read_bytes(), b'@30')
            arma.lowercase_tree(root / '@10')
            self.assertTrue((root / '@10/keys/key.bikey').is_file())
            (root / '@10/A').touch();(root / '@10/a').touch()
            with self.assertRaises(ValueError):
                arma.lowercase_tree(root / '@10')

    def test_paths_and_managed_native_roles(self):
        for raw in ['/outside', '../outside', '@a;../../outside', 'c:\\outside']:
            with self.assertRaises(ValueError):
                arma.mod_list(raw)
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as outside:
            root = Path(folder)
            (root / 'linked').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):
                arma.confined(root, 'linked/file')
            for args in ['-port=7777', '-config other.cfg', '-password=oops']:
                with self.assertRaises(ValueError):
                    arma.arma_arguments(root, self.env(STARTUP_PARAMS=args))
            with self.assertRaises(ValueError):
                arma.allocated({**self.env(), 'VOLTRA_ALLOCATED_PORTS': '28000,28001,28002,28003'}, offsets=(1,2,3,4))

    def test_existing_runtime_config_cache_and_all_headless_choices(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / '.voltra').mkdir()
            (root / 'server.cfg').write_text('hostname="retained";\nmaxPlayers=8;\n')
            for name in ['Player', 'HC1']:
                (root / 'serverprofile/home' / name).mkdir(parents=True)
                (root / 'serverprofile/home' / name / 'save').write_text('retained')
            main, clients = arma.configure(root, 'arma3', self.env(HC_NUM='5', CLEAR_CACHE='1', SERVER_PASSWORD='literal"$+'))
            self.assertEqual(len(clients), 5)
            self.assertIn('-password=literal"$+', clients[0])
            self.assertTrue((root / 'serverprofile/home/Player/save').is_file())
            self.assertFalse((root / 'serverprofile/home/HC1').exists())
            self.assertIn('hostname="retained";', (root / 'server.cfg').read_text())
            self.assertEqual((root / 'server.cfg').stat().st_mode & 0o777, 0o600)
            for binary in ['arma3server', 'arma3server_x64', 'arma3serverprofiling', 'arma3serverprofiling_x64']:
                args, hc, _ = arma.arma_arguments(root, self.env(SERVER_BINARY=binary))
                self.assertEqual(args[0], str(root / binary))

    def test_reforger_reinstall_exact_config_even_when_steam_fails(self):
        for app in [1874900]:
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                config = root / 'config.json'
                data = b'{"operator": "retained", "game": {"mods": []}}\r\n'
                config.write_bytes(data);config.chmod(0o640)
                original = config.stat()
                def replace_then_fail(*args, **kwargs):
                    self.assertEqual(args[1], app)
                    config.write_text('publisher replacement')
                    raise RuntimeError('fixture-only Steam interruption')
                with patch.object(arma.steam, 'update', side_effect=replace_then_fail):
                    with self.assertRaises(RuntimeError):
                        arma.update_reforger(root, {'SRCDS_APPID': str(app), 'REFORGER_ACCEPT_EULA': json.loads(SOURCE.with_name('arma-releases.json').read_text())['reforger_agreement']['accept_value'], 'REFORGER_ACCEPT_BATTLEYE': json.loads(SOURCE.with_name('arma-releases.json').read_text())['reforger_battleye_agreement']['accept_value']})
                self.assertEqual(config.read_bytes(), data)
                self.assertEqual(config.stat().st_mode, original.st_mode)
                self.assertEqual(config.stat().st_mtime_ns, original.st_mtime_ns)

    def test_reforger_exact_argv_and_private_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args, clients = arma.configure(root, 'reforger', self.env(LOG_INTERVAL='3', MAX_FPS='', REFORGER_ACCEPT_EULA=json.loads(SOURCE.with_name('arma-releases.json').read_text())['reforger_agreement']['accept_value'], REFORGER_ACCEPT_BATTLEYE=json.loads(SOURCE.with_name('arma-releases.json').read_text())['reforger_battleye_agreement']['accept_value']))
            self.assertEqual(args[args.index('-logStats') + 1], '3000')
            self.assertNotIn('-maxFPS', args)
            self.assertEqual(clients, [])
            self.assertEqual((root / 'config.json').stat().st_mode & 0o777, 0o600)

    def test_native_process_fixture_owns_children_and_forwards_sigint(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            program = root / 'child.py'
            program.write_text('import os,signal,sys,time\nfrom pathlib import Path\nname=sys.argv[1]\nPath(name+".pid").write_text(str(os.getpid()))\ndef stop(s,f):\n Path(name+".stopped").write_text("SIGINT")\n sys.exit(0)\nsignal.signal(signal.SIGINT,stop)\nwhile True:time.sleep(.05)\n')
            launcher = root / 'supervisor.py'
            launcher.write_text('import importlib.util,os,sys\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location("arma",'+repr(str(SOURCE))+')\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nr=Path.cwd()\nsys.exit(m.supervise(r,[sys.executable,"child.py","main"],[[sys.executable,"child.py","hc"]],dict(os.environ)))\n')
            process = subprocess.Popen([sys.executable, str(launcher)], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                deadline = time.monotonic() + 10
                while not all((root / (name + '.pid')).exists() for name in ['main', 'hc']):
                    if time.monotonic() > deadline or process.poll() is not None:
                        self.fail('Fixture processes failed to start')
                    time.sleep(.05)
                process.send_signal(signal.SIGTERM)
                out, error = process.communicate(timeout=15)
                self.assertEqual(process.returncode, 0, error.decode())
                for name in ['main', 'hc']:
                    self.assertEqual((root / (name + '.stopped')).read_text(), 'SIGINT')
                    with self.assertRaises(ProcessLookupError):
                        os.kill(int((root / (name + '.pid')).read_text()), 0)
            finally:
                if process.poll() is None:
                    process.kill();process.wait()


    def test_reforger_missing_wrong_or_generic_consent_blocks_before_download_or_write(self):
        for value in [None, '0', '1', 'true', '1874900_eula_1', 'f' * 64]:
            for action in ['install', 'configure', 'update']:
                with self.subTest(value=value, action=action), tempfile.TemporaryDirectory() as folder:
                    root = Path(folder); env = self.env()
                    if value is not None: env['REFORGER_ACCEPT_EULA'] = value
                    with patch.object(arma.steam, 'update') as download, self.assertRaisesRegex(ValueError, 'explicitly agree'):
                        if action == 'install': arma.install(root, 'reforger', env)
                        elif action == 'configure': arma.configure(root, 'reforger', env)
                        else: arma.update_reforger(root, env)
                    download.assert_not_called(); self.assertEqual(list(root.iterdir()), [])

    def test_reforger_exact_stable_ack_and_config_unknowns_retained(self):
        terms = json.loads(SOURCE.with_name('arma-releases.json').read_text())['reforger_agreement']
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); config=root/'config.json'; content=b'{"operator_unknown":73,"game":{"mods":[]}}';config.write_bytes(content);config.chmod(0o640)
            env=self.env(REFORGER_ACCEPT_EULA=terms['accept_value'],REFORGER_ACCEPT_BATTLEYE=json.loads(SOURCE.with_name('arma-releases.json').read_text())['reforger_battleye_agreement']['accept_value'])
            with patch.object(arma.steam,'update') as download:arma.install(root,'reforger',env)
            download.assert_called_once();self.assertEqual(config.read_bytes(),content);self.assertEqual(config.stat().st_mode&0o777,0o640)
            arma.configure(root,'reforger',env);self.assertEqual(json.loads(config.read_text())['operator_unknown'],73)
            self.assertEqual(config.stat().st_mode&0o777,0o600)

    def test_reforger_stable_ack_never_authorizes_experimental_or_swaps_app(self):
        terms=json.loads(SOURCE.with_name('arma-releases.json').read_text())['reforger_agreement']
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);env=self.env(SRCDS_APPID='1890870',REFORGER_ACCEPT_EULA=terms['accept_value'])
            with patch.object(arma.steam,'update')as download,self.assertRaisesRegex(ValueError,'separate publisher agreement review'):arma.install(root,'reforger',env)
            download.assert_not_called();self.assertEqual(list(root.iterdir()),[])

    def test_reforger_run_guard_precedes_update_config_and_native_launch(self):
        with patch.object(sys,'argv',['arma-native.py','run','reforger']),patch.dict(os.environ,{},clear=True),patch.object(arma,'update_reforger')as update,patch.object(arma,'configure')as configure,patch.object(arma,'supervise')as native,self.assertRaisesRegex(ValueError,'explicitly agree'):
            arma.main()
        update.assert_not_called();configure.assert_not_called();native.assert_not_called()

    def test_arma3_gate_is_noop_without_terms_pin_or_ack(self):
        with patch.object(arma.json,'loads',side_effect=AssertionError('Arma3 must not read agreement')):
            arma.agreement('arma3',{})


    def test_battleye_missing_wrong_or_zero_blocks_with_server_consent(self):
        pins=json.loads(SOURCE.with_name('arma-releases.json').read_text())
        for value in [None,'0','1','true','f'*64]:
            for enabled in ['true','false']:
                for action in ['install','configure','update']:
                    with self.subTest(value=value,enabled=enabled,action=action),tempfile.TemporaryDirectory()as folder:
                        root=Path(folder);env=self.env(REFORGER_ACCEPT_EULA=pins['reforger_agreement']['accept_value'],BATTLEYE=enabled)
                        if value is not None:env['REFORGER_ACCEPT_BATTLEYE']=value
                        with patch.object(arma.steam,'update')as download,self.assertRaisesRegex(ValueError,'BattlEye EULA'):
                            if action=='install':arma.install(root,'reforger',env)
                            elif action=='configure':arma.configure(root,'reforger',env)
                            else:arma.update_reforger(root,env)
                        download.assert_not_called();self.assertEqual(list(root.iterdir()),[])

    def test_battleye_false_never_implies_consent_and_correct_both_remain_literal(self):
        pins=json.loads(SOURCE.with_name('arma-releases.json').read_text());env=self.env(REFORGER_ACCEPT_EULA=pins['reforger_agreement']['accept_value'],REFORGER_ACCEPT_BATTLEYE=pins['reforger_battleye_agreement']['accept_value'])
        arma.agreement('reforger',env)
        with tempfile.TemporaryDirectory()as folder:
            arma.configure(Path(folder),'reforger',env);cfg=json.loads((Path(folder)/'config.json').read_text())
            self.assertTrue(cfg['game']['gameProperties']['battlEye'])

    def test_battleye_run_guard_before_update_config_and_native(self):
        pins=json.loads(SOURCE.with_name('arma-releases.json').read_text())
        with patch.object(sys,'argv',['arma-native.py','run','reforger']),patch.dict(os.environ,{'REFORGER_ACCEPT_EULA':pins['reforger_agreement']['accept_value']},clear=True),patch.object(arma,'update_reforger')as update,patch.object(arma,'configure')as configure,patch.object(arma,'supervise')as native,self.assertRaisesRegex(ValueError,'BattlEye EULA'):
            arma.main()
        update.assert_not_called();configure.assert_not_called();native.assert_not_called()


unittest.main()
