"""Run explicit scripts: unittest discovery skips filenames containing hyphens."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TESTS = (
    'aska-parity-wave2.test.py',
    'aloft-parity-wave2-test.py',
    'avorion-parity-wave2-test.py',
    'astrocolony-parity-wave2-test.py',
    'kissmp-parity-wave2.test.py',
    'impostor-parity-wave2-tests.py',
)

if __name__ == '__main__':
    for name in TESTS:
        print('Running ' + name, flush=True)
        result = subprocess.run([sys.executable, str(ROOT / 'tools/runtime' / name)], cwd=ROOT)
        if result.returncode:
            raise SystemExit(result.returncode)
