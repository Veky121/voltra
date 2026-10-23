import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

BASE=Path('internal/panel/game_library/scripts')
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,BASE/file);result=importlib.util.module_from_spec(spec);sys.modules[name]=result;spec.loader.exec_module(result);return result
load('limbo_install','limbo-install.py');proxy=load('proxy_family_install','proxy-family-install.py')
def jar():
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as z:
        z.writestr('META-INF/MANIFEST.MF','Main-Class: example.Proxy\n');z.writestr('example/Proxy.class',bytes.fromhex('cafebabe0000003d'))
        z.writestr('default-velocity.toml','bind = "0.0.0.0:25565"\n[servers]\nlobby="127.0.0.1:25566"\n');z.writestr('viaaas.yml','bind-addresses: ["0.0.0.0"]\n')
    return stream.getvalue()

class Proxy(unittest.TestCase):
    def test_original_selectors_pinned_and_no_silent_fallback(self):
        for game in proxy.PINNED:self.assertEqual(proxy.select_release(game,{},'server.jar')['sha256'],proxy.PINNED[game]['sha256'])
        for game in ['velocity','waterfall','travertine']:
            with self.assertRaises(ValueError):proxy.select_release(game,{'VELOCITY_VERSION':'../../bad','MINECRAFT_VERSION':'../../bad'},'server.jar')
        with self.assertRaises(ValueError):proxy.select_release('waterdog',{'WATERDOG_VERSION':'1'},'server.jar')
    def test_original_travertine_link_and_safe_placeholders(self):
        env={'DL_LINK':'https://example.test/{{PROJECT}}/${MINECRAFT_VERSION}/${BUILD_NUMBER}/{{SERVER_JARFILE}}','MINECRAFT_VERSION':'1.16','BUILD_NUMBER':'191','DOWNLOAD_SHA256':'a'*64}
        self.assertEqual(proxy.select_release('travertine',env,'custom.jar')['url'],'https://example.test/travertine/1.16/191/custom.jar')
        env['DL_LINK']='https://example.test/${UNKNOWN}'
        with self.assertRaises(ValueError):proxy.select_release('travertine',env,'custom.jar')
    def test_existing_native_config_plugins_secrets_retained(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);data=jar();proxy.seed_config(root,'velocity',data);secret=(root/'forwarding.secret').read_bytes();self.assertGreaterEqual(len(secret),40);self.assertEqual((root/'forwarding.secret').stat().st_mode&0o777,0o600)
            (root/'velocity.toml').write_text('operator native settings');proxy.seed_config(root,'velocity',data);self.assertEqual((root/'velocity.toml').read_text(),'operator native settings');self.assertEqual((root/'forwarding.secret').read_bytes(),secret)
    def test_current_viaaas_and_waterdog_schema(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);proxy.seed_config(root,'viaaas',jar());self.assertIn('bind-addresses',(root/'config/viaaas.yml').read_text());proxy.seed_config(root,'waterdog',jar());config=json.loads((root/'config.yml').read_text());self.assertEqual(config['listener']['transport'],'both');self.assertEqual(config['nethernet']['webrtc_port'],19133);self.assertFalse(config['nethernet']['signaling']['stun_discovery'])
    def test_executable_jar_and_state_confinement(self):
        self.assertEqual(proxy.jar_info(jar()),('example.Proxy',61))
        with tempfile.TemporaryDirectory() as temp,tempfile.TemporaryDirectory() as outside:
            root=Path(temp);(root/'.voltra').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):proxy.verified(root,{'sha256':'a'*64,'url':'https://example.test/file.jar'})
            with self.assertRaises(ValueError):proxy.install(root,'velocity',{'SERVER_JARFILE':'../escape.jar'})

if __name__=='__main__':unittest.main()
