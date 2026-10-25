#!/usr/bin/env python3
"""MIT. Shared checksum/staging/preservation for native tar-based game releases."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tarfile
import tempfile
import time
import urllib.request


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            digest.update(block)
    return digest.hexdigest()


def preserve_identity(prepared, original):
    identity = original.stat()
    os.chown(prepared, identity.st_uid, identity.st_gid)
    prepared.chmod(stat.S_IMODE(identity.st_mode))


def download(release, target, cache_root=None):
    if not release['url'].startswith('https://'):
        raise ValueError('Native release download requires HTTPS')
    # An installer may receive immutable public blobs copied into its own
    # volume before installation. Never link writable game data to a cache.
    if cache_root is None:
        managed = next((p for p in target.parents if p.name == '.voltra'), None)
        cache_root = managed / 'public-cache' if managed is not None else None
    if cache_root is not None:
        cache_root = Path(cache_root)
        digest = release.get('sha256', '')
        if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('Public native cache requires a SHA-256 identity')
        cached = cache_root / digest
        if cache_root.is_symlink() or cached.is_symlink():
            raise ValueError('Native public cache must not use symlinks')
        if cached.exists():
            if not cached.is_file() or (release.get('bytes') and cached.stat().st_size != release['bytes']) or sha256(cached) != digest:
                raise ValueError('Native public cache failed integrity validation')
            with cached.open('rb') as source, target.open('xb') as out:
                shutil.copyfileobj(source, out)
            if sha256(target) != digest:
                target.unlink()
                raise ValueError('Native cached copy failed integrity validation')
            print('Verified public native archive reused from cache.', flush=True)
            return
    with urllib.request.urlopen(release['url'], timeout=120) as source, target.open('xb') as out:
        shutil.copyfileobj(source, out)
    if release.get('bytes') and target.stat().st_size != release['bytes']:
        raise ValueError('Native archive size mismatch')
    if sha256(target) != release['sha256']:
        raise ValueError('Native archive checksum mismatch')


def extract(archive, target, prefix):
    seen, total = set(), 0
    with tarfile.open(archive, 'r:*') as source:
        for member in source:
            parts = PurePosixPath(member.name).parts
            if member.name.startswith('/') or '..' in parts or '\\' in member.name:
                raise ValueError('Unsafe native archive path')
            if prefix is not None:
                if not parts or parts[0] != prefix:
                    raise ValueError('Unexpected native archive prefix')
                if len(parts) == 1:
                    if not member.isdir():
                        raise ValueError('Native archive root must be a directory')
                    continue
                parts = parts[1:]
            elif not parts:
                if member.isdir() and member.name in ('.', './'):
                    continue
                raise ValueError('Empty native archive path')
            relative = PurePosixPath(*parts)
            if not (member.isfile() or member.isdir()) or str(relative) in seen:
                raise ValueError('Archive links, special files and duplicate paths are unsupported')
            seen.add(str(relative))
            total += member.size
            if len(seen) > 100000 or total > 4 * 1024**3:
                raise ValueError('Native archive exceeds extraction limits')
            path = target.joinpath(*relative.parts)
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as inp, path.open('xb') as out:
                    shutil.copyfileobj(inp, out)
                path.chmod(member.mode & 0o777)


def install_release(root, release, target_name, executable, defaults=None):
    root = root.resolve()
    state, target = root / '.voltra' / target_name, root / target_name
    if not state.resolve().is_relative_to(root) or not target.resolve().is_relative_to(root):
        raise ValueError('Native engine or state directory escapes the server volume')
    receipt = state / 'release.json'
    if receipt.is_symlink():
        raise ValueError('Native release receipt must not be a symbolic link')
    state.mkdir(parents=True, exist_ok=True)
    old = json.loads(receipt.read_text()) if receipt.is_file() else {}
    binary = target / executable
    if old.get('sha256') == release['sha256'] and binary.is_file() and sha256(binary) == old.get('binary_sha256') and all((target / name).is_file() for name in old.get('files', {})):
        print('Native release ' + release['version'] + ' and operator files retained.', flush=True)
        return
    with tempfile.TemporaryDirectory(prefix='.stage-', dir=state) as temporary:
        stage = Path(temporary)
        download(release, stage / 'archive')
        ready = stage / 'ready'
        ready.mkdir()
        extract(stage / 'archive', ready, release['prefix'])
        if not (ready / executable).is_file():
            raise ValueError('Native archive is missing the server executable')
        for name, text in (defaults or {}).items():
            if not (target / name).exists():
                (ready / name).write_text(text)
        files = {p.relative_to(ready).as_posix(): sha256(p) for p in ready.rglob('*') if p.is_file()}
        backup = state / ('previous-' + str(time.time_ns()))
        replacements = []
        try:
            for name, expected in files.items():
                source, destination = ready / name, target / name
                if not destination.resolve().is_relative_to(root):
                    raise ValueError('Native destination escapes the server volume')
                if destination.is_symlink():
                    raise ValueError('Existing native file must not be a symbolic link')
                if destination.exists():
                    if not destination.is_file():
                        raise ValueError('Existing native file must be a regular file')
                    # Configuration and maps always remain operator-owned. Other
                    # modified stock assets remain overrides across updates.
                    preserve = name.endswith('.cfg') or name.startswith(('data/maps/', 'data/maps7/', 'maps/'))
                    preserve |= name != executable and (name not in old.get('files', {}) or sha256(destination) != old['files'][name])
                    if preserve:
                        continue
                    saved = backup / name
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(destination, saved)
                    # Installer processes commonly run as root while Wings owns
                    # existing server files. copy2 retains mode but not owner.
                    # Prepare both rollback and new content before publication.
                    for prepared in (saved, source):
                        preserve_identity(prepared, destination)
                else:
                    saved = None
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.replace(source, destination)
                replacements.append((destination, saved))
            staged = stage / 'receipt.json'
            staged.write_text(json.dumps({**release, 'binary_sha256': sha256(binary), 'files': files}, indent=2) + '\n')
            if receipt.exists():
                preserve_identity(staged, receipt)
            os.replace(staged, receipt)
        except BaseException:
            for destination, saved in reversed(replacements):
                if saved is None:
                    destination.unlink()
                else:
                    os.replace(saved, destination)
            raise
    print('Native release ' + release['version'] + ' installed; operator files preserved.', flush=True)
