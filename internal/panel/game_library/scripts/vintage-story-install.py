#!/usr/bin/env python3
"""MIT. Stage Vintage Story releases without modifying the server data folder."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
import time
import urllib.request


def request(url):
    if not url.startswith('https://'):
        raise ValueError('HTTPS release URL required')
    return urllib.request.urlopen(url, timeout=120)


def select_release(branch, version):
    if branch not in ('stable', 'unstable', 'pre'):
        raise ValueError('Unknown release branch')
    if not re.fullmatch(r'(?:latest|\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)', version):
        raise ValueError('Invalid release version')
    if version == 'latest' and branch == 'pre':
        raise ValueError('Pre releases require an explicit version')
    # The publisher feed supplies the release's checksum as well as its URL.
    with request('https://api.vintagestory.at/' + branch + '.json') as response:
        feed = json.load(response)
    if version == 'latest':
        candidates = [(v, d['linuxserver']) for v, d in feed.items()
                      if isinstance(d, dict) and isinstance(d.get('linuxserver'), dict)
                      and d['linuxserver'].get('latest') == 1]
        if len(candidates) != 1:
            raise ValueError('Publisher feed has no unique latest server release')
        version, entry = candidates[0]
    else:
        entry = feed.get(version, {}).get('linuxserver')
    if branch == 'pre' and not entry:
        # The publisher currently returns an empty pre feed. Preserve explicit
        # pre-version downloads, while reporting the lack of a publisher digest.
        return {'branch': branch, 'version': version, 'md5': None,
                'url': 'https://cdn.vintagestory.at/gamefiles/pre/vs_server_linux-x64_' + version + '.tar.gz'}
    if not isinstance(entry, dict) or not re.fullmatch('[a-fA-F0-9]{32}', entry.get('md5', '')):
        raise ValueError('Version is not listed with a publisher checksum')
    name = 'vs_server_linux-x64_' + version + '.tar.gz'
    url = entry.get('urls', {}).get('cdn', '')
    if url != 'https://cdn.vintagestory.at/gamefiles/' + branch + '/' + name:
        raise ValueError('Unexpected publisher archive location')
    return {'branch': branch, 'version': version, 'url': url, 'md5': entry['md5'].lower()}


def extract(archive, destination):
    seen = set()
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or '\\' in member.name:
                raise ValueError('Unsafe archive path')
            if path == PurePosixPath('.'):
                continue
            if not (member.isdir() or member.isfile()) or str(path) in seen:
                raise ValueError('Archive links, special files and duplicate paths are unsupported')
            seen.add(str(path))
            target = destination.joinpath(*path.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as inp, target.open('xb') as out:
                    shutil.copyfileobj(inp, out)
                target.chmod(member.mode & 0o777)
    for name in ('VintagestoryServer.dll', 'VintagestoryServer.runtimeconfig.json', 'assets'):
        if not (destination / name).exists():
            raise ValueError('Archive is missing ' + name)


def install(root, release):
    state = root / '.voltra' / 'vintage-story'
    state.mkdir(parents=True, exist_ok=True)
    current = state / 'current'
    receipt = state / 'release.json'
    if receipt.is_file() and current.is_dir():
        old = json.loads(receipt.read_text())
        if all(old.get(k) == release[k] for k in ('branch', 'version', 'md5')):
            if (current / 'VintagestoryServer.dll').is_file():
                print('Existing Vintage Story release and operator overrides retained.', flush=True)
                return
    with tempfile.TemporaryDirectory(prefix='.stage-', dir=state) as temp:
        stage = Path(temp)
        archive = stage / 'server.tar.gz'
        md5, sha256 = hashlib.md5(), hashlib.sha256()
        with request(release['url']) as inp, archive.open('xb') as out:
            for block in iter(lambda: inp.read(1024 * 1024), b''):
                md5.update(block)
                sha256.update(block)
                out.write(block)
        if release['md5'] and md5.hexdigest() != release['md5']:
            raise ValueError('Publisher archive checksum mismatch; current release unchanged')
        if release['branch'] == 'stable' and release['version'] == '1.22.7' and sha256.hexdigest() != 'a7d4a520604590a96de812ee6c6baf4404d43d86cf1ec4fbac1b3a580b52c847':
            raise ValueError('Reviewed release SHA256 mismatch')
        if not release['md5']:
            print('Publisher has no checksum for this pre release; archive downloaded over HTTPS.', flush=True)
        ready = stage / 'ready'
        ready.mkdir()
        extract(archive, ready)
        # Keep a complete previous release, including operator overrides.
        backup = state / ('previous-' + str(time.time_ns()))
        previous_receipt = receipt.read_bytes() if receipt.exists() else None
        moved, published = False, False
        try:
            if current.exists():
                current.rename(backup)
                moved = True
            ready.rename(current)
            published = True
            staged_receipt = stage / 'release.json'
            staged_receipt.write_text(json.dumps({**release, 'sha256': sha256.hexdigest()}, indent=2) + '\n')
            os.replace(staged_receipt, receipt)
        except BaseException:
            if published:
                current.rename(stage / 'failed-publication')
            if moved:
                backup.rename(current)
            if previous_receipt is not None:
                receipt.write_bytes(previous_receipt)
            raise
    print('Vintage Story ' + release['version'] + ' installed; data was not modified.', flush=True)


if __name__ == '__main__':
    if os.uname().machine not in ('x86_64', 'amd64'):
        raise SystemExit('This publisher archive requires Linux x64')
    install(Path.cwd(), select_release(os.environ.get('FILES_BRANCH', 'stable'),
                                      os.environ.get('RELEASE_VERSION', '1.22.7')))
