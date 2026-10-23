#!/usr/bin/env python3
"""MIT. ZIP companion to the shared native tar-release checksum/cache contract."""
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import time
import zipfile
from native_release import download, sha256


def extract(archive, target, prefix, paths=None):
    seen, total = set(), 0
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            parts = PurePosixPath(member.filename).parts
            mode = member.external_attr >> 16
            if not parts or member.filename.startswith('/') or '..' in parts or '\\' in member.filename:
                raise ValueError('Unsafe ZIP release path')
            if prefix is not None:
                if parts[0] != prefix:
                    raise ValueError('Unexpected ZIP release prefix')
                if len(parts) == 1:
                    if not member.is_dir():
                        raise ValueError('ZIP release root must be a directory')
                    continue
                parts = parts[1:]
            relative = PurePosixPath(*parts)
            name = relative.as_posix()
            kind = stat.S_IFMT(mode)
            if kind not in (0, stat.S_IFDIR, stat.S_IFREG) or str(relative) in seen:
                raise ValueError('ZIP links, special files or duplicate paths are unsupported')
            seen.add(str(relative))
            total += member.file_size
            if len(seen) > 100000 or total > 4 * 1024**3:
                raise ValueError('ZIP release exceeds extraction limits')
            if paths is not None and not any(name == selected or selected.endswith('/') and name.startswith(selected) for selected in paths):
                continue
            path = target.joinpath(*relative.parts)
            if member.is_dir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                with source.open(member) as inp, path.open('xb') as out:
                    shutil.copyfileobj(inp, out)
                path.chmod((mode & 0o777) or 0o644)


def install_release(root, release, target_name, executable):
    root = root.resolve()
    state, target = root / '.voltra' / target_name, root / target_name
    if not state.resolve().is_relative_to(root) or not target.resolve().is_relative_to(root):
        raise ValueError('Native ZIP state or destination escapes the server volume')
    state.mkdir(parents=True, exist_ok=True)
    receipt = state / 'release.json'
    old = json.loads(receipt.read_text()) if receipt.is_file() else {}
    binary = target / executable
    if old.get('sha256') == release['sha256'] and binary.is_file() and sha256(binary) == old.get('binary_sha256') and os.access(binary, os.X_OK) and all((target / name).is_file() for name in old.get('files', {})):
        print('Native ZIP release ' + release['version'] + ' and operator files retained.', flush=True)
        return
    with tempfile.TemporaryDirectory(prefix='.stage-', dir=state) as temporary:
        stage = Path(temporary)
        download(release, stage / 'archive.zip')
        ready = stage / 'ready'
        ready.mkdir()
        extract(stage / 'archive.zip', ready, release['prefix'], release.get('paths'))
        if not (ready / executable).is_file():
            raise ValueError('ZIP release is missing the native server executable')
        (ready / executable).chmod(0o755)
        files = {p.relative_to(ready).as_posix(): sha256(p) for p in ready.rglob('*') if p.is_file()}
        backup = state / ('previous-' + str(time.time_ns()))
        replacements = []
        try:
            for name in files:
                source, destination = ready / name, target / name
                if not destination.resolve().is_relative_to(root):
                    raise ValueError('ZIP destination escapes the server volume')
                if destination.exists():
                    if name != executable and (name.endswith('.cfg') or name not in old.get('files', {}) or sha256(destination) != old['files'][name]):
                        continue
                    saved = backup / name
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(destination, saved)
                else:
                    saved = None
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.replace(source, destination)
                replacements.append((destination, saved))
            staged = stage / 'receipt.json'
            staged.write_text(json.dumps({**release, 'binary_sha256': sha256(binary), 'files': files}, indent=2) + '\n')
            os.replace(staged, receipt)
        except BaseException:
            for destination, saved in reversed(replacements):
                if saved is None:
                    destination.unlink()
                else:
                    os.replace(saved, destination)
            raise
    print('Native ZIP release ' + release['version'] + ' installed; operator files preserved.', flush=True)
