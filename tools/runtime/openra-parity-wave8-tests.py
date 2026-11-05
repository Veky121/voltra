"""Local offline RA-only fixtures; no publisher requests or native processes."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('openra_wave8', BASE/'internal/panel/game_library/scripts/openra-family.py')
ra = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ra)

class OpenRARedAlertFixtures(unittest.TestCase):
    def test_original_controls_are_independent_literal_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            env = dict(SERVER_PORT='29120',SERVER_NAME='literal $ name',PASSWORD='literal; $(value)',PUBLIC='false',SINGLEPLAYER='true',AUTH='false',GEOIP='false',ANONYMOUS='true',RECORD_REPLAYS='false',SERVER_MAP='a'*40)
            argv = ra.arguments(Path(directory),env,'ra')
            for expected in ['Game.Mod=ra','Server.Name=literal $ name','Server.Password=literal; $(value)','Server.ListenPort=29120','Server.AdvertiseOnline=false','Server.EnableSingleplayer=true','Server.RequireAuthentication=false','Server.EnableGeoIP=false','Server.ShareAnonymizedIPs=true','Server.RecordReplays=false','Server.Map='+'a'*40]:
                self.assertIn(expected,argv)
    def test_existing_native_settings_are_never_rewritten_by_argument_planning(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); support=root/'OpenRAData'; support.mkdir()
            native=support/'settings.yaml'; original=b'# operator MiniYaml\r\nServer:\r\n\tName: Native\r\n'
            native.write_bytes(original)
            ra.arguments(root,dict(SERVER_PORT='29120'),'ra')
            self.assertEqual(native.read_bytes(),original)
    def test_bad_map_and_bool_and_control_characters_refuse(self):
        for overrides in [dict(SERVER_MAP='../bad'),dict(AUTH='yes'),dict(SERVER_NAME='bad\nvalue'),dict(SERVER_PORT='0')]:
            with self.subTest(overrides=overrides), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError): ra.arguments(Path(directory),dict(SERVER_PORT='29120')|overrides,'ra')
    def test_no_implicit_public_listing_or_nat(self):
        with tempfile.TemporaryDirectory() as directory:
            argv=ra.arguments(Path(directory),dict(SERVER_PORT='29120'),'ra')
            self.assertIn('Server.AdvertiseOnline=false',argv)
            self.assertIn('Server.DiscoverNatDevices=False',argv)
            self.assertIn('Server.RequireAuthentication=false',argv)
    def test_pinned_public_appimage_identity(self):
        asset=ra.selected('release-20250330','ra')
        self.assertEqual(asset['sha256'],'3cb71c7428188c8526dd8916993fc16fa17ba5f28a35968a8267f3db9f2186fe')
        self.assertEqual(asset['bytes'],44026360)
        self.assertEqual(asset['sha1'],'8b20afa42a991cedd3f2bf33b6876f4010748f04')
        self.assertEqual(asset['url'],'https://github.com/OpenRA/OpenRA/releases/download/release-20250330/OpenRA-Red-Alert-x86_64.AppImage')

if __name__ == '__main__': unittest.main()
