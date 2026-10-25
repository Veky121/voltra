#!/usr/bin/env python3
"""MIT. Cuberite-only verified publication; worlds/plugins/config remain operator data."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tarfile
import tempfile
import uuid
from minecraft_special_install import PINS, verified


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1048576), b''): digest.update(block)
    return digest.hexdigest()


def safe_name(name):
    parts = name.rstrip('/').split('/')
    if not name or name.startswith('/') or '\\' in name or ':' in name or any(ord(c) < 32 for c in name) or any(part in ('', '.', '..') for part in parts):
        raise ValueError('Unsafe Cuberite archive/publication path')
    return parts


def confined(root, name):
    path = root
    for part in safe_name(name):
        path /= part
        if path.is_symlink(): raise ValueError('Cuberite publication refuses symlink paths')
    return path


def fsync_directory(path):
    if os.name != 'posix': return
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def sync_file(path):
    if os.name == 'posix':
        with path.open('rb') as source: os.fsync(source.fileno())


def atomic_json(path, value):
    temporary = path.with_name(path.name + '.new')
    if temporary.is_symlink(): raise ValueError('Unsafe Cuberite journal temporary')
    with temporary.open('w') as out:
        json.dump(value, out); out.flush(); os.fsync(out.fileno())
    os.replace(temporary, path); fsync_directory(path.parent)


def identity_copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    if hasattr(os, 'chown'):
        info = source.stat(); os.chown(destination, info.st_uid, info.st_gid)
    sync_file(destination); fsync_directory(destination.parent)


def recover(root, state):
    journal = confined(root, '.voltra/cuberite/transaction.json')
    if not journal.exists(): return
    if journal.stat().st_size > 16 * 1024**2: raise ValueError('Cuberite journal exceeds budget')
    record = json.loads(journal.read_text())
    if not re.fullmatch(r'backup-[0-9a-f]{32}', record.get('backup', '')): raise ValueError('Invalid Cuberite backup identity')
    backup = confined(root, '.voltra/cuberite/' + record['backup'])
    for entry in record['files']:
        confined(root, entry['path'])
        if entry['old_sha256']:
            saved = confined(backup, entry['path'])
            if not saved.is_file() or sha(saved) != entry['old_sha256']: raise ValueError('Cuberite recovery backup failed integrity')
    for entry in reversed(record['files']):
        destination = confined(root, entry['path'])
        if entry['old_sha256']:
            temporary = destination.with_name(destination.name + '.cuberite-restore')
            if temporary.is_symlink(): raise ValueError('Unsafe Cuberite recovery temporary')
            identity_copy(backup / entry['path'], temporary); os.replace(temporary, destination)
        elif destination.exists(): destination.unlink()
        if destination.parent.exists(): fsync_directory(destination.parent)
    for name in reversed(record['directories']):
        directory = confined(root, name)
        if directory.is_dir() and not any(directory.iterdir()): directory.rmdir()
    journal.unlink(); fsync_directory(state); shutil.rmtree(backup)


def unpack(data, destination):
    if len(data) > 32 * 1024**2: raise ValueError('Cuberite archive exceeds budget')
    seen, entries, total = set(), [], 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as archive:
        for member in archive.getmembers():
            parts = safe_name(member.name); name = '/'.join(parts)
            if name.casefold() in seen or not (member.isfile() or member.isdir()): raise ValueError('Cuberite archive has duplicate/link/special entries')
            if parts[0].casefold() in ('.voltra', 'world', 'world_nether', 'world_the_end', 'ranks.sqlite'):
                raise ValueError('Cuberite publisher archive conflicts with protected world/identity paths')
            seen.add(name.casefold()); total += member.size
            if total > 256 * 1024**2 or len(seen) > 20000: raise ValueError('Cuberite unpacked budget exceeded')
            entries.append((member, name))
        for member, name in entries:
            target = destination / name
            if member.isdir(): target.mkdir(parents=True, exist_ok=True); continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, target.open('xb') as out: shutil.copyfileobj(source, out)
            target.chmod(0o755 if member.mode & 0o111 else 0o644)


def install(root, fetch_verified=verified, hook=lambda phase: None):
    root = Path(root).resolve()
    state = confined(root, '.voltra/cuberite'); state.mkdir(parents=True, exist_ok=True)
    with confined(root, '.voltra/cuberite/install.lock').open('a+b') as lock:
        if os.name == 'posix':
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        recover(root, state)
        release = PINS['cuberite']; data = fetch_verified(root, release)
        if hashlib.sha256(data).hexdigest() != release['sha256'] or release.get('bytes') and len(data) != release['bytes']:
            raise ValueError('Cuberite independently pinned archive identity mismatch')
        license_data = fetch_verified(root, PINS['cuberite_license'])
        if hashlib.sha256(license_data).hexdigest() != PINS['cuberite_license']['sha256']: raise ValueError('Cuberite license checksum mismatch')
        with tempfile.TemporaryDirectory(prefix='stage-', dir=state) as temporary:
            stage = Path(temporary); ready = stage / 'ready'; ready.mkdir(); unpack(data, ready)
            binary = ready / 'Cuberite'
            if not binary.is_file(): raise ValueError('Cuberite executable is missing')
            with binary.open('rb') as source: header = source.read(20)
            if len(header) < 20 or header[:6] != b'\x7fELF\x02\x01' or int.from_bytes(header[18:20], 'little') != 62: raise ValueError('Cuberite requires the pinned Linux x64 native executable')
            binary.chmod(0o755)
            receipt_path = confined(root, '.voltra/cuberite/release.json')
            old = json.loads(receipt_path.read_text()) if receipt_path.exists() else None
            target = confined(root, 'Cuberite'); binary_hash = sha(binary)
            adopted = False
            if target.exists():
                if not target.is_file(): raise ValueError('Cuberite program path is not a regular file')
                expected = old.get('program_sha256') if old else binary_hash
                if old and old.get('game') != 'cuberite' or sha(target) != expected:
                    raise ValueError('Operator-modified Cuberite executable refused; restore the reviewed binary before Reinstall')
                # A prior installer has no ownership inventory. Adoption requires
                # exact bytes from this independently pinned publisher archive.
                adopted = old is None
                info = target.stat(); binary.chmod(stat.S_IMODE(info.st_mode))
                if hasattr(os, 'chown'): os.chown(binary, info.st_uid, info.st_gid)
            # Only the native program is replaceable. Publisher defaults become
            # operator data when seeded; existing files and directories survive.
            plan = {'Cuberite': binary}
            for source in ready.rglob('*'):
                if source.is_dir(): continue
                name = source.relative_to(ready).as_posix(); destination = confined(root, name)
                if name == 'Cuberite': continue
                if destination.exists():
                    if not destination.is_file(): raise ValueError('Cuberite seed path conflicts with operator directory')
                else: plan[name] = source
            seeds = {
                'settings.ini': '[Server]\nPorts=25565\nDescription=Voltra Cuberite\nMaxPlayers=20\n[Authentication]\nAuthenticate=1\n[Plugins]\nPlugin=Core\nPlugin=ChatLog\n',
                'webadmin.ini': '[WebAdmin]\nEnabled=1\nPorts=8080\n[User:admin]\nPassword=\n',
            }
            for name, content in seeds.items():
                destination = confined(root, name)
                if not destination.exists() and name not in plan:
                    source = stage / ('seed-' + name); source.write_text(content); source.chmod(0o600 if name == 'webadmin.ini' else 0o644); plan[name] = source
            if 'webadmin.ini' in plan: plan['webadmin.ini'].chmod(0o600)
            license_name = '.voltra/minecraft-special/licenses/cuberite.txt'
            license_path = confined(root, license_name)
            if license_path.exists() and sha(license_path) != PINS['cuberite_license']['sha256']: raise ValueError('Operator-modified Cuberite license path conflicts')
            if not license_path.exists():
                source = stage / 'license.txt'; source.write_bytes(license_data); plan[license_name] = source
            _publish(root, state, plan, release, binary_hash, adopted or bool(old and old.get('adopted_reviewed_binary')), hook)
    print('Pinned Cuberite installed; modified programs refused and operator data/permissions retained.')


def _publish(root, state, plan, release, binary_hash, adopted, hook):
    backup = state / ('backup-' + uuid.uuid4().hex); backup.mkdir(mode=0o700)
    files, directories = [], set()
    for name in [*plan, '.voltra/cuberite/release.json']:
        destination = confined(root, name)
        parent = destination.parent
        while parent != root and not parent.exists(): directories.add(parent.relative_to(root).as_posix()); parent = parent.parent
        previous = sha(destination) if destination.exists() else None
        if previous: identity_copy(destination, backup / name)
        files.append({'path': name, 'old_sha256': previous})
    atomic_json(state / 'transaction.json', {'backup': backup.name, 'files': files, 'directories': sorted(directories, key=lambda name: len(safe_name(name)))})
    try:
        for name, source in plan.items():
            destination = confined(root, name); destination.parent.mkdir(parents=True, exist_ok=True)
            sync_file(source); hook('before:' + name); os.replace(source, destination); fsync_directory(destination.parent); hook('after:' + name)
        info = (root / 'Cuberite').stat()
        atomic_json(state / 'release.json', {'game': 'cuberite', **release, 'program_sha256': binary_hash, 'program_mode': stat.S_IMODE(info.st_mode), 'program_uid': info.st_uid, 'program_gid': info.st_gid, 'adopted_reviewed_binary': adopted, 'native_runtime_verified': False})
        hook('after:receipt')
        (state / 'transaction.json').unlink(); fsync_directory(state); shutil.rmtree(backup)
    except BaseException:
        recover(root, state)
        raise


if __name__ == '__main__': install(Path.cwd())
