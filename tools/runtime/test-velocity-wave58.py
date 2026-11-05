import importlib.util,sys,unittest,tempfile,io,zipfile,hashlib
from pathlib import Path
from unittest.mock import patch
BASE=Path(sys.argv.pop(1)).resolve()
sys.path.insert(0,str(BASE))
import proxy_family_install as p

def jar(seed=b'bind = "0.0.0.0:25565"\n'):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        z.writestr('META-INF/MANIFEST.MF','Main-Class: example.Proxy\n')
        z.writestr('example/Proxy.class',bytes.fromhex('cafebabe00000045'))
        z.writestr('default-velocity.toml',seed)
    return out.getvalue()
class Velocity(unittest.TestCase):
    def test_preflight_before_publisher_and_no_mutation(self):
        for name,content in [('velocity.toml',b'broken = ['),('forwarding.secret',None),('velocity.jar',None),('.voltra',b'file')]:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as t:
                root=Path(t); target=root/name
                if content is None:target.mkdir()
                else:target.write_bytes(content)
                before={str(x.relative_to(root)):x.read_bytes() for x in root.rglob('*') if x.is_file()}
                with patch.object(p,'select_release',side_effect=AssertionError('publisher reached')):
                    with self.assertRaises(ValueError):p.install(root,'velocity',{'SERVER_JARFILE':'velocity.jar'})
                self.assertEqual(before,{str(x.relative_to(root)):x.read_bytes() for x in root.rglob('*') if x.is_file()})
    def test_symlink_refusal(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);(root/'real').write_text('');(root/'velocity.toml').symlink_to(root/'real')
            with patch.object(p,'fetch',side_effect=AssertionError('network')):
                with self.assertRaises(ValueError):p.install(root,'velocity',{})
    def test_install_and_reinstall_retains_operator_bytes(self):
        data=jar();identity={'url':'https://example.test/velocity.jar','sha256':hashlib.sha256(data).hexdigest()}
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            with patch.object(p,'select_release',return_value=identity),patch.object(p,'fetch',return_value=data):
                p.install(root,'velocity',{'SERVER_JARFILE':'velocity.jar'})
                self.assertEqual((root/'velocity.jar').read_bytes(),data)
                config=b'# operator\nbind = "0.0.0.0:25565"\nunknown = [1,2]\n[servers]\nlobby="localhost:25566"\n'
                (root/'velocity.toml').write_bytes(config);secret=(root/'forwarding.secret').read_bytes()
                p.install(root,'velocity',{'SERVER_JARFILE':'velocity.jar'})
                self.assertEqual((root/'velocity.toml').read_bytes(),config)
                self.assertEqual((root/'forwarding.secret').read_bytes(),secret)
                self.assertEqual((root/'forwarding.secret').stat().st_mode&0o777,0o600)
    def test_invalid_seed_preserves_working_jar(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);(root/'velocity.jar').write_bytes(b'working')
            with patch.object(p,'select_release',return_value={}),patch.object(p,'verified',return_value=jar(b'x=[')):
                with self.assertRaises(ValueError):p.install(root,'velocity',{'SERVER_JARFILE':'velocity.jar'})
            self.assertEqual((root/'velocity.jar').read_bytes(),b'working');self.assertFalse((root/'velocity.toml').exists())
if __name__=='__main__':unittest.main()
