"""Focused offline checks. No acquisition or native success is simulated."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[2]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, BASE / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
scripts = 'internal/panel/game_library/scripts/'
ai = load('ai', scripts+'assetto-ai-native.py')
authority = load('authority', scripts+'assetto-native-authority.py')
shared = authority.load_shared()
release = load('release', scripts+'assetto-ai-release.py')

class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.env = dict(SERVER_PORT='9600', HTTP_PORT='8081', VOLTRA_ALLOCATED_PORTS='9600,8081', ADMIN_PASSWORD='fixture-only')
        self.put('cfg/server_cfg.ini', '[SERVER]\nTRACK=owned\nCARS=owned\nADMIN_PASSWORD=fixture-only\n[PRACTICE]\nTIME=120\n')
        self.put('cfg/entry_list.ini', '[CAR_0]\nMODEL=owned\nAI=fixed\n')
        self.put('cfg/extra_cfg.yml', 'EnableAi: true\n')
        self.put('content/tracks/owned/data/surfaces.ini', '[SURFACE_0]\n')
        self.put('content/tracks/owned/ai/fast_lane.ai', 'synthetic-test-not-game-content')
        self.put('content/cars/owned/data/car.ini', '[BASIC]\n')
    def put(self, name, text):
        path=self.root/name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    def snapshot(self):
        return {p.relative_to(self.root).as_posix():p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
    def check(self):
        return ai.content_preflight(authority, shared, self.root, self.env)
    def test_prerequisite_plan_no_mutation(self):
        before=self.snapshot(); self.check(); self.assertEqual(before,self.snapshot())
    def test_missing_spline_refuses_without_mutation(self):
        (self.root/'content/tracks/owned/ai/fast_lane.ai').unlink()
        before=self.snapshot()
        with self.assertRaises(ValueError):self.check()
        self.assertEqual(before,self.snapshot())
    def test_mismatched_entry_and_race_refused(self):
        for name,text in [('cfg/entry_list.ini','[CAR_0]\nMODEL=missing\n'),('cfg/server_cfg.ini','[SERVER]\nTRACK=owned\nCARS=owned\nADMIN_PASSWORD=fixture-only\n[RACE]\n')]:
            self.put(name,text)
            with self.assertRaises(ValueError):self.check()
    def test_modified_binary_refuses_before_download(self):
        self.put('AssettoServer','operator-binary')
        before=self.snapshot()
        with patch.object(release,'download') as download:
            with self.assertRaises(ValueError):release.install_release(self.root,{},'.','AssettoServer')
            download.assert_not_called()
        self.assertEqual(before,self.snapshot())
    def test_repair_preserves_unmodified_publisher_configuration(self):
        self.put('AssettoServer','publisher-binary')
        files={'AssettoServer':release.sha256(self.root/'AssettoServer')}
        for name in ['cfg/extra_cfg.yml','content/cars/owned/data/car.ini']:
            files[name]=release.sha256(self.root/name)
        self.put('.voltra/release.json',json.dumps(dict(sha256='old',binary_sha256=files['AssettoServer'],files=files)))
        before=self.snapshot()
        def extract(archive,ready,prefix):
            for name in files:
                target=ready/name; target.parent.mkdir(parents=True,exist_ok=True); target.write_text('new-publisher-content')
        # Windows lacks chown. This fixture verifies bytes, not Linux ownership.
        with patch.object(release,'download'),patch.object(release,'extract',side_effect=extract),patch.object(release,'preserve_identity'):
            release.install_release(self.root,dict(sha256='new',version='fixture',prefix=None),'.','AssettoServer')
        for name in files:
            if name!='AssettoServer':self.assertEqual(before[name],(self.root/name).read_bytes())

if __name__=='__main__':unittest.main(verbosity=2)
