"""Explicit canonical-wrapper fixtures, without game acquisition or execution."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
for file in ('cryofall-parity-wave4-test.py', 'deadmatter-parity-wave5-test.py'):
    print('Running ' + file, flush=True)
    result = subprocess.run([sys.executable, str(root / 'tools/runtime' / file)], cwd=root)
    if result.returncode:
        raise SystemExit(result.returncode)
