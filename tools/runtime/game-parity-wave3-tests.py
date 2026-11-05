"""Explicit offline fixture suite; no game payload or publisher acquisition."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TESTS = (
    'archean-parity-wave3-test.py',
    'barotrauma-parity-wave3.test.py',
    'brickadia-parity-wave3-test.py',
    'assetto-parity-wave3-test.py',
    'automobilista-parity-wave3-test.py',
    'colonysurvival-parity-wave3-tests.py',
    'conan-parity-wave3.test.py',
    'test-assetto-ams-native.py',
)

if __name__ == '__main__':
    for name in TESTS:
        print('Running ' + name, flush=True)
        result = subprocess.run([sys.executable, str(ROOT / 'tools/runtime' / name)], cwd=ROOT)
        if result.returncode: raise SystemExit(result.returncode)
