#!/usr/bin/env python3
"""MIT. Original DDRaceNetwork recipe controls on the shared native DDNet engine."""
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile
import urllib.request
from ddnet_install import select_release, text
from ddnet_runtime import arguments, run
from native_release import install_release


def nightly_prefix():
    # The nightly URL is stable, but its internal root includes build/date.
    # Read only its first tar header; install_release still verifies the full
    # archive against the published checksum before any extraction.
    with urllib.request.urlopen('https://ddnet.org/downloads/DDNet-nightly-linux_x86_64.tar.xz', timeout=60) as response:
        with tarfile.open(fileobj=response, mode='r|xz') as archive:
            name = next(iter(archive)).name.rstrip('/')
    if not re.fullmatch(r'DDNet-[A-Za-z0-9._-]+-linux_x86_64', name):
        raise ValueError('Publisher nightly archive root is unsupported')
    return name


def release(version):
    if version != 'nightly':
        return select_release(version)
    name = 'DDNet-nightly-linux_x86_64.tar.xz'
    sums = text('https://ddnet.org/downloads/sha256sums.txt')
    hashes = re.findall(r'^([a-f0-9]{64})\s+\*?' + re.escape(name) + r'\s*$', sums, re.MULTILINE)
    if len(hashes) != 1:
        raise ValueError('Published nightly checksum is missing or ambiguous')
    return {'version': 'nightly', 'prefix': nightly_prefix(),
            'url': 'https://ddnet.org/downloads/' + name, 'sha256': hashes[0]}


def install(root, env):
    if os.uname().machine not in ('x86_64', 'amd64'):
        raise ValueError('Publisher archive requires Linux x64')
    migrate_legacy_data(root)
    install_release(root, release(env.get('VERSION', '20.1.1')), 'ddnet', 'DDNet-Server',
                    {'storage.cfg': 'add_path $CURRENTDIR\nadd_path $DATADIR\nadd_path $APPDIR\n'})


def migrate_legacy_data(root):
    """Retain original recipe uploads when moving to the shared engine folder.

    Source files stay untouched. Existing shared-layout files always win.
    Do not follow uploaded symlinks or copy any managed private state.
    """
    names = {'data', 'maps', 'maps7', 'demos', 'autoexec_server.cfg', 'storage.cfg', 'myServerconfig.cfg'}
    names.update(p.name for p in root.iterdir() if p.is_file() and p.suffix in ('.sqlite', '.sqlite3', '.db'))
    target = root/'ddnet'
    for name in sorted(names):
        source = root/name
        if source.is_symlink():
            raise ValueError('Legacy game data migration does not follow symlinks')
        if not source.exists():
            continue
        entries = [source, *source.rglob('*')] if source.is_dir() else [source]
        for entry in entries:
            if entry.is_symlink():
                raise ValueError('Legacy game data migration does not follow symlinks')
            destination = target/entry.relative_to(root)
            if not destination.resolve().is_relative_to(root.resolve()) or destination.is_symlink():
                raise ValueError('Legacy data target escapes server volume')
            if entry.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
            elif entry.is_file() and not destination.exists():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(entry, destination)
                metadata=entry.stat()
                os.chown(destination, metadata.st_uid, metadata.st_gid)


def native_arguments(root, env):
    registration = env.get('SERVER_REGISTER', '0')
    if registration not in ('0', 'ipv4'):
        raise ValueError('Register server must be 0 or ipv4')
    mapped = dict(env, SERVER_PASS=env.get('SERVER_PASSWORD', ''), PUBLIC_SERVER='0')
    argv = arguments(mapped, root)
    argv[argv.index('sv_register 0')] = 'sv_register ' + registration
    return argv


if __name__ == '__main__':
    root = Path.cwd().resolve()
    if len(sys.argv) > 1 and sys.argv[1] == 'install':
        install(root, os.environ)
    else:
        automatic = os.environ.get('AUTO_UPDATE', '0')
        if automatic not in ('0', '1'):
            raise ValueError('Auto update must be 0 or 1')
        if automatic == '1':
            install(root, os.environ)
        raise SystemExit(run(root, native_arguments(root, os.environ)))
