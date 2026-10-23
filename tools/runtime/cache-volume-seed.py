#!/usr/bin/env python3
"""Copy verified public blobs to one stopped server's private cache directory."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re

helper = Path(__file__).with_name('download-cache.py')
if not helper.exists():
    helper = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/download-cache.py'
spec = importlib.util.spec_from_file_location('download_cache', helper)
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


def seed(root, blobs, digests):
    root, blobs = Path(root), Path(blobs)
    if root.is_symlink() or not root.is_dir() or root.resolve() != root.absolute():
        raise ValueError('Unsafe server volume')
    metadata = root.stat()
    parent = root / '.voltra'
    target = parent / 'public-cache'
    for directory in (parent, target):
        if directory.is_symlink():
            raise ValueError('Private artifact cache must not traverse symlinks')
    if not digests or len(digests) > 32 or any(not re.fullmatch('[a-f0-9]{64}', digest) for digest in digests):
        raise ValueError('Supply 1 to 32 SHA-256 digests')
    # Preflight every blob before writing any consumer files.
    for digest in digests:
        blob = blobs / digest
        if blob.is_symlink() or not blob.is_file() or cache.digest_file(blob) != digest:
            raise ValueError('Public source blob failed integrity validation')
        destination = target / digest
        if destination.is_symlink() or destination.exists() and (not destination.is_file() or cache.digest_file(destination) != digest):
            raise ValueError('Existing private artifact differs from expected content')
    for directory in (parent, target):
        directory.mkdir(mode=0o755, exist_ok=True)
        os.chown(directory, metadata.st_uid, metadata.st_gid)
    results = []
    for digest in dict.fromkeys(digests):
        destination = target / digest
        method = 'existing_verified'
        if not destination.exists():
            method = cache.materialize(blobs / digest, destination)
            destination.chmod(0o644)
            os.chown(destination, metadata.st_uid, metadata.st_gid)
        results.append({'sha256': digest, 'bytes': destination.stat().st_size, 'materialization': method})
    return {'public_blobs': results, 'destination': '.voltra/public-cache',
            'scope': 'Independent verified public artifact copies; no user data or shared writable mounts'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--blobs', required=True)
    parser.add_argument('--sha256', action='append', required=True)
    args = parser.parse_args()
    print(json.dumps(seed(args.root, args.blobs, args.sha256)))
