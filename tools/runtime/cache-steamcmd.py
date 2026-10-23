#!/usr/bin/env python3
"""Stage a reviewed public SteamCMD skeleton into a stopped private volume.

No existing Steam directory is replaced. Launcher self-updates and the ordinary
game installer remain unchanged. Run on the batch node host through the wrapper.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile


def provision(root, blob, expected, source, acquired_at, public_manifest=None):
    root, blob = Path(root), Path(blob)
    if not re.fullmatch('[a-f0-9]{64}', expected):
        raise ValueError('Invalid bootstrap digest')
    if root.is_symlink() or not root.is_dir() or root.resolve() != root.absolute():
        raise ValueError('Server volume must exist without symlink traversal')
    if blob.is_symlink() or not blob.is_file() or blob.stat().st_size > 128 * 1024**2:
        raise ValueError('Bootstrap blob is not an ordinary bounded file')
    checksum = hashlib.sha256(blob.read_bytes()).hexdigest()
    if checksum != expected:
        raise ValueError('Bootstrap blob digest differs from acquisition receipt')
    if public_manifest is not None:
        import importlib.util
        spec = importlib.util.spec_from_file_location('public_steamcmd', Path(__file__).with_name('cache-steamcmd-public.py'))
        public = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(public)
        public.validate_archive(blob, public_manifest)
    target = root / '.voltra/steamcmd'
    if target.exists() or target.is_symlink():
        raise ValueError('Existing SteamCMD directory must not be replaced')
    parent = target.parent
    if parent.is_symlink():
        raise ValueError('SteamCMD parent must not be a symlink')
    parent.mkdir(mode=0o755, exist_ok=True)
    metadata = root.stat()
    receipt_path = parent / 'steamcmd-bootstrap.json'
    if receipt_path.exists() or receipt_path.is_symlink():
        raise ValueError('Existing bootstrap provenance must not be replaced')
    with tempfile.TemporaryDirectory(prefix='.steam-cache-', dir=parent) as temporary:
        ready = Path(temporary) / 'ready'
        ready.mkdir(mode=0o755)
        seen, total = set(), 0
        with tarfile.open(blob, 'r:gz') as archive:
            for member in archive:
                path = PurePosixPath(member.name)
                if path.is_absolute() or '..' in path.parts or '\\' in member.name or not (member.isfile() or member.isdir()):
                    raise ValueError('Unsafe bootstrap archive member')
                if path.as_posix() == '.':
                    continue
                if path.as_posix() in seen:
                    raise ValueError('Duplicate bootstrap archive path')
                seen.add(path.as_posix())
                total += member.size
                if len(seen) > 10000 or total > 512 * 1024**2:
                    raise ValueError('Bootstrap expansion exceeds limit')
                destination = ready.joinpath(*path.parts)
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(member) as incoming, destination.open('xb') as output:
                        shutil.copyfileobj(incoming, output, 1024 * 1024)
                    destination.chmod(member.mode & 0o777)
                    if public_manifest is not None:
                        os.utime(destination, (member.mtime, member.mtime))
        for name in ('steamcmd.sh', 'linux32/steamcmd'):
            entry = ready / name
            if not entry.is_file():
                raise ValueError('Bootstrap lacks a required launcher')
            entry.chmod(0o755)
        # Fresh extraction guarantees no Steam credentials, app state, or saves
        # were copied from a previous server. All paths belong to this volume.
        for entry in (ready, *ready.rglob('*')):
            os.chown(entry, metadata.st_uid, metadata.st_gid)
            if entry.is_dir():
                entry.chmod(0o755)
        os.chown(parent, metadata.st_uid, metadata.st_gid)
        os.replace(ready, target)
    provenance = {'url': source, 'sha256': expected, 'bytes': blob.stat().st_size,
                  'acquired_at': acquired_at, 'shared_bootstrap_cache': True,
                  'steamcmd_self_updates_enabled': True,
                  'game_download_cache_used': False}
    if public_manifest is not None:
        provenance['kind'] = public_manifest['kind']
        provenance['steamcmd_version'] = public_manifest['steamcmd_version']
        provenance['public_files'] = len(public_manifest['files'])
    with receipt_path.open('x') as output:
        json.dump(provenance, output, indent=2)
        output.write('\n')
    receipt_path.chmod(0o644)
    os.chown(receipt_path, metadata.st_uid, metadata.st_gid)
    return provenance


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--blob', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--acquired-at', required=True)
    parser.add_argument('--public-manifest')
    options = parser.parse_args()
    manifest = json.loads(Path(options.public_manifest).read_text()) if options.public_manifest else None
    print(json.dumps(provision(options.root, options.blob, options.sha256, options.source, options.acquired_at, manifest)))
