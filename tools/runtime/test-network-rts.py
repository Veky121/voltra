"""Offline settings/identity fixtures, separate from real game acceptance."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,BASE/file)
    value=importlib.util.module_from_spec(spec);sys.modules[name]=value;spec.loader.exec_module(value);return value
module('native_release','native-release.py');module('ddnet_install','ddnet-install.py');module('ddnet_runtime','ddnet-runtime.py')
dd=module('ddrace_network','ddrace-network.py');ra=module('openra_family','openra-family.py')

class NetworkRTSTests(unittest.TestCase):
    def test_ddrace_legacy_upload_migration_preserves_sources_and_new_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'data/maps').mkdir(parents=True);(root/'data/maps/custom.map').write_bytes(b'operator-map')
            (root/'data/autoexec_server.cfg').write_text('echo legacy operator');(root/'ddnet/data').mkdir(parents=True)
            (root/'ddnet/data/autoexec_server.cfg').write_text('echo current operator')
            dd.migrate_legacy_data(root);dd.migrate_legacy_data(root)
            self.assertEqual((root/'ddnet/data/maps/custom.map').read_bytes(),b'operator-map')
            self.assertEqual((root/'ddnet/data/autoexec_server.cfg').read_text(),'echo current operator')
            self.assertEqual((root/'data/autoexec_server.cfg').read_text(),'echo legacy operator')
            (root/'data/maps/bad.map').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):dd.migrate_legacy_data(root)
    def test_original_ddrace_aliases_and_ipv4(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'ddnet/maps').mkdir(parents=True);(root/'ddnet/maps/Tutorial.map').write_bytes(b'map')
            args=dd.native_arguments(root,{'SERVER_PORT':'28010','SERVER_MAP':'Tutorial','SERVER_REGISTER':'ipv4','SERVER_PASSWORD':'literal $ " password'})
            self.assertIn('sv_register ipv4',args);self.assertIn('password "literal $ \\" password"',args)
            self.assertTrue((root/'.voltra/ddnet/rcon-password').is_file())
            with self.assertRaises(ValueError):dd.native_arguments(root,{'SERVER_PORT':'28010','SERVER_MAP':'Tutorial','SERVER_REGISTER':'1'})
    def test_nightly_uses_publisher_checksum(self):
        original=dd.text;original_prefix=dd.nightly_prefix
        try:
            dd.nightly_prefix=lambda:'DDNet-20.3-20261023-linux_x86_64'
            dd.text=lambda _:('a'*64)+'  DDNet-nightly-linux_x86_64.tar.xz\n'
            self.assertEqual(dd.release('nightly')['sha256'],'a'*64)
            self.assertEqual(dd.release('20.1.1')['version'],'20.1.1')
            dd.text=lambda _:''
            with self.assertRaises(ValueError):dd.release('nightly')
        finally:dd.text=original;dd.nightly_prefix=original_prefix
    def test_openra_all_original_controls_without_shell_interpolation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env={'SERVER_PORT':'28011','SERVER_NAME':'Literal $ " name','PASSWORD':'private; $(literal)','AUTH':'true','PUBLIC':'false','SINGLEPLAYER':'true','GEOIP':'false','ANONYMOUS':'true'}
            args=ra.arguments(root,env,'ra')
            for expected in ['Server.Name=Literal $ " name','Server.Password=private; $(literal)','Server.RequireAuthentication=true','Server.EnableSingleplayer=true','Server.ShareAnonymizedIPs=true','Server.EnableGeoIP=false','Server.AdvertiseOnline=false','Server.DiscoverNatDevices=False']:
                self.assertIn(expected,args)
            self.assertIn('Game.Mod=ra',args)
    def test_openra_original_support_data_migration_is_non_destructive(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);legacy=root/'.config/openra';legacy.mkdir(parents=True)
            (legacy/'settings.yaml').write_text('original-settings');(legacy/'replays').mkdir();(legacy/'replays/operator.orarep').write_bytes(b'original-replay')
            current=root/'OpenRAData';current.mkdir();(current/'settings.yaml').write_text('current-settings')
            ra.migrate_support(root);ra.migrate_support(root)
            self.assertEqual((current/'settings.yaml').read_text(),'current-settings')
            self.assertEqual((current/'replays/operator.orarep').read_bytes(),b'original-replay')
            self.assertEqual((legacy/'settings.yaml').read_text(),'original-settings')
    def test_openra_rejects_bad_inputs_and_escaping_support_dir(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as outside:
            root=Path(directory)
            for env in [{'SERVER_PORT':'0'},{'SERVER_PORT':'28011','AUTH':'yes'},{'SERVER_PORT':'28011','SERVER_NAME':'bad\nvalue'},{'SERVER_PORT':'28011','SERVER_MAP':'../bad'}]:
                with self.assertRaises(ValueError):ra.arguments(root,env,'cnc')
            (root/'OpenRAData').rmdir();(root/'OpenRAData').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):ra.arguments(root,{'SERVER_PORT':'28011'},'cnc')
    def test_openra_pinned_artifacts_are_distinct_and_stable(self):
        assets=[ra.selected('release-20250330',mod) for mod in ra.MODS]
        self.assertEqual(len({x['sha256'] for x in assets}),3)
        self.assertTrue(all(x['bytes']>40_000_000 for x in assets))
        with self.assertRaises(ValueError):ra.selected('../bad','ra')
    def test_stages_preserve_original_variables_and_independent_status(self):
        root=BASE.parents[3];profiles=json.loads((root/'.local/network-rts-games/profiles.json').read_text());catalog=json.loads((root/'internal/panel/game_library/upstream/catalog.json').read_text());existing=json.loads((root/'internal/panel/game_library/overrides.json').read_text())
        for path,profile in profiles.items():
            original=next(x for x in catalog['entries'] if x['path']==path)
            self.assertEqual(profile['upstream_sha256'],original['sha256'])
            self.assertEqual(profile['verification'],existing.get(path,{}).get('verification','not_verified'))
            keys={v['env_variable'] for v in profile['egg']['variables']}
            self.assertTrue(all(v['env_variable'] in keys for v in original['egg']['variables']))

if __name__=='__main__':unittest.main()
