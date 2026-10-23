#!/usr/bin/env python3
"""MIT. Checked publisher Xonotic packages with staged, recoverable updates."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import stat
import tempfile
import time
import urllib.request
import zipfile
from native_release import sha256
from native_zip_release import extract

STABLE_SHA512 = 'cb39879e96f19abb2877588c2d50c5d3e64dd68153bec3dd1bebedf4d765e506afa419c28381d7005aed664cb1a042571c132b5b319e4308cab67745d996c2a6'
MAX_ARCHIVE = 3 * 1024**3


def fetch(url, destination=None):
    if not url.startswith('https://'):
        raise ValueError('Xonotic downloads require HTTPS')
    digest, count, chunks = hashlib.sha512(), 0, []
    with urllib.request.urlopen(url, timeout=120) as response:
        if not response.geturl().startswith('https://'):
            raise ValueError('Xonotic download redirected outside HTTPS')
        output = destination.open('xb') if destination else None
        try:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                if count > (MAX_ARCHIVE if destination else 1024 * 1024):
                    raise ValueError('Xonotic download exceeds its size limit')
                digest.update(chunk)
                if output:
                    output.write(chunk)
                else:
                    chunks.append(chunk)
        finally:
            if output:
                output.close()
    return digest.hexdigest() if destination else b''.join(chunks).decode('utf-8')


def resolve_release(env):
    channel = env.get('UPDATE_CHANNEL', 'release')
    version = env.get('VERSION', '0.8.6')
    if channel == 'release':
        if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version):
            raise ValueError('VERSION must be a published numeric Xonotic release')
        base, name = 'https://dl.xonotic.org/', 'xonotic-' + version
        checksum = STABLE_SHA512 if version == '0.8.6' else None
    elif channel == 'autobuild':
        base, name, checksum = 'https://beta.xonotic.org/autobuild/', 'Xonotic-latest', None
    else:
        raise ValueError('UPDATE_CHANNEL must be release or autobuild')
    filename = name + '.zip'
    if checksum is None:
        rows = [line.split() for line in fetch(base + name + '.sha512').splitlines()]
        matches = [row[0].lower() for row in rows if len(row) == 2 and row[1].lstrip('*') == filename and re.fullmatch(r'[a-fA-F0-9]{128}', row[0])]
        if len(matches) != 1:
            raise ValueError('Publisher checksum does not uniquely identify this package')
        checksum = matches[0]
    return {'version': version if channel == 'release' else 'autobuild', 'channel': channel,
            'url': base + filename, 'sha512': checksum}


def unpack(archive, ready):
    # Preserve publisher source/licenses and safely materialize internal ZIP links.
    # The shared extractor still owns traversal, duplicate and expansion limits.
    links, regular = {}, []
    with zipfile.ZipFile(archive) as source:
        seen, total = set(), 0
        for member in source.infolist():
            parts = PurePosixPath(member.filename).parts
            canonical = PurePosixPath(member.filename).as_posix()
            if not parts or parts[0] != 'Xonotic' or '..' in parts or '\\' in member.filename or canonical in seen:
                raise ValueError('Unsafe or duplicate Xonotic ZIP path')
            seen.add(canonical)
            total += member.file_size
            if len(seen) > 100000 or total > 4 * 1024**3:
                raise ValueError('Xonotic ZIP exceeds extraction limits')
            relative = '/'.join(parts[1:])
            # The Linux server does not use the macOS application bundle. Its
            # framework directory links are outside this Linux-only profile.
            if relative == 'Xonotic.app' or relative.startswith('Xonotic.app/'):
                continue
            if stat.S_ISLNK(member.external_attr >> 16):
                if member.file_size > 4096:
                    raise ValueError('Oversized Xonotic ZIP link')
                value = source.read(member).decode('utf-8')
                target = posixpath.normpath(posixpath.join(posixpath.dirname(relative), value))
                if value.startswith('/') or '\\' in value or target == '..' or target.startswith('../'):
                    raise ValueError('Xonotic ZIP link escapes the release')
                links[relative] = target
            elif relative:
                regular.append(relative)
    extract(archive, ready, 'Xonotic', regular)
    for name, target in links.items():
        origin = ready / target
        if not origin.is_file() or origin.is_symlink():
            raise ValueError('Unsupported Xonotic ZIP link target')
        total += origin.stat().st_size
        if total > 4 * 1024**3:
            raise ValueError('Materialized Xonotic ZIP links exceed extraction limits')
        destination = ready / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origin, destination)


def install(root, env=None):
    if os.uname().machine not in ('x86_64', 'amd64'):
        raise ValueError('The Xonotic publisher dedicated engine requires Linux x64')
    root = root.resolve()
    state, target = root / '.voltra/xonotic', root / 'xonotic'
    if not state.resolve().is_relative_to(root) or target.is_symlink():
        raise ValueError('Xonotic installation paths escape the server volume')
    state.mkdir(parents=True, exist_ok=True)
    release = resolve_release(os.environ if env is None else env)
    receipt = state / 'release.json'
    old = json.loads(receipt.read_text()) if receipt.is_file() else {}
    binary = target / 'xonotic-linux64-dedicated'
    if old.get('sha512') == release['sha512'] and binary.is_file() and sha256(binary) == old.get('binary_sha256') and os.access(binary, os.X_OK) and all((target / name).is_file() for name in old.get('files', {})):
        print('Xonotic package already installed; operator files retained.', flush=True)
        return
    with tempfile.TemporaryDirectory(prefix='.stage-', dir=state) as temporary:
        stage = Path(temporary)
        archive, ready = stage / 'release.zip', stage / 'ready'
        if fetch(release['url'], archive) != release['sha512']:
            raise ValueError('Xonotic publisher SHA-512 mismatch')
        ready.mkdir()
        unpack(archive, ready)
        executable = ready / 'xonotic-linux64-dedicated'
        if not executable.is_file() or not any((ready / 'data').glob('*.pk3')) or not (ready / 'COPYING').is_file():
            raise ValueError('Xonotic package lacks engine, game data or license')
        executable.chmod(0o755)
        files = {p.relative_to(ready).as_posix(): sha256(p) for p in ready.rglob('*') if p.is_file()}
        if target.exists():
            for source in target.rglob('*'):
                if source.is_symlink():
                    raise ValueError('Operator symlinks require manual review before Xonotic update')
                if not source.is_file():
                    continue
                name = source.relative_to(target).as_posix()
                if name != 'xonotic-linux64-dedicated' and (name not in old.get('files', {}) or sha256(source) != old['files'][name]):
                    destination = ready / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, destination)
        staged_receipt = stage / 'receipt.json'
        staged_receipt.write_text(json.dumps({**release, 'files': files, 'binary_sha256': sha256(executable)}, indent=2) + '\n')
        backup, published = state / ('previous-' + str(time.time_ns())), False
        had_target = target.exists()
        try:
            if had_target:
                os.replace(target, backup)
            os.replace(ready, target)
            published = True
            os.replace(staged_receipt, receipt)
        except BaseException:
            if published:
                os.replace(target, ready)
            if had_target and backup.exists():
                os.replace(backup, target)
            raise
    print('Xonotic package installed; writable .xonotic data and operator changes retained.', flush=True)


if __name__ == '__main__':
    install(Path.cwd())
