#!/usr/bin/env python3
"""Diagnostic fixture only: allow its private collector to finalize after exit."""
import os
from pathlib import Path
import re
import stat
import sys
import time
from crafting_runtime import main


def entry(root, run_id, environment):
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', run_id):
        raise ValueError('Invalid diagnostic run identity')
    root = Path(root).resolve()
    directory = root / '.voltra/diagnostics'
    if (root / '.voltra').is_symlink() or directory.is_symlink() or not directory.is_dir():
        raise ValueError('Diagnostic directory changed')
    flag = directory / ('collector-' + run_id + '.done')
    if flag.exists() or flag.is_symlink():
        raise ValueError('Diagnostic identity already completed')
    native_code = main(root, environment)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            descriptor = os.open(flag, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            time.sleep(.05)
            continue
        with os.fdopen(descriptor, 'rb') as source:
            metadata = os.fstat(source.fileno())
            if stat.S_ISREG(metadata.st_mode) and metadata.st_size <= 128 and source.read(128) == run_id.encode():
                break
        time.sleep(.05)
    return native_code


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise ValueError('One diagnostic identity is required')
    raise SystemExit(entry(Path.cwd(), sys.argv[1], dict(os.environ)))
