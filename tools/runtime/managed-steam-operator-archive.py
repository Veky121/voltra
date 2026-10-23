"""Private operator-state transfer between two receipt-owned stopped fixtures."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tarfile
import uuid

ROOTS = ('FactoryGame/Saved', '.config/Epic/FactoryGame/Saved')
LIMIT = 64 * 1024 * 1024


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def safe_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or any(p in ('', '.', '..') for p in name.split('/')) or '\\' in name or '\0' in name:
        raise ValueError('Unsafe archive path')
    if not any(name == root or name.startswith(root + '/') for root in ROOTS):
        raise ValueError('Unowned archive path')
    return path


def scan(game):
    records = {}
    total = 0
    for root in ROOTS:
        base = game/root
        for parent in [base, *base.parents]:
            if parent == game:
                break
            if parent.is_symlink():
                raise ValueError('Operator state parent is a link')
        if not base.exists() and not base.is_symlink():
            continue
        for file in [base, *sorted(base.rglob('*'))]:
            info = file.lstat()
            if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)) or file.is_symlink():
                raise ValueError('Operator state contains a link or special file')
            if info.st_uid != 1000 or info.st_gid != 1000 or info.st_mode & 0o7000:
                raise ValueError('Operator state has unexpected ownership or mode')
            name = file.relative_to(game).as_posix()
            safe_name(name)
            record = {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid,
                      'directory': file.is_dir(), 'size': 0 if file.is_dir() else info.st_size}
            if not file.is_dir():
                total += info.st_size
                if total > LIMIT:
                    raise ValueError('Operator state exceeds bounded archive size')
                record['sha256'] = digest(file)
            records[name] = record
    if not records:
        raise ValueError('Operator state is empty')
    return records


def export(game, directory):
    records = scan(game)
    archive = directory/'operator.tar.gz'
    if archive.exists() or (directory/'manifest.json').exists():
        raise ValueError('Immutable export already exists')
    with tarfile.open(archive, 'w:gz', format=tarfile.PAX_FORMAT) as output:
        for name in records:
            output.add(game/name, arcname=name, recursive=False)
    manifest = {'schema': 1, 'archive_sha256': digest(archive), 'records': records}
    (directory/'manifest.json').write_text(json.dumps(manifest, sort_keys=True, indent=2)+'\n')
    archive.chmod(0o400)
    (directory/'manifest.json').chmod(0o400)
    return {'entries': len(records), 'files': sum(not r['directory'] for r in records.values()),
            'archive_bytes': archive.stat().st_size, 'archive_sha256': manifest['archive_sha256']}


def restore(game, directory):
    manifest = json.loads((directory/'manifest.json').read_text())
    archive = directory/'operator.tar.gz'
    if manifest.get('schema') != 1 or archive.stat().st_size > LIMIT or digest(archive) != manifest['archive_sha256']:
        raise ValueError('Private archive integrity check failed')
    records = manifest['records']
    stage = game/('.voltra-operator-restore-'+str(uuid.uuid4()))
    stage.mkdir(mode=0o700)
    backup = stage/'previous'
    backup.mkdir()
    installed, moved = [], []
    succeeded = False
    try:
        with tarfile.open(archive, 'r:gz') as source:
            members = source.getmembers()
            if len(members) != len(records) or len({m.name for m in members}) != len(members):
                raise ValueError('Private archive contains duplicate or unknown members')
            total = 0
            for member in members:
                safe_name(member.name)
                record = records.get(member.name)
                if not record or not (member.isfile() or member.isdir()) or member.isdir() != record['directory']:
                    raise ValueError('Private archive member type mismatch')
                if record['uid'] != 1000 or record['gid'] != 1000 or record['mode'] & ~0o777:
                    raise ValueError('Private archive ownership or mode mismatch')
                total += member.size
                if total > LIMIT or member.size != record['size']:
                    raise ValueError('Private archive size mismatch')
                target = stage/'new'/member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                if member.isdir():
                    target.mkdir(exist_ok=True)
                else:
                    with source.extractfile(member) as data, target.open('xb') as output:
                        shutil.copyfileobj(data, output)
                    if digest(target) != record['sha256']:
                        raise ValueError('Private archive file integrity mismatch')
                target.chmod(record['mode'])
                os.chown(target, 1000, 1000)
        # Inspect the destination before replacing any existing protected root.
        scan(game)
        for root in ROOTS:
            destination, replacement = game/root, stage/'new'/root
            parent = destination.parent
            while parent != game:
                if parent.is_symlink() or parent.exists() and not parent.is_dir():
                    raise ValueError('Unsafe destination parent')
                parent = parent.parent
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                previous = backup/root
                previous.parent.mkdir(parents=True, exist_ok=True)
                destination.rename(previous)
                moved.append(root)
            if replacement.exists():
                replacement.rename(destination)
                installed.append(root)
        if scan(game) != records:
            raise ValueError('Restored private state differs from exact manifest')
        succeeded = True
    except Exception:
        for root in reversed(installed):
            shutil.rmtree(game/root)
        for root in reversed(moved):
            (backup/root).rename(game/root)
        raise
    finally:
        # Failed compensation must never delete the retained previous state.
        if succeeded:
            shutil.rmtree(stage)
    return {'entries': len(records), 'files': sum(not r['directory'] for r in records.values()), 'exact_manifest_match': True}


if __name__ == '__main__':
    operation = sys.argv[1]
    result = export(Path('/game'), Path('/export')) if operation == 'export' else restore(Path('/game'), Path('/export'))
    print(json.dumps(result))
