import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'internal/panel/game_library/scripts'))
# Shared imports use deployment underscore names.
for name in ('steam_template', 'native_config', 'native_console', 'small_games_family_runtime'):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'internal/panel/game_library/scripts' / (name.replace('_', '-') + '.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
spec = importlib.util.spec_from_file_location('mohaa_next', ROOT / 'internal/panel/game_library/scripts/mohaa-owner-next-runtime.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Authority(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='mohaa-owner-next-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        (self.root/'main').mkdir()
        (self.root/'main/Pak0.pk3').write_bytes(b'offline prerequisite placeholder, never launched')
        (self.root/'mohaa').mkdir()
        (self.root/'mohaa/omohaaded').write_bytes(b'offline executable placeholder, never launched')
        (self.root/'mohaa/omohaaded').chmod(0o755)
        self.env = {'SERVER_PORT':'12203','VOLTRA_ALLOCATED_PORTS':'12203'}
    def snapshot(self):
        return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
    def test_native_bytes_and_duplicates_survive_env_changes(self):
        cfg=self.root/'main/server.cfg'
        cfg.write_bytes(b'// operator\r\nset sv_hostname "A"\r\nset sv_hostname "B"\r\nunknown "x"\r\n')
        before=self.snapshot()
        self.env['SERVER_NAME']='Different'
        result=m.configure(self.root,self.env)
        self.assertEqual(before,self.snapshot())
        self.assertEqual(result[1][-2:],['+exec','server.cfg'])
    def test_seed_once(self):
        m.configure(self.root,self.env)
        before=self.snapshot()
        self.env['SERVER_NAME']='Changed'
        m.configure(self.root,self.env)
        self.assertEqual(before,self.snapshot())
    def test_refusals_preserve_bytes(self):
        for key,value in [('SERVER_PORT','9999'),('SERVER_NAME','bad;quit'),('SERVER_MAP','../../evil'),('LOG_DIR',str(self.root.parent))]:
            before=self.snapshot()
            with self.assertRaises(ValueError):m.configure(self.root,{**self.env,key:value})
            self.assertEqual(before,self.snapshot())
    def test_missing_binary_before_seed(self):
        (self.root/'mohaa/omohaaded').unlink()
        before=self.snapshot()
        with self.assertRaises(ValueError):m.configure(self.root,self.env)
        self.assertEqual(before,self.snapshot())
    def test_missing_assets_before_seed(self):
        (self.root/'main/Pak0.pk3').unlink()
        before=self.snapshot()
        with self.assertRaises(ValueError):m.configure(self.root,self.env)
        self.assertEqual(before,self.snapshot())
    def test_shadow_refusal(self):
        (self.root/'Logs/main').mkdir(parents=True)
        (self.root/'Logs/main/server.cfg').write_bytes(b'operator')
        before=self.snapshot()
        with self.assertRaises(ValueError):m.configure(self.root,self.env)
        self.assertEqual(before,self.snapshot())

if __name__=='__main__':unittest.main(verbosity=2)

