#!/usr/bin/env python3
"""MIT. Reuse the shared GoldSrc native console and typed runtime."""
import os
from pathlib import Path
import runpy
from cs16_modules_install import install, selection
import json

root = Path.cwd()
selection(os.environ, json.loads((root/'.voltra/cs16-modules-release.json').read_text(encoding='utf-8-sig')))
automatic = os.environ.get('VOLTRA_STEAM_AUTO_UPDATE', os.environ.get('AUTO_UPDATE','0'))
validate = os.environ.get('VALIDATE','0')
if automatic not in ('0','1') or validate not in ('0','1'): raise ValueError('Update/validate flags must be 0 or 1')
if automatic == '1': install(root, os.environ, validate == '1')
os.environ.update(VOLTRA_GOLDSRC_RECIPE='generic', VOLTRA_STEAM_AUTO_UPDATE='0')
runpy.run_path(str(root/'.voltra/goldsrc_runtime.py'), run_name='__main__')
