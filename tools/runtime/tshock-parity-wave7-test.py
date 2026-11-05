"""Bounded offline fixtures; publisher, .NET and game execution are mocked."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'internal/panel/game_library/scripts'
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
release=load('terraria_release_install',BASE/'terraria-release-install.py');publication=load('steam_template',BASE/'steam-template.py');adapter=load('tshock_wave7',ROOT/'tools/runtime/tshock-parity-wave7.py')
ENV={'VOLTRA_TERRARIA_KIND':'tshock','TSHOCK_VERSION':'v6.2.1','WORLD_NAME':'parity_world','WORLD_SIZE':'2','WORLD_DIFFICULTY':'1','MAX_PLAYERS':'11','SERVER_NAME':'Literal $ server','SERVER_PASSWORD':'fixture-only', 'SERVER_PORT':'29150'}
PROPS=b'# preserve publisher note\r\nworldpath=/home/container/saves/Worlds\r\nworldname=world\r\nworld=/home/container/saves/Worlds/world.wld\r\nautocreate=1\r\ndifficulty=0\r\nmaxplayers=8\r\nport=7777\r\nupnp=0\r\nunknown=keep exact bytes ;#\r\n'
JSON=b'{"Settings":{"ServerName":"Operator","ServerPassword":"opaque","MaxSlots":15,"Unknown":{"Token":"opaque"}}}'
class TShockParity(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name).resolve();(self.root/'tshock').mkdir();self.props=self.root/'serverconfig.txt';self.cfg=self.root/'tshock/config.json';self.props.write_bytes(PROPS);self.cfg.write_bytes(JSON)
    def snapshot(self):return{str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
    def install(self,env=None):return adapter.install(self.root,env or ENV,release=release,publication=publication)
    def test_fresh_controls_seed_once_preserving_other_bytes_and_metadata(self):
        self.props.unlink()
        def acquire(*args):self.props.write_bytes(PROPS);self.props.chmod(0o640)
        with patch.object(release,'install',side_effect=acquire) as call:self.install()
        expected=PROPS.replace(b'worldname=world',b'worldname=parity_world').replace(b'/world.wld',b'/parity_world.wld').replace(b'autocreate=1',b'autocreate=2').replace(b'difficulty=0',b'difficulty=1').replace(b'maxplayers=8',b'maxplayers=11')
        self.assertEqual(self.props.read_bytes(),expected);self.assertEqual(self.props.stat().st_mode&0o777,0o640);self.assertEqual(self.cfg.read_bytes(),JSON);call.assert_called_once()
    def test_existing_native_config_not_reseeded(self):
        before=self.snapshot()
        for _ in range(2):
            with patch.object(release,'install') as call:self.install()
            call.assert_called_once();self.assertEqual(self.snapshot(),before)
    def test_invalid_original_inputs_refuse_before_acquisition_and_writes(self):
        for changes in ({'WORLD_NAME':'../world'},{'WORLD_SIZE':'0'},{'WORLD_DIFFICULTY':'4'},{'MAX_PLAYERS':'256'},{'SERVER_NAME':'bad\nrow'},{'TSHOCK_VERSION':'bad;version'},{'RELEASE_SHA256':'bad'},{'VOLTRA_TERRARIA_KIND':'legacy'}):
            before=self.snapshot()
            with patch.object(release,'install') as call,self.assertRaises(ValueError):self.install({**ENV,**changes})
            call.assert_not_called();self.assertEqual(self.snapshot(),before)
    def test_ambiguous_or_escaping_properties_refuse_before_acquisition(self):
        for content in (PROPS+b'Port=99\n',PROPS.replace(b'/home/container/saves/Worlds/world.wld',b'/etc/passwd'),PROPS+b'\x00',b'unsupported line'):
            self.props.write_bytes(content);before=self.snapshot()
            with patch.object(release,'install') as call,self.assertRaises(ValueError):self.install()
            call.assert_not_called();self.assertEqual(self.snapshot(),before)
    def test_json_duplicate_case_and_nonfinite_refuse_before_acquisition(self):
        for content in (b'{"Settings":{},"Settings":{}}',b'{"Settings":{},"settings":{}}',b'{"Settings":{"ServerName":"a","servername":"b"}}',b'{"Settings":{"value":NaN}}'):
            self.cfg.write_bytes(content);before=self.snapshot()
            with patch.object(release,'install') as call,self.assertRaises(ValueError):self.install()
            call.assert_not_called();self.assertEqual(self.snapshot(),before)
    def test_run_preserves_config_and_delegates_original_runtime(self):
        before=self.snapshot();runtime=types.SimpleNamespace(plan=lambda root,env,**kw:(['verified-app'],dict(env),{'major':9}))
        args,env,_=adapter.plan(self.root,ENV,release=release,runtime=runtime,publication=publication,resolve_runtime=lambda:(Path('/usr/share/dotnet'),Path('/usr/share')))
        self.assertEqual(args,['verified-app']);self.assertEqual(env['DOTNET_ROOT'],'/usr/share');self.assertEqual(self.snapshot(),before)
    def test_trusted_image_cli_and_child_root_override_untrusted_environment(self):
        calls=[]
        def runtime_plan(root,env,run):
            child={key:value for key,value in env.items() if not key.startswith('DOTNET_ROOT')}
            run(['dotnet','--list-runtimes'],env=child)
            return ['verified-app'],child,{'major':9}
        before=self.snapshot()
        _,child,_=adapter.plan(self.root,{**ENV,'PATH':'/home/container','DOTNET_ROOT':'/home/container/hostile','DOTNET_ROOT_X64':'/tmp/hostile'},release=release,runtime=types.SimpleNamespace(plan=runtime_plan),publication=publication,resolve_runtime=lambda:(Path('/usr/share/dotnet'),Path('/usr/share')),run=lambda args,**kw:calls.append((args,kw)))
        self.assertEqual(calls[0][0],['/usr/share/dotnet','--list-runtimes']);self.assertEqual(child['DOTNET_ROOT'],'/usr/share');self.assertEqual(child['DOTNET_ROOT_X64'],'/usr/share');self.assertEqual(self.snapshot(),before)
    def test_nonroot_or_writable_image_host_refuses(self):
        path=self.root/'dotnet';path.write_bytes(b'\x7fELF');path.chmod(0o777)
        with self.assertRaises(ValueError):adapter.trusted_image_file(path)
    def test_selected_legacy_private_runtime_stays_unchanged(self):
        child={'DOTNET_ROOT':'/verified/private','DOTNET_ROOT_X64':'/verified/private'}
        runtime=types.SimpleNamespace(plan=lambda root,env,**kw:(['verified-legacy'],dict(child),{'major':6}))
        _,actual,_=adapter.plan(self.root,ENV,release=release,runtime=runtime,publication=publication,resolve_runtime=lambda:self.fail('Legacy private runtime must not probe system CLI'))
        self.assertEqual(actual,child)
    def test_existing_data_refusal_precedes_runtime_probe(self):
        self.cfg.write_bytes(b'bad');runtime=types.SimpleNamespace(plan=lambda *args:self.fail('runtime must not be probed'))
        with self.assertRaises(ValueError):adapter.plan(self.root,ENV,release=release,runtime=runtime,publication=publication)
    @unittest.skipIf(os.name=='nt','POSIX symlink fixture')
    def test_linked_configuration_refuses_without_writes(self):
        original=self.root/'operator.json';original.write_bytes(JSON);self.cfg.unlink();self.cfg.symlink_to(original)
        before=self.snapshot()
        with patch.object(release,'install') as call,self.assertRaises(ValueError):self.install()
        call.assert_not_called();self.assertEqual(self.snapshot(),before)
if __name__=='__main__':unittest.main()
