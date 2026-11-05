import importlib.util
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

stage=load(Path(__file__).with_name('stage-hurtworld-wave28.py'),'stage')

class Hurtworld(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);scripts=self.root/'.voltra';scripts.mkdir()
        script=stage.stage()['egg']['scripts']['installation']['script']
        for name,delimiter,source in re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2\n",script,re.S):
            (scripts/name).write_text(source,encoding='utf-8')
        self.adapter=load(scripts/'hurtworld-wave28.py','hurtworld_test')
        self.env={'SERVER_PORT':'28002','QUERY_PORT':'28003','VOLTRA_ALLOCATED_PORTS':'28002,28003'}

    def test_seed_and_native_precedence(self):
        first=self.adapter.prepare(self.root,self.env)
        path=self.root/self.adapter.NAME
        path.write_bytes(b'# keep\r\nservername "Operator server"\r\nmaxplayers 12\r\ncreativemode 1\r\naddadmin 76561190000000001\r\naddadmin 76561190000000002\r\nplugin_option 9\r\n')
        before=path.read_bytes();argv=self.adapter.prepare(self.root,dict(self.env,HOSTNAME='Ignored',MAX_PLAYERS='99'))
        self.assertIn('servername Operator server',argv[argv.index('-exec')+1]);self.assertEqual(before,path.read_bytes())
        self.assertIn('host 28002;queryport 28003;',argv[argv.index('-exec')+1])

    def test_invalid_update_mode_cannot_seed_a_missing_document(self):
        target=self.root/self.adapter.NAME
        self.assertFalse(target.exists())
        with patch.object(self.adapter.shared,'install') as install:
            with self.assertRaises(ValueError):self.adapter.run(self.root,dict(self.env,VOLTRA_STEAM_AUTO_UPDATE='invalid'))
            install.assert_not_called()
        self.assertFalse(target.exists())

    def test_refusal_preserves_bytes(self):
        for suffix in (b'exec other.cfg\n',b'MAXPLAYERS 3\n',b'host 80\n',b'plugin_option 1;quit\n'):
            path=self.root/self.adapter.NAME
            raw=b'servername "Name"\nmaxplayers 60\ncreativemode 0\n'+suffix;path.write_bytes(raw)
            with self.assertRaises(ValueError):self.adapter.prepare(self.root,self.env)
            self.assertEqual(raw,path.read_bytes())

    def test_update_success_failure_and_exit(self):
        for failure in (False,True):
            console=type('Console',(),{'run':lambda *a,**k:130})()
            def update(*args):
                if failure:raise ValueError('mock update failure')
            with patch.object(self.adapter.shared,'install',side_effect=update) as install,patch.object(self.adapter.shared,'helper',return_value=console):
                env=dict(self.env,VOLTRA_STEAM_AUTO_UPDATE='1')
                if failure:
                    before=(self.root/self.adapter.NAME).read_bytes()
                    with self.assertRaises(ValueError):self.adapter.run(self.root,env)
                    self.assertEqual(before,(self.root/self.adapter.NAME).read_bytes())
                else:self.assertEqual(self.adapter.run(self.root,env),130)
                install.assert_called_once()

    def test_conflicting_autoexec_and_allocations(self):
        (self.root/'autoexec.cfg').write_text('servername conflicting\n')
        with self.assertRaises(ValueError):self.adapter.prepare(self.root,self.env)
        self.assertFalse((self.root/self.adapter.NAME).exists())
        (self.root/'autoexec.cfg').unlink()
        with self.assertRaises(ValueError):self.adapter.prepare(self.root,dict(self.env,QUERY_PORT='28002'))
        self.assertFalse((self.root/self.adapter.NAME).exists())

if __name__=='__main__':unittest.main()
