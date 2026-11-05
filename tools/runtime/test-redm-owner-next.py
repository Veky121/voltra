import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import json

spec=importlib.util.spec_from_file_location('redm',Path('internal/panel/game_library/scripts/redm-owner-next.py'))
redm=importlib.util.module_from_spec(spec);spec.loader.exec_module(redm)
class RedM(unittest.TestCase):
    def env(self):
        return {'SERVER_PORT':'30120','VOLTRA_ALLOCATED_PORTS':'30120','CFX_VERSION':'latest'}
    def test_missing_key_refuses_before_acquisition(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            with self.assertRaisesRegex(ValueError,'real Cfx'): redm.install(root,self.env())
            self.assertEqual(list(root.iterdir()),[])
    def test_native_authority_and_unknown_duplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            raw='# retained\r\nsv_hostname "Native name" # keep\r\nsv_maxclients 12\r\nsv_licenseKey "fixture-only-not-a-real-key"\r\nset unknown a\r\nset unknown b\r\n'
            (root/'server.cfg').write_bytes(raw.encode())
            effective, content=redm.prepare(root,{**self.env(),'SERVER_HOSTNAME':'stale','MAX_PLAYERS':'32'})
            self.assertEqual(effective['SERVER_HOSTNAME'],'Native name')
            self.assertEqual(effective['MAX_PLAYERS'],'12')
            self.assertIn(b'set unknown a\r\nset unknown b\r\n',content)
            self.assertEqual((root/'server.cfg').read_bytes(),raw.encode())
            with self.assertRaisesRegex(ValueError,'SHA256'):redm.install(root,self.env())
            self.assertEqual(list(root.iterdir()),[root/'server.cfg'])
    def test_ambiguous_config_refuses_byte_unchanged(self):
        for raw in ['sv_hostname a\nSV_HOSTNAME b\n','exec private.cfg\n','sv_hostname a;quit\n','set gamename gta5\n','sv_maxclients 33\n']:
            with self.subTest(raw=raw),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);cfg=root/'server.cfg';cfg.write_bytes(raw.encode())
                with self.assertRaises(ValueError):redm.install(root,self.env())
                self.assertEqual(cfg.read_bytes(),raw.encode());self.assertEqual(list(root.iterdir()),[cfg])
    def test_original_variables_and_exact_fragment(self):
        recipe='rdr/redm/egg-red-m.json'
        upstream=next(e for e in json.loads(Path('internal/panel/game_library/upstream/catalog.json').read_text())['entries'] if e['path']==recipe)
        staged=json.loads(Path('artifacts/game-parity-20261029/redm-owner-next/profile.json').read_text())
        self.assertEqual(list(staged),[recipe])
        self.assertEqual(staged[recipe]['egg']['variables'][:len(upstream['egg']['variables'])],upstream['egg']['variables'])
        script=staged[recipe]['egg']['scripts']['installation']['script']
        self.assertIn(Path('internal/panel/game_library/scripts/redm-owner-next.py').read_text(),script)
        self.assertIn('redm-owner-next.py',staged[recipe]['egg']['startup'])
if __name__=='__main__':unittest.main()
