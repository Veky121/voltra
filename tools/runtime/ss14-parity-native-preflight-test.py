import runpy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

adapter=runpy.run_path(str(Path(__file__).with_name('test-ss14-parity.py')))['adapter']

class NativePreflight(unittest.TestCase):
    def test_existing_known_invalid_controls_refuse_without_mutation(self):
        for value in ('[net]\ntickrate=0\n','[net]\nmax_connections=true\n','[game]\nsoft_max_players=257\n','[game]\nhostname=123\n','[hub]\nadvertise=0\n'):
            with self.subTest(value=value),tempfile.TemporaryDirectory() as d:
                p=Path(d)/'ss14/server_config.toml';p.parent.mkdir();p.write_text(value)
                before=p.read_bytes()
                with self.assertRaises(ValueError):adapter.seed(d,{})
                self.assertEqual(p.read_bytes(),before)
                self.assertEqual(list(Path(d).rglob('*')),[p.parent,p])

    def test_invalid_binding_refuses_before_seed_or_child(self):
        with tempfile.TemporaryDirectory() as d,patch.object(adapter,'run',return_value=0) as run:
            with self.assertRaises(ValueError):adapter.launch(d,{'SERVER_PORT':'29106','VOLTRA_ALLOCATED_PORTS':'29107'})
            self.assertEqual(list(Path(d).iterdir()),[]);run.assert_not_called()

    def test_existing_unknowns_comments_and_valid_controls_keep_exact_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'ss14/server_config.toml';p.parent.mkdir()
            before=b'# operator\r\n[game]\nhostname="Native $literal"\nsoft_max_players=8\n[net]\ntickrate=30\nmax_connections=8\n[unknown]\nopaque="retain"\n'
            p.write_bytes(before);adapter.seed(d,{'SERVER_NAME':'stale'})
            self.assertEqual(p.read_bytes(),before)

    def test_invalid_native_config_prevents_acquisition(self):
        with tempfile.TemporaryDirectory() as d,patch.object(adapter,'tar_install') as runtime,patch.object(adapter.native_zip_release,'install_release') as publisher:
            p=Path(d)/'ss14/server_config.toml';p.parent.mkdir();p.write_bytes(b'[net]\ntickrate=0\n')
            before=p.read_bytes()
            with self.assertRaises(ValueError):adapter.install(d,{})
            runtime.assert_not_called();publisher.assert_not_called();self.assertEqual(p.read_bytes(),before)

if __name__=='__main__':unittest.main()
