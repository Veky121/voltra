"""Wave45 source fixtures. Never start a process or acquire publisher data."""
import sys
sys.dont_write_bytecode=True
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import types

BASE=Path('internal/panel/game_library/scripts')
def load(name):
    spec=importlib.util.spec_from_file_location(name,BASE/(name+'.py'))
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
ENV={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010'}
class Install(unittest.TestCase):
    def fixture(self,root):
        (root/'gtac/resources').mkdir(parents=True)
        (root/'gtac/server.xml').write_bytes(b'<server><!--operator--><password>secret</password><resources><resource src="one"/><resource src="two"/></resources><unknown v="x"/></server>\r\n')
        (root/'gtac/resources/save.db').write_bytes(b'operator save')
        (root/'resources').mkdir();(root/'resources/save.db').write_bytes(b'legacy save')
        (root/'resources/mod.js').write_bytes(b'legacy mod')
        (root/'server.xml').write_bytes(b'<server>legacy</server>')
    def test_positive_import_and_reinstall(self):
        m=load('gtac-install');real=m.module;release=Mock()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root);original=(root/'gtac/server.xml').read_bytes()
            def install(*args):
                (root/'gtac/server.xml').write_bytes(b'<server>publisher</server>')
            release.install_release.side_effect=install
            with patch.object(m,'module',side_effect=lambda n:release if n=='native-release' else real(n)):
                m.install(root,ENV);m.install(root,ENV)
            self.assertEqual(release.install_release.call_count,2)
            self.assertEqual(release.install_release.call_args.args[2:],('gtac','Server'))
            self.assertEqual((root/'gtac/server.xml').read_bytes(),original)
            self.assertEqual((root/'gtac/resources/save.db').read_bytes(),b'operator save')
            self.assertEqual((root/'gtac/resources/mod.js').read_bytes(),b'legacy mod')
            self.assertEqual((root/'resources/save.db').read_bytes(),b'legacy save')
    def test_failure_restores_xml_even_when_removed(self):
        m=load('gtac-install');real=m.module;release=Mock()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root);original=(root/'gtac/server.xml').read_bytes()
            def fail(*args):
                (root/'gtac/server.xml').unlink();raise RuntimeError('mock acquisition failure')
            release.install_release.side_effect=fail
            with patch.object(m,'module',side_effect=lambda n:release if n=='native-release' else real(n)):
                with self.assertRaisesRegex(RuntimeError,'mock acquisition'):m.install(root,ENV)
            self.assertEqual((root/'gtac/server.xml').read_bytes(),original)
            self.assertFalse((root/'.voltra').exists())
            self.assertFalse((root/'gtac/resources/mod.js').exists())
    def test_preflight_refuses_without_release_or_writes(self):
        for bad in [{'DL_VERSION':'latest'},{'SERVER_PORT':'28011'},{'MAX_PLAYERS':'129'},{'GAMETYPE':'invalid'},{'SERVER_PASSWORD':'line\nbreak'}]:
            with self.subTest(bad=bad),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);m=load('gtac-install');real=m.module;release=Mock()
                with patch.object(m,'module',side_effect=lambda n:release if n=='native-release' else real(n)):
                    with self.assertRaises(ValueError):m.install(root,{**ENV,**bad})
                release.install_release.assert_not_called();self.assertEqual(list(root.iterdir()),[])
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root);(root/'gtac/resources/mod.js').mkdir()
            before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
            m=load('gtac-install');real=m.module;release=Mock()
            with patch.object(m,'module',side_effect=lambda n:release if n=='native-release' else real(n)):
                with self.assertRaises(ValueError):m.install(root,ENV)
            release.install_release.assert_not_called()
            self.assertEqual(before,{str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()})
    def test_console_boundary_mocked(self):
        m=load('gtac-runtime');real=m.module;console=Mock();console.run.return_value=7
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'gtac').mkdir();(root/'gtac/server.xml').write_text('<server/>')
            with patch.object(m,'module',side_effect=lambda n:console if n=='native-console' else real(n)):
                self.assertEqual(m.run(root,{**ENV,'SERVER_PASSWORD':'private','PYTHONHOME':'bootstrap'}),7)
            args,kwargs=console.run.call_args
            self.assertEqual(args[1],[str(root/'gtac/Server')]);self.assertEqual(args[3],'quit')
            self.assertNotIn('PYTHONHOME',args[2]);self.assertEqual(kwargs['credentials'],['private'])
if __name__=='__main__':unittest.main()
