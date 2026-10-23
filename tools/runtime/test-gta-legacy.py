import importlib.util
from pathlib import Path
import tempfile
import tomllib
import unittest
import json

def load(name):
    spec=importlib.util.spec_from_file_location(name,Path('internal/panel/game_library/scripts')/(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

class Legacy(unittest.TestCase):
    def test_archives_explicit_and_strong(self):
        installer=load('gta-legacy-install')
        for game in ['altv','ragemp']:
            for env in [{},{'DEDICATED_ARCHIVE_URL':'http://example.test/archive','DEDICATED_ARCHIVE_SHA256':'a'*64},{'DEDICATED_ARCHIVE_URL':'https://example.test/archive','DEDICATED_ARCHIVE_SHA256':'weak'}]:
                with self.assertRaises(ValueError):installer.identity(game,env)
            self.assertEqual(installer.identity(game,{'DEDICATED_ARCHIVE_URL':'https://example.test/archive','DEDICATED_ARCHIVE_SHA256':'a'*64})['sha256'],'a'*64)
    def test_toml_preserves_lists_sections_comments(self):
        runtime=load('gta-legacy-runtime')
        raw='# retain\nmodules = ["js-module"]\nresources = ["my-resource"]\nport=1\n[voice]\nexternalHost="localhost"\n'
        result=runtime.patch_toml(raw,{'port':28010,'description':'Literal " $ & < >','password':''});parsed=tomllib.loads(result)
        self.assertEqual(parsed['modules'],['js-module']);self.assertEqual(parsed['resources'],['my-resource']);self.assertEqual(parsed['voice']['externalHost'],'localhost');self.assertEqual(parsed['port'],28010);self.assertEqual(parsed['description'],'Literal " $ & < >');self.assertIn('# retain',result)
        multiline='custom = """\nport = 7\n[voice]\n"""\nport = 1\n'
        self.assertEqual(tomllib.loads(runtime.patch_toml(multiline,{'port':28010}))['custom'],tomllib.loads(multiline)['custom'])
    def test_ragemp_http_offset_and_custom_config(self):
        runtime=load('gta-legacy-runtime')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'ragemp').mkdir();p=root/'ragemp/conf.json';p.write_text('{"csharp":true,"my_plugin":{"keep":1}}')
            env={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010','SERVER_NAME':'Literal " $ &','MAX_PLAYERS':'12'}
            with self.assertRaises(ValueError):runtime.configure('ragemp',root,env)
            env['VOLTRA_ALLOCATED_PORTS']='28010,28011';runtime.configure('ragemp',root,env);config=json.loads(p.read_text());self.assertTrue(config['csharp']);self.assertEqual(config['my_plugin'],{'keep':1});self.assertEqual(config['maxplayers'],12)

if __name__=='__main__':unittest.main()
