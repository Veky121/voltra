"""Run canonical helper regressions locally; the legacy mjs harness uses SSH."""
from pathlib import Path
import runpy
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'internal/panel/game_library/scripts'
if len(sys.argv)>1 and sys.argv[1]=='legacy':
    sys.argv=[str(ROOT/'tools/runtime/test-ddnet.py')]
    runpy.run_path(sys.argv[0],run_name='__main__',init_globals={
        'NATIVE_SOURCE':(BASE/'native-release.py').read_text(),
        'INSTALL_SOURCE':(BASE/'ddnet-install.py').read_text(),
        'RUNTIME_SOURCE':(BASE/'ddnet-runtime.py').read_text(),
    })
else:
    for command in ([sys.executable,str(ROOT/'tools/runtime/ddnet-latest-parity-wave4-test.py')],
                    [sys.executable,__file__,'legacy'],
                    [sys.executable,str(ROOT/'tools/runtime/source-pair-parity-wave4-test.py')]):
        result=subprocess.run(command,cwd=ROOT)
        if result.returncode:raise SystemExit(result.returncode)
