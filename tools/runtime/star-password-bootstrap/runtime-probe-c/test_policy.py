"""MIT. Actual generator policy fixtures; no Windows binary execution."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('star_c_generate', Path(__file__).with_name('generate.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FixedPolicy(unittest.TestCase):
    def test_exact_manifest_and_reproducible_header(self):
        first = module.generate()
        self.assertEqual(module.generate(), first)
        manifest = json.loads((module.HERE / 'imports.json').read_text())['imports']
        self.assertEqual(len(manifest), 29)
        self.assertEqual(sum(map(len, manifest.values())), 655)
        self.assertEqual(first.count('static const ProbeExport exports_'), 29)

    def test_system32_and_apiset_policy(self):
        self.assertEqual(module.request('kernel32.dll'), 'C:\\windows\\system32\\kernel32.dll')
        self.assertEqual(module.request('api-ms-win-core-synch-l1-2-0.dll'), 'api-ms-win-core-synch-l1-2-0.dll')
        for name in ('../game.dll', 'C:\\game.dll', 'a/b.dll', 'ue4ss.dll', 'dwmapi.dll', 'bad\0.dll'):
            with self.assertRaises(ValueError): module.request(name)

    def test_named_and_ordinal_policy(self):
        self.assertEqual(module.ordinal('GetProcAddress'), 0)
        self.assertEqual(module.ordinal('#65535'), 65535)
        for symbol in ('', '#0', '#65536', '#-1', '#abc', 'bad\0value', 'bad\nvalue'):
            with self.assertRaises(ValueError): module.ordinal(symbol)

    def test_generated_fixed_paths_and_output_bound(self):
        manifest = json.loads((module.HERE / 'imports.json').read_text())['imports']
        for name, symbols in manifest.items():
            self.assertNotIn('/', module.request(name))
            for symbol in symbols:
                self.assertLess(len('MISSING_RUNTIME_EXPORT ' + name + ':' + symbol + '\n'), 512)
        source = (module.HERE / 'probe.c').read_text()
        self.assertIn('LOAD_LIBRARY_SEARCH_SYSTEM32', source)
        self.assertNotIn('LoadLibraryW(', source)
        self.assertNotIn('LoadLibraryA(', source)
        self.assertNotIn('GetEnvironmentVariable', source)
        self.assertNotIn('CreateProcess', source)


if __name__ == '__main__': unittest.main()
