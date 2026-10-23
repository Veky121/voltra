"""Offline configuration fixtures; never native runtime claims."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'internal/panel/game_library/scripts'
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,BASE/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
load('steam_template','steam-template.py');load('native_config','native-config.py');load('additional_survival_install','additional-survival-install.py');load('native_console','native-console.py');game=load('bedrock_family','bedrock-family.py')
class BedrockTests(unittest.TestCase):
    def test_arm_compiler_cache_checks_actual_runtime_files(self):
        compiler=load('bedrock_php_arm_cache','bedrock-php-arm.py')
        with tempfile.TemporaryDirectory() as d,patch.object(compiler.platform,'machine',return_value='aarch64'),patch.object(compiler.shutil,'which',return_value='/fixture/tool'):
            root=Path(d);identity={'version':'fixture-pinned','sha256':'0'*64}
            def acquire(_,destination):destination.write_text('# fixture only\n')
            def compile_fixture(*args,**kwargs):
                binary=root/'bin/php7/bin/php';binary.parent.mkdir(parents=True);binary.write_bytes(b'\x7fELF\x02'+b'\x00'*13+(183).to_bytes(2,'little'))
                (root/'downloads').mkdir();(root/'downloads/dependency').write_bytes(b'fixture')
            with patch.object(compiler.subprocess,'run',side_effect=compile_fixture) as process:
                receipt=compiler.build(root,'PM4',identity,acquire)
                self.assertEqual(process.call_args.kwargs['env']['PHP_VERSION'],'8.1.27')
                self.assertFalse(receipt['native_acceptance']);self.assertFalse(receipt['dependency_archive_hashes_independently_verified'])
                process.reset_mock();self.assertEqual(compiler.build(root,'PM4',identity,acquire),receipt);process.assert_not_called()
                (root/'bin/php7/bin/php').write_bytes(b'changed')
                with self.assertRaisesRegex(ValueError,'differs'):compiler.build(root,'PM4',identity,acquire)
    def test_pnx_original_restart_flag_is_opt_in_and_native_stop_unchanged(self):
        with tempfile.TemporaryDirectory() as d,patch.object(game,'run',return_value=0) as native,patch.object(game,'load') as loader:
            root=Path(d);env={'SERVER_PORT':'28010','AUTOREBOOT':'','PNX_LICENSE_ACCEPTED':'true'}
            with self.assertRaisesRegex(ValueError,'explicitly'):game.launch(root,'pnx',{'SERVER_PORT':'28010'})
            self.assertEqual(game.launch(root,'pnx',env),0);loader.assert_not_called()
            native.assert_called_once();native.reset_mock()
            loader.return_value.run_restarting.return_value=7
            self.assertEqual(game.launch(root,'pnx',dict(env,AUTOREBOOT='-r')),7)
            native.assert_not_called();config=loader.return_value.run_restarting.call_args.args[0]
            self.assertEqual(config['stop_command'],'stop');self.assertTrue(config['terminal_input']);self.assertTrue(config['terminal_query_reply'])
            self.assertNotIn('-r',config['argv'])
            with self.assertRaises(ValueError):game.launch(root,'pnx',dict(env,AUTOREBOOT='--anything'))
    def test_pocketmine_arm_compiles_original_channel_without_x86_target(self):
        compiler=load('bedrock_php_arm','bedrock-php-arm.py')
        for channel in ('PM4','PM5'):
            argv=compiler.plan(channel)
            self.assertIn('-P'+channel[-1],argv)
            self.assertIn('-j2',argv)
            self.assertNotIn('linux64',argv)
            self.assertEqual('-z8.2' in argv,channel=='PM5')
            with patch.object(compiler.platform,'machine',return_value='x86_64'):
                with self.assertRaisesRegex(ValueError,'native ARM64'):compiler.build(Path('/unused'),channel,{},None)
    def test_java_architecture_keeps_amd_and_selects_pinned_arm(self):
        self.assertEqual(game.java_identity('x86_64'),game.java.JAVA21)
        arm=game.java_identity('aarch64')
        self.assertIn('aarch64_linux',arm['url'])
        self.assertEqual(arm['sha256'],'14be1f35ebdbd1f6e8d57eb911a3ffb74d6d9aa255abc5daf2b1302002cf2cf2')
        self.assertEqual(arm['version'],'21.0.12.1+1')
        with self.assertRaises(ValueError):game.java_identity('armv7l')
    def test_terms_refuse_install_before_network(self):
        with tempfile.TemporaryDirectory() as d,patch.object(game,'selected') as selected:
            with self.assertRaisesRegex(ValueError,'EULA'):game.install(Path(d),'bds',{})
            selected.assert_not_called()
    def test_properties_preserve_operator_data_and_metadata(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'server.properties';p.write_text('# retained\nlevel-name=operator-world\nserver-name=old\n');p.chmod(0o640)
            game.configure(root,'bds',dict(SERVER_PORT='28010',VOLTRA_ALLOCATED_PORTS='28010,28011',BEDROCK_TRANSPORT='raknet',SERVERNAME='Literal $ name',GAMEMODE='creative',DIFFICULTY='hard',CHEATS='true'))
            self.assertIn('level-name=operator-world',p.read_text());self.assertIn('server-name=Literal $ name',p.read_text());self.assertIn('server-portv6=28011',p.read_text());self.assertIn('enable-lan-visibility=false',p.read_text());self.assertEqual(p.stat().st_mode&0o777,0o640)
    def test_ambiguous_and_injected_values_fail(self):
        with self.assertRaises(ValueError):game.properties('server-port=1\nserver-port=2\n',{'server-port':'28010'})
        with tempfile.TemporaryDirectory() as d:
            for env in ({'SERVERNAME':'bad\nvalue'},{'GAMEMODE':'bad'},{'SERVER_PORT':'0'}):
                with self.assertRaises(ValueError):game.configure(Path(d),'bds',dict(SERVER_PORT='28010',VOLTRA_ALLOCATED_PORTS='28010,28011')|env)
    def test_uploaded_nukkit_contract(self):
        self.assertIsNone(game.selected('nukkit',{'NUKKIT_VERSION':''},Path('/unused')))
        with self.assertRaises(ValueError):game.jar_name({'SERVER_JARFILE':'../escape.jar'})
    def test_nukkit_native_boolean_roundtrip_keeps_file_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'server.properties'
            native=b'# operator retained\r\nserver-port=28010\r\nserver-ip=0.0.0.0\r\nquery.port=28010\r\nenable-query=on\r\nmotd=Native name\r\nmax-players=7\r\n'
            p.write_bytes(native);p.chmod(0o640)
            game.configure(root,'nukkit',{'SERVER_PORT':'28010','SERVERNAME':'Native name'})
            self.assertEqual(p.read_bytes(),native)
            self.assertEqual(p.stat().st_mode&0o777,0o640)
    def test_gomint_leaves_full_yaml_patching_to_original_wings_parser(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'server.yml';p.write_text('motd: operator\nlistener:\n  ip: 0.0.0.0\n  port: 19132\nworld:\n  port: 7\n');p.chmod(0o640)
            before=p.read_bytes();game.configure(root,'gomint',{'SERVER_PORT':'28010'});self.assertEqual(p.read_bytes(),before);self.assertEqual(p.stat().st_mode&0o777,0o640)
    def test_pnx_native_yaml_initial_port_and_operator_bytes(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);game.configure(root,'pnx',{'SERVER_PORT':'28010','SERVERNAME':'Literal $ name'})
            path=root/'pnx.yml';self.assertEqual(json.loads(path.read_text())['settings']['port'],28010)
            original=b'# retained\r\nsettings:\r\n  port: 28010\r\n  maxPlayers: 7\r\ncustom: [1,2,3]\r\n';path.write_bytes(original);path.chmod(0o640)
            game.configure(root,'pnx',{'SERVER_PORT':'28011'});self.assertEqual(path.read_bytes(),original);self.assertEqual(path.stat().st_mode&0o777,0o640)
    def test_arm_rejects_x64_before_download(self):
        with tempfile.TemporaryDirectory() as d,patch.object(game.platform,'machine',return_value='x86_64'),patch.object(game,'selected') as selected:
            with self.assertRaisesRegex(ValueError,'ARM64'):game.install(Path(d),'bds_arm',{'BEDROCK_TERMS_ACCEPTED':'true'})
            selected.assert_not_called()
    def test_bds_transport_mapping_is_explicit_and_confined(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);game.configure(root,'bds',dict(SERVER_PORT='28014',VOLTRA_ALLOCATED_PORTS='28014,28015',BEDROCK_TRANSPORT='nethernet',BEDROCK_ADVERTISED_ADDRESS='2001:db8::1'))
            text=(root/'server.properties').read_text();self.assertIn('transport=nethernet',text);self.assertIn('server-udp-ports=[2001:db8::1]:28014:28014',text)
            for env in ({'BEDROCK_TRANSPORT':'bad'},{'BEDROCK_ADVERTISED_ADDRESS':'127.0.0.1;command'}):
                with self.assertRaises(ValueError):game.configure(root,'bds',dict(SERVER_PORT='28014',VOLTRA_ALLOCATED_PORTS='28014,28015',**env))
    def test_bds_rejects_unallocated_and_duplicate_native_ports(self):
        with tempfile.TemporaryDirectory() as d:
            for env in ({'VOLTRA_ALLOCATED_PORTS':'28014'},{'VOLTRA_ALLOCATED_PORTS':'28014,28015','SERVER_PORT_V6':'28014'},{'VOLTRA_ALLOCATED_PORTS':'28014,28015','SERVER_PORT_V6':'29000'},{'VOLTRA_ALLOCATED_PORTS':'28015,28016'}):
                with self.assertRaises(ValueError):game.configure(Path(d),'bds',dict(SERVER_PORT='28014',BEDROCK_TRANSPORT='raknet',**env))
    def test_current_bds_defaults_to_supported_single_allocation_nethernet(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);game.configure(root,'bds',dict(SERVER_PORT='28014',VOLTRA_ALLOCATED_PORTS='28014'))
            text=(root/'server.properties').read_text();self.assertIn('transport=nethernet',text);self.assertIn('server-udp-ports=28014:28014',text)
    def test_pocketmine_children_inherit_correct_php_ini_and_native_boolean(self):
        with tempfile.TemporaryDirectory() as d,patch.object(game,'run',return_value=0) as native:
            root=Path(d);(root/'bin/php7/lib/php/extensions/no-debug-fixture').mkdir(parents=True)
            game.launch(root,'pocketmine',{'SERVER_PORT':'28010'})
            env=native.call_args.args[2];self.assertEqual(env['PHPRC'],str(root/'.voltra/pocketmine/php.ini'));self.assertEqual(env['PHP_INI_SCAN_DIR'],'')
            text=(root/'server.properties').read_text();self.assertIn('enable-query=on',text);self.assertIn('enable-ipv6=off',text)
            with self.assertRaises(ValueError):game.configure(root,'pocketmine',{'SERVER_PORT':'28010','SERVER_PORT_V6':'19133'})
            game.configure(root,'pocketmine',{'SERVER_PORT':'28010','SERVER_PORT_V6':'28011','VOLTRA_ALLOCATED_PORTS':'28010,28011'});self.assertIn('enable-ipv6=on', (root/'server.properties').read_text())
if __name__=='__main__':unittest.main()
