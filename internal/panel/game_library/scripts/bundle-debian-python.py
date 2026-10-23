#!/usr/bin/env python3
"""MIT. Bundle installed Debian Python for the matching Debian Steam runtime.

Run inside the Debian installer, after apt installed python3. The runtime image
must use the same Debian major release. Keep package notices beside the bundle.
"""
import json
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import time


def bundle(root):
    root = root.resolve()
    target = root / '.voltra/python'
    if not target.parent.resolve().is_relative_to(root) or target.is_symlink():
        raise ValueError('Python bundle escapes the server volume')
    target.parent.mkdir(parents=True, exist_ok=True)
    packages = subprocess.check_output(['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\n'], text=True)
    identity = {'python': sys.version.split()[0], 'debian_major': Path('/etc/debian_version').read_text().strip().split('.')[0],
                'packages_sha256': hashlib.sha256(packages.encode()).hexdigest()}
    if (target / 'runtime.json').is_file() and json.loads((target / 'runtime.json').read_text()) == identity:
        environment = {**os.environ, 'PYTHONHOME': str(target), 'LD_LIBRARY_PATH': str(target / 'lib')}
        probe = subprocess.run([str(target / 'bin/python3'), '-c', 'import ssl,sqlite3,urllib.request,tarfile,ctypes,json'], env=environment, capture_output=True)
        if probe.returncode == 0:
            print('Debian Python runtime already installed and import checks passed.', flush=True)
            return
    with tempfile.TemporaryDirectory(prefix='.python-', dir=target.parent) as temporary:
        stage = Path(temporary) / 'ready'
        (stage / 'bin').mkdir(parents=True)
        library = stage / 'lib'; library.mkdir()
        shutil.copy2(Path(sys.executable).resolve(), stage / 'bin/python3')
        shutil.copytree(sysconfig.get_path('stdlib'), library / ('python' + sysconfig.get_python_version()),
                        ignore=shutil.ignore_patterns('__pycache__', 'site-packages', 'dist-packages', 'test', 'tests'))
        binaries = [stage / 'bin/python3', *library.rglob('*.so')]
        dependencies = set()
        for binary in binaries:
            result = subprocess.run(['ldd', str(binary)], capture_output=True, text=True)
            if result.returncode:
                raise ValueError('Cannot inspect bundled Python dependencies')
            if 'not found' in result.stdout:
                raise ValueError('Installer is missing a Python shared library')
            dependencies.update(re.findall(r'=>\s+(/[^\s]+)', result.stdout))
        # Keep the runtime image's glibc and ELF loader together.
        glibc = ('libc.so.', 'libm.so.', 'libdl.so.', 'libpthread.so.', 'librt.so.', 'libresolv.so.', 'libutil.so.')
        for name in sorted(dependencies):
            source = Path(name)
            if not source.name.startswith(glibc):
                shutil.copy2(source, library / source.name)
        notices = stage / 'licenses'; notices.mkdir()
        for source in Path('/usr/share/doc').glob('*/copyright'):
            shutil.copy2(source, notices / (source.parent.name.replace(':', '_') + '.copyright'))
        (stage / 'packages.txt').write_text(packages)
        (stage / 'runtime.json').write_text(json.dumps(identity) + '\n')
        backup = root / '.voltra' / ('python-previous-' + str(time.time_ns()))
        if target.exists():
            os.replace(target, backup)
        try:
            os.replace(stage, target)
        except BaseException:
            if backup.exists():
                os.replace(backup, target)
            raise
        # Unchanged reinstalls reuse a checked bundle. Changed packages retain
        # the previous interpreter for recovery, without touching operator data.
    print('Debian Python runtime and package notices installed.', flush=True)


if __name__ == '__main__':
    bundle(Path.cwd())
