import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

BASE=Path('internal/panel/game_library/scripts')
def load(name):
    spec=importlib.util.spec_from_file_location(name,BASE/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
ENV={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010','VERSION':'1.5.4.7'}
class SourceTests(unittest.TestCase):
    def test_preflight_refuses_without_io(self):
        m=load('ragecoop-install')
        for bad in [{'SERVER_PORT':'28011'},{'VERSION':'bad/version'},{'MAX_PLAYERS':'0'},{'RELEASE_SHA256':'bad'}]:
            with self.subTest(bad=bad),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)
                with patch.object(m.urllib.request,'urlopen',side_effect=AssertionError('network')):
                    with self.assertRaises(ValueError):m.install(root,{**ENV,**bad})
                self.assertEqual(list(root.iterdir()),[])
    def test_install_failure_success_reinstall_preserves_operator_bytes(self):
        m=load('ragecoop-install');real=m.module
        release=load('native-release')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);config=b'<Settings><!--secret--><Password>private</Password><Resources><Item>x</Item><Item>y</Item></Resources><Unknown>42</Unknown></Settings>'
            (root/'Settings.xml').write_bytes(config)
            (root/'Resources').mkdir();(root/'Resources/mod.dll').write_bytes(b'operator')
            def download(identity,dest):
                if identity is m.LICENSE:dest.write_bytes(b'license');return
                with zipfile.ZipFile(dest,'w') as z:
                    z.writestr('RageCoop.Server',b'mocked binary')
                    z.writestr('Settings.xml',b'<Settings/>')
                    z.writestr('Resources/mod.dll',b'publisher default')
            with patch.object(m,'module',side_effect=lambda name:release if name=='native-release' else real(name)),patch.object(release,'download',side_effect=ValueError('mock failure')):
                with self.assertRaises(ValueError):m.install(root,ENV)
            self.assertEqual((root/'Settings.xml').read_bytes(),config)
            with patch.object(m,'module',side_effect=lambda name:release if name=='native-release' else real(name)),patch.object(release,'download',side_effect=download):
                m.install(root,ENV)
                self.assertEqual((root/'ragecoop/Settings.xml').read_bytes(),config)
                self.assertEqual((root/'ragecoop/Resources/mod.dll').read_bytes(),b'operator')
                (root/'Settings.xml').write_bytes(b'<Settings><Name>stale legacy</Name></Settings>')
                m.install(root,ENV)
                self.assertEqual((root/'ragecoop/Settings.xml').read_bytes(),config)
    def test_runtime_refusal_and_nested_unknowns(self):
        m=load('ragecoop-runtime')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'ragecoop').mkdir();p=root/'ragecoop/Settings.xml'
            for raw in [b'<Settings><Name>a</Name><Name>b</Name></Settings>',b'<!DOCTYPE Settings><Settings/>',b'<wrong/>']:
                p.write_bytes(raw)
                with self.assertRaises(ValueError):m.configure(root,ENV)
                self.assertEqual(p.read_bytes(),raw)
            p.write_bytes(b'<Settings><!--keep--><Password>secret</Password><Items><Item>a</Item><Item>b</Item></Items></Settings>')
            m.configure(root,{**ENV,'SERVER_NAME':'a & " < b'})
            xml=m.ET.fromstring(p.read_text());self.assertEqual(xml.findtext('Password'),'secret');self.assertEqual([x.text for x in xml.findall('Items/Item')],['a','b'])
    def test_console_boundary(self):
        m=load('ragecoop-runtime');console=unittest.mock.Mock();console.run.return_value=7
        with tempfile.TemporaryDirectory() as tmp,patch.object(m,'configure'),patch.object(m,'module',return_value=console):
            self.assertEqual(m.run(Path(tmp),{**ENV,'PYTHONHOME':'bad'}),7)
            args,kw=console.run.call_args;self.assertNotIn('PYTHONHOME',args[2]);self.assertEqual(kw['ready_marker'],b'Listening for clients');self.assertEqual(args[3],'\x03')
if __name__=='__main__':unittest.main(verbosity=2)
