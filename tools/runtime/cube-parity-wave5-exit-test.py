import contextlib
import importlib.machinery
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
loader = importlib.machinery.SourceFileLoader('cube_exit_candidate', str(ROOT / 'artifacts/game-parity-20261029/cube-parser-staging/cube-preflight.py.pending'))
spec = importlib.util.spec_from_loader(loader.name, loader)
module = importlib.util.module_from_spec(spec)
loader.exec_module(module)
class ActualProcessRuntime:
    def __init__(self, code): self.code = code
    def text(self, value, limit=2048): return value
    def run(self, root, env, kind):
        return subprocess.run([sys.executable, '-c', 'import sys; sys.exit(' + str(self.code) + ')'], check=False).returncode
class CubeExitTests(unittest.TestCase):
    def invoke(self, code):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            binary = root / 'assaultcube/bin_unix/linux_64_server'
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b'fixture-only')
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                result = module.run(ActualProcessRuntime(code), root, {'SERVER_PORT':'29100','VOLTRA_ALLOCATED_PORTS':'29100,29101'}, 'assaultcube')
            return result, output.getvalue()
    def test_actual_failure_retains_status(self):
        result, text = self.invoke(7)
        self.assertEqual(result, 7)
        self.assertEqual(text, '[ERROR] Cube server exited with status 7.\n')
    def test_actual_clean_exit_has_no_error(self):
        result, text = self.invoke(0)
        self.assertEqual(result, 0)
        self.assertEqual(text, '')
    def test_prerequisite_refusal_no_exit_diagnostic(self):
        with tempfile.TemporaryDirectory() as folder:
            output = io.StringIO()
            with contextlib.redirect_stdout(output), self.assertRaises(ValueError):
                module.run(ActualProcessRuntime(7), Path(folder), {'SERVER_PORT':'29100','VOLTRA_ALLOCATED_PORTS':'29100'}, 'assaultcube')
            self.assertEqual(output.getvalue(), '')
            self.assertEqual(list(Path(folder).iterdir()), [])
if __name__ == '__main__': unittest.main()
