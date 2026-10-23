# SPDX-License-Identifier: MIT
"""Install a publisher-verified Veloren archive without changing userdata."""
import hashlib
import json
import os
import platform
import shutil
import stat
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def download(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Voltra-Veloren-Setup/1'}), timeout=60)


def unpack(archive, destination):
    destination = Path(destination)
    assets = []
    with zipfile.ZipFile(archive) as zipped:
        for member in zipped.infolist():
            path = PurePosixPath(member.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in member.filename or ':' in member.filename or '\x00' in member.filename:
                raise ValueError('Unsafe game archive path')
            if not path.parts or (path.parts[0] != 'assets' and str(path) not in ('veloren-server-cli', 'LICENSE')):
                continue
            mode = member.external_attr >> 16
            if mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError('Game archive contains a link or special file')
            target = destination.joinpath(*path.parts)
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with zipped.open(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                if path.parts[0] == 'assets':
                    assets.append(str(path))
    if not (destination / 'veloren-server-cli').is_file() or not assets or not (destination / 'LICENSE').is_file():
        raise ValueError('Game archive is incomplete')
    (destination / 'veloren-server-cli').chmod(0o755)
    return assets


def install(root, builds, channel, architecture=None, opener=download):
    root = Path(root)
    arch = {'amd64': 'x86_64', 'x86_64': 'x86_64', 'arm64': 'aarch64', 'aarch64': 'aarch64'}.get(architecture or platform.machine())
    if channel not in builds or arch not in builds[channel]:
        raise ValueError('Unsupported Veloren channel or architecture')
    build = builds[channel][arch]
    meta = root / '.voltra/veloren-release.json'
    previous = json.loads(meta.read_text()) if meta.exists() else {}
    same = previous.get('sha256') == build['sha256'] and previous.get('architecture') == arch
    binary = root / 'veloren-server-cli'
    assets_complete = same and isinstance(previous.get('asset_files'), list) and previous['asset_files'] and all((root / path).is_file() for path in previous['asset_files'])
    if assets_complete and binary.is_file() and checksum(binary) == previous.get('binary_sha256'):
        print('Reviewed Veloren build retained, including operator asset changes.', flush=True)
        return False
    root.mkdir(parents=True, exist_ok=True)
    (root / '.voltra').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.veloren-install-', dir=root) as temporary:
        stage = Path(temporary)
        archive = stage / 'release.zip'
        for attempt in range(3):
            try:
                with opener(build['url']) as source, archive.open('wb') as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)
                break
            except OSError:
                if attempt == 2:
                    raise ValueError('Game download failed; installed files were retained') from None
                time.sleep(attempt + 1)
        if archive.stat().st_size != build['bytes'] or checksum(archive) != build['sha256']:
            raise ValueError('Publisher game archive checksum or size does not match')
        fresh = stage / 'game'
        files = unpack(archive, fresh)
        if same and (root / 'assets').is_dir():
            # Repair missing stock assets, preserving existing operator overrides.
            for name in files:
                target = root / name
                if not target.exists():
                    if not target.resolve().is_relative_to(root.resolve()):
                        raise ValueError('Asset repair path escapes the server directory')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(fresh / name, target)
            os.replace(fresh / 'veloren-server-cli', binary)
        else:
            backup = root / '.voltra/veloren-backups' / str(time.time_ns())
            backup.mkdir(parents=True)
            replaced, deployed = [], []
            try:
                for name in ('assets', 'veloren-server-cli', 'LICENSE'):
                    target = root / name
                    if target.exists():
                        os.replace(target, backup / name)
                        replaced.append(name)
                    os.replace(fresh / name, target)
                    deployed.append(name)
            except OSError:
                for name in reversed(deployed):
                    target = root / name
                    if target.is_dir():
                        shutil.rmtree(target)
                    elif target.exists():
                        target.unlink()
                for name in reversed(replaced):
                    os.replace(backup / name, root / name)
                raise
        receipt = dict(build, channel=channel, architecture=arch, asset_files=files, binary_sha256=checksum(binary))
        staged = stage / 'receipt.json'
        staged.write_text(json.dumps(receipt, indent=2) + '\n')
        os.replace(staged, meta)
    print('Verified Veloren build installed. Existing userdata was retained.', flush=True)
    return True


if __name__ == '__main__':
    try:
        root = Path('/mnt/server')
        builds = json.loads((root / '.voltra/veloren-builds.json').read_text())
        install(root, builds, os.environ.get('VERSION', ''))
    except (ValueError, OSError, zipfile.BadZipFile, KeyError, TypeError):
        print('Veloren installation failed. Check the selected build, archive integrity and available storage. Existing userdata was retained.', flush=True)
        raise SystemExit(1)
