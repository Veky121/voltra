"""Explicit canonical-helper fixtures. No publisher or game execution."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
for script in ('citadel-parity-wave4-test.py', 'cubicodyssey-parity-wave5-test.py'):
    print('Checking canonical helper with ' + script, flush=True)
    subprocess.run([sys.executable, str(ROOT/'tools/runtime'/script)], cwd=ROOT, check=True)
