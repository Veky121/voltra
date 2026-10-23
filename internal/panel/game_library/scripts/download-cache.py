#!/usr/bin/env python3
"""MIT-licensed Linux cache for public, SHA-256-pinned installer artifacts.

Keep this cache host-owned and outside game volumes. Never cache credentials,
mutable game installs, configuration, saves, or authenticated downloads here.
Every consumer gets an independent file, including on reflink-capable storage.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import urllib.parse
import urllib.request


def digest_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def directory(path):
    path = Path(path).absolute()
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('Cache path must not traverse symlinks')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not path.is_dir() or path.stat().st_uid != os.getuid():
        raise ValueError('Cache must be owned by the current user')
    if stat.S_IMODE(path.stat().st_mode) & 0o022:
        raise ValueError('Cache must not be writable by other users')
    return path


def public_url(url, *, redirect=False):
    parsed = urllib.parse.urlsplit(url)
    signed_public_redirect = (redirect and parsed.hostname in
                              ('release-assets.githubusercontent.com', 'objects.githubusercontent.com')
                              and len(parsed.query) <= 8192)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username
            or parsed.password or parsed.query and not signed_public_redirect or parsed.fragment):
        raise ValueError('Only public HTTPS URLs without credentials or query strings are cacheable')
    return url


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        public_url(newurl, redirect=True)
        return super().redirect_request(request, fp, code, message, headers, newurl)


@contextlib.contextmanager
def lock(path):
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'a+b') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def cache_usage(root):
    """Logical bytes across all cache namespaces, including inflight work.

    Never follow a symlink out of the owned root; its directory-entry bytes
    still count. Callers hold root/.capacity.lock while inspecting/mutating.
    """
    total = 0
    for folder, directories, files in os.walk(root, followlinks=False):
        for name in files:
            total += (Path(folder) / name).lstat().st_size
        for name in directories:
            entry = Path(folder) / name
            if entry.is_symlink():
                total += entry.lstat().st_size
    return total


def cached(cache, expected, *, url=None, source=None, max_bytes=8 * 1024**3,
           capacity_bytes=20 * 1024**3):
    """Verify and publish one blob. Callers must supply its trusted digest."""
    if not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise ValueError('A lowercase SHA-256 digest is required')
    if max_bytes < 1 or capacity_bytes < 1:
        raise ValueError('A positive download limit is required')
    if (url is None) == (source is None):
        raise ValueError('Supply exactly one URL or local source')
    if url is not None:
        public_url(url)
    root = directory(cache)
    blobs, locks = directory(root / 'sha256'), directory(root / 'locks')
    target = blobs / expected
    # The game-content cache uses the same blocking capacity lock during its
    # acquisition/publication/GC. It never removes this public CAS namespace.
    with lock(locks / (expected + '.lock')), lock(root / '.capacity.lock'):
        if target.is_symlink():
            raise ValueError('Cached blob must not be a symlink')
        if target.exists():
            if not target.is_file() or target.stat().st_size > max_bytes or digest_file(target) != expected:
                raise ValueError('Cached blob failed integrity validation')
            return target, True
        temporary = None
        used = cache_usage(root)
        try:
            with tempfile.NamedTemporaryFile(prefix='.incoming-', dir=blobs, delete=False) as output:
                temporary = Path(output.name)
                if source is not None:
                    incoming = Path(source).open('rb')
                else:
                    incoming = urllib.request.build_opener(PublicRedirect()).open(url, timeout=120)
                    public_url(incoming.geturl(), redirect=True)
                count, digest = 0, hashlib.sha256()
                with incoming:
                    while True:
                        chunk = incoming.read(1024 * 1024)
                        if not chunk:
                            break
                        count += len(chunk)
                        if count > max_bytes:
                            raise ValueError('Artifact exceeds download size limit')
                        if used + count > capacity_bytes:
                            raise ValueError('Shared cache capacity exceeded; no public artifacts were evicted')
                        digest.update(chunk)
                        output.write(chunk)
                if digest.hexdigest() != expected:
                    raise ValueError('Artifact SHA-256 does not match')
                output.flush()
                os.fsync(output.fileno())
                os.fchmod(output.fileno(), 0o444)
            os.replace(temporary, target)
            return target, False
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


def materialize(blob, destination):
    """Atomically replace a destination with a private writable copy. No hardlinks."""
    destination = Path(destination)
    if destination.is_symlink():
        raise ValueError('Destination must not be a symlink')
    if not destination.parent.is_dir():
        raise ValueError('Destination parent must already exist')
    temporary = None
    copied = 'copy'
    try:
        with tempfile.NamedTemporaryFile(prefix='.cache-copy-', dir=destination.parent, delete=False) as output:
            temporary = Path(output.name)
            with Path(blob).open('rb') as source:
                try:
                    fcntl.ioctl(output.fileno(), 0x40049409, source.fileno())  # Linux FICLONE
                    copied = 'reflink'
                except OSError:
                    output.seek(0)
                    output.truncate()
                    source.seek(0)
                    shutil.copyfileobj(source, output, 1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, destination)
        return copied
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', required=True)
    parser.add_argument('--sha256', required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--url')
    group.add_argument('--source', help='Seed a downloaded public artifact after digest validation')
    parser.add_argument('--destination')
    parser.add_argument('--max-bytes', type=int, default=8 * 1024**3)
    args = parser.parse_args()
    blob, hit = cached(args.cache, args.sha256, url=args.url, source=args.source, max_bytes=args.max_bytes)
    method = materialize(blob, args.destination) if args.destination else None
    print(json.dumps({'sha256': args.sha256, 'bytes': blob.stat().st_size, 'cache_hit': hit,
                      'materialization': method}))


if __name__ == '__main__':
    main()
