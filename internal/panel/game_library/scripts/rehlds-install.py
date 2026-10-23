#!/usr/bin/env python3
"""MIT. Apply the explicitly reviewed ReHLDS engine after publisher validation."""
import json
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import time
import urllib.request
import zipfile
from native_release import download, sha256


def release_for(version, pinned):
    if version in ('', 'latest', pinned['version']):
        # latest is intentionally the reviewed release, not a moving executable.
        return dict(pinned)
    if not re.fullmatch(r'v?[0-9]+(?:\.[0-9]+){2,3}', version):
        raise ValueError('Choose a native ReHLDS release tag or latest')
    url = 'https://api.github.com/repos/rehlds/ReHLDS/releases/tags/' + version
    with urllib.request.urlopen(url, timeout=45) as response:
        raw = response.read(2 * 1024**2 + 1)
    if len(raw) > 2 * 1024**2:
        raise ValueError('ReHLDS release metadata exceeds limit')
    record = json.loads(raw)
    candidates = [asset for asset in record.get('assets', []) if re.fullmatch(r'rehlds-bin-[A-Za-z0-9_.-]+\.zip', asset.get('name', ''))]
    if record.get('tag_name') != version or len(candidates) != 1:
        raise ValueError('No unambiguous native ReHLDS release asset')
    asset = candidates[0]
    digest = asset.get('digest') or ''
    if digest and not re.fullmatch('sha256:[a-f0-9]{64}', digest):
        raise ValueError('Invalid ReHLDS publisher asset checksum')
    prefix = 'https://github.com/rehlds/ReHLDS/releases/download/' + version + '/'
    if not asset.get('browser_download_url', '').startswith(prefix) or not 1 <= asset.get('size', 0) <= 64 * 1024**2:
        raise ValueError('Unsafe ReHLDS release asset')
    return {'version': version, 'url': asset['browser_download_url'], 'bytes': asset['size'],
            'sha256': digest.removeprefix('sha256:'), 'source': url,
            'checksum_source': 'GitHub release asset SHA-256' if digest else 'HTTPS acquisition identity only; historical asset has no published checksum',
            'license': 'See selected release license'}


def acquire(release, archive):
    if release.get('sha256'):
        download(release, archive)
        return
    # Older publisher assets predate GitHub's digest field. Keep explicit tag
    # support, bounded by its API size and HTTPS, and record the weaker evidence.
    checksum, count = hashlib.sha256(), 0
    with urllib.request.urlopen(release['url'], timeout=120) as source, archive.open('xb') as output:
        if not source.geturl().startswith('https://'):
            raise ValueError('Historical ReHLDS download redirected outside HTTPS')
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            count += len(chunk)
            if count > min(release['bytes'], 64 * 1024**2):
                raise ValueError('Historical ReHLDS archive exceeds limit')
            checksum.update(chunk)
            output.write(chunk)
    if count != release['bytes']: raise ValueError('Historical ReHLDS archive size mismatch')
    release['sha256'] = checksum.hexdigest()
    print('Historical ReHLDS release has no published SHA-256; receipt records HTTPS acquisition identity only.', flush=True)


def extract_engine(archive, ready):
    seen, selected, total = set(), [], 0
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            relative = PurePosixPath(member.filename)
            if relative.is_absolute() or '..' in relative.parts or '\\' in member.filename or member.filename in seen:
                raise ValueError('Unsafe ReHLDS archive path')
            seen.add(member.filename)
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode): raise ValueError('ReHLDS archive links are unsupported')
            total += member.file_size
            if len(seen) > 10000 or total > 256 * 1024**2:
                raise ValueError('ReHLDS archive expansion exceeds limit')
            if tuple(relative.parts[:2]) != ('bin', 'linux32') or len(relative.parts) < 3:
                continue
            name = PurePosixPath(*relative.parts[2:])
            destination = ready.joinpath(*name.parts)
            if member.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with source.open(member) as incoming, destination.open('xb') as output:
                shutil.copyfileobj(incoming, output)
            destination.chmod(0o755 if name.name in ('hlds_linux', 'hltv', 'hlds_run') else 0o644)
            selected.append(name.as_posix())
    if 'engine_i486.so' not in selected:
        raise ValueError('ReHLDS archive lacks the Linux engine')
    return selected


def overlay(root, env):
    root = root.resolve()
    owner = root.stat()
    if env.get('SRCDS_BETAID', '') != 'steam_legacy':
        raise ValueError('ReHLDS requires the publisher steam_legacy branch')
    pinned = json.loads((root / '.voltra/rehlds-release.json').read_text())
    release = release_for(env.get('VERSION', 'latest'), pinned)
    state = root / '.voltra/rehlds'
    if not state.resolve().is_relative_to(root): raise ValueError('ReHLDS state escapes the server volume')
    state.mkdir(parents=True, exist_ok=True)
    license_source = root / '.voltra/rehlds-license.txt'
    if release['version'] == pinned['version'] and not license_source.is_file():
        raise ValueError('Reviewed ReHLDS license notice is missing')
    with tempfile.TemporaryDirectory(prefix='.engine-', dir=state) as temporary:
        stage = Path(temporary)
        archive, ready = stage / 'archive.zip', stage / 'ready'
        ready.mkdir()
        acquire(release, archive)
        names = extract_engine(archive, ready)
        for name in names:
            if not (root / name).resolve().is_relative_to(root): raise ValueError('ReHLDS target escapes volume')
        backup = state / ('previous-' + str(time.time_ns()))
        changes = []
        try:
            for name in names:
                source, destination = ready / name, root / name
                if destination.is_file() and sha256(source) == sha256(destination): continue
                saved = None
                if destination.exists():
                    saved = backup / name
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(destination, saved)
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.chown(source, owner.st_uid, owner.st_gid)
                os.replace(source, destination)
                changes.append((destination, saved))
            record = {**release, 'files': {name: sha256(root / name) for name in names}}
            if release['version'] == pinned['version']:
                shutil.copyfile(license_source, stage / 'LICENSE')
                os.chown(stage / 'LICENSE', owner.st_uid, owner.st_gid)
                os.replace(stage / 'LICENSE', state / 'LICENSE')
            (stage / 'release.json').write_text(json.dumps(record, indent=2) + '\n')
            os.chown(stage / 'release.json', owner.st_uid, owner.st_gid)
            os.replace(stage / 'release.json', state / 'release.json')
        except BaseException:
            for destination, saved in reversed(changes):
                if saved is None: destination.unlink()
                else: os.replace(saved, destination)
            raise
    print('Reviewed ReHLDS ' + release['version'] + ' engine applied after Steam validation.', flush=True)
