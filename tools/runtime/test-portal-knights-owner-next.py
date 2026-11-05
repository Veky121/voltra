"""Offline synthetic files only; no game, Docker, network or subprocess launch."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock

BASE = Path('internal/panel/game_library/scripts')


class PortalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.modules = tempfile.TemporaryDirectory(prefix='portal-owner-modules-')
        target = Path(cls.modules.name)
        for source in BASE.iterdir():
            if source.suffix in ('.py', '.json'):
                (target / source.name.replace('-', '_')).write_bytes(source.read_bytes())
        sys.path.insert(0, str(target))
        import portal_knights_owner_next
        cls.helper = portal_knights_owner_next

    @classmethod
    def tearDownClass(cls):
        sys.path.pop(0)
        cls.modules.cleanup()

    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix='portal-owner-fixture-')
        self.addCleanup(self.fixture.cleanup)
        self.root = Path(self.fixture.name).resolve()
        self.env = dict(PORTAL_INSTALL_MODE='uploaded', SERVER_PORT='16365', AUTO_UPDATE='0')
        self.path, seed = self.helper.plan(self.root, self.env)
        self.path.parent.mkdir()
        self.path.write_bytes(seed)

    def test_native_authority_and_unknown_precision(self):
        value=json.loads(self.path.read_bytes())
        value['basicServerData']['name']='operator'
        value['admins']['credentials']['password']='operator-secret'
        value['unknown']=[{'x': 123456789012345678901234567890}, {'x': 2}]
        raw=json.dumps(value,indent=3).encode()+b'\n'
        self.path.write_bytes(raw)
        runner=Mock(return_value=17)
        installer=Mock()
        self.assertEqual(self.helper.start(self.root, {**self.env,'SERVER_NAME':'stale','ADMIN_PASS':'stale'}, installer, runner),17)
        self.assertEqual(self.path.read_bytes(),raw)
        installer.assert_not_called()
        self.assertNotIn('ADMIN_PASS',runner.call_args.args[1])

    def test_refusal_precedes_update_and_write(self):
        raw=self.path.read_bytes()
        for change in ({'SERVER_PORT':'16366'}, {'PORTAL_INSTALL_MODE':'steam'}, {'EXTRA_FLAGS':';bad'}, {'WINEARCH':'bad'}, {'AUTO_UPDATE':'maybe'}):
            installer,runner=Mock(),Mock()
            with self.assertRaises(ValueError):
                self.helper.start(self.root,{**self.env,'AUTO_UPDATE':'1',**change},installer,runner)
            installer.assert_not_called()
            runner.assert_not_called()
            self.assertEqual(self.path.read_bytes(),raw)

    def test_duplicate_and_malformed_refusal_preserves_bytes(self):
        for raw in (b'{"basicServerData":{},"basicServerData":{}}', b'{bad', self.path.read_bytes().replace(b'"canLogin": true',b'"canLogin": 1')):
            self.path.write_bytes(raw)
            with self.assertRaises((ValueError,KeyError)):
                self.helper.plan(self.root,self.env)
            self.assertEqual(self.path.read_bytes(),raw)

    def test_revalidate_after_installer(self):
        def installer(*args,**kwargs):
            self.path.write_bytes(b'{bad')
        runner=Mock()
        with self.assertRaises(ValueError):
            self.helper.start(self.root,{**self.env,'AUTO_UPDATE':'1'},installer,runner)
        runner.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
