"""MIT. Public Steam publication with operator configuration/world retention."""
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tempfile
import zipfile
import steam_template
from fantasy_worlds_runtime import APPS, SOLACE, confined, portal_save_path, publish, publish_stream, read_json


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def protected(root, game):
    if game == 'citadel':
        return ['Config', 'Citadel/Saved', 'Engine/Saved', 'Mods', 'Citadel/Mods']
    if game == 'solace':
        return [SOLACE, 'Mods', 'mods']
    paths = ['dedicated_server/server_config.json', 'dedicated_server/savedata', 'dedicated_server/mods']
    config = confined(root, 'dedicated_server/server_config.json')
    if config.exists():
        paths.append(portal_save_path(root, read_json(config)).relative_to(root).as_posix())
    return paths


class Retention:
    def __init__(self, root, game, backup):
        self.root, self.backup = root, Path(backup)
        self.files, self.directories, self.links = {}, {}, {}
        self.seen = set()
        for relative in protected(root, game):
            self.capture(root / relative, game)

    def capture(self, path, game):
        relative = path.relative_to(self.root).as_posix()
        if path.is_symlink():
            allowed = game == 'citadel' and relative in ('Citadel/Saved/Config/LinuxServer', 'Engine/Saved/Config/LinuxServer') and path.resolve() == self.root / 'Config'
            if not allowed:
                raise ValueError('Unreviewed operator-state symlink; preserve it for explicit migration')
            self.links[relative] = os.readlink(path)
            self.capture(path.resolve(), game)
            return
        path = confined(self.root, relative)
        if relative in self.seen or not path.exists():
            return
        self.seen.add(relative)
        metadata = path.stat()
        if path.is_dir():
            self.directories[relative] = metadata
            for child in path.iterdir():
                self.capture(child, game)
        elif path.is_file():
            target = self.backup / str(len(self.files))
            shutil.copyfile(path, target)
            target.chmod(0o600)
            self.files[relative] = (target, metadata, digest(target))
        else:
            raise ValueError('Operator state must contain regular files and directories')

    def restore(self):
        for relative, metadata in sorted(self.directories.items(), key=lambda item: len(PurePosixPath(item[0]).parts)):
            directory = confined(self.root, relative)
            directory.mkdir(parents=True, exist_ok=True)
        for relative, (backup, metadata, expected) in self.files.items():
            path = confined(self.root, relative)
            current = path.stat() if path.exists() else None
            if current and path.is_file() and digest(path) == expected and (current.st_mode & 0o777, current.st_uid, current.st_gid) == (metadata.st_mode & 0o777, metadata.st_uid, metadata.st_gid):
                continue
            with backup.open('rb') as source:
                publish_stream(self.root, relative, lambda output: shutil.copyfileobj(source, output), metadata=metadata)
        for relative, target in self.links.items():
            path = self.root / relative
            if path.is_symlink():
                if os.readlink(path) != target:
                    raise ValueError('A legacy configuration link changed during installation')
            elif path.exists():
                raise ValueError('A legacy configuration link was replaced; preserve the new destination for review')
            else:
                confined(self.root, str(PurePosixPath(relative).parent))
                path.parent.mkdir(parents=True, exist_ok=True)
                path.symlink_to(target, target_is_directory=True)
        for relative, metadata in self.directories.items():
            path = confined(self.root, relative)
            descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                if os.geteuid() == 0:
                    os.fchown(descriptor, metadata.st_uid, metadata.st_gid)
                os.fchmod(descriptor, metadata.st_mode & 0o777)
            finally:
                os.close(descriptor)


CITADEL_SDK = 'Citadel/Plugins/UWorks/Source/ThirdParty/Linux/steamclient.so'
CITADEL_SDK_LEDGER = '.voltra/fantasy-worlds/citadel-sdk.json'
SDK_LIMIT = 64 * 1024 * 1024


def sdk_regular(root, relative, maximum):
    path = confined(root, relative)
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(metadata.st_mode) or not 0 < metadata.st_size <= maximum:
        raise ValueError('Citadel SDK and ownership receipt require bounded regular files')
    return metadata


def sdk_unlink(root, relative):
    # Anchor rollback to the owned publication parent, reject a changed inode,
    # and unlink the leaf only; never follow links or sweep parent directories.
    with steam_template._publication_parent(root, relative) as (parent, leaf, _):
        if parent is None:
            return
        try:
            before = os.stat(leaf, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            return
        if not (stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode)):
            raise ValueError('Unexpected Citadel SDK rollback object')
        current = os.stat(leaf, dir_fd=parent, follow_symlinks=False)
        if (before.st_dev, before.st_ino) != (current.st_dev, current.st_ino):
            raise ValueError('Citadel SDK rollback destination changed')
        os.unlink(leaf, dir_fd=parent)


class CitadelSDK:
    """Pre-Steam ownership boundary and two-file SDK/receipt transaction."""
    def __init__(self, root, backup):
        self.root, self.backup, self.before = root, backup, {}
        for relative, maximum in ((CITADEL_SDK, SDK_LIMIT), (CITADEL_SDK_LEDGER, 65536)):
            path = root / relative
            confined(root, str(PurePosixPath(relative).parent))
            if relative == CITADEL_SDK and path.is_symlink():
                if path.resolve() not in (root / 'linux64/steamclient.so', root / '.steam/sdk64/steamclient.so'):
                    raise ValueError('Unexpected Citadel SDK link target')
                # Validate the resolved source separately, including all parents.
                if sdk_regular(root, path.resolve().relative_to(root).as_posix(), SDK_LIMIT) is None:
                    raise ValueError('Citadel legacy SDK link source is missing')
                self.before[relative] = ('link', os.readlink(path), path.lstat())
                continue
            metadata = sdk_regular(root, relative, maximum)
            if metadata is None:
                self.before[relative] = None
            else:
                copy = backup / ('sdk' if relative == CITADEL_SDK else 'receipt')
                shutil.copyfile(path, copy)
                copy.chmod(0o600)
                self.before[relative] = ('file', copy, metadata, digest(copy))
        target, receipt = self.before[CITADEL_SDK], self.before[CITADEL_SDK_LEDGER]
        if receipt:
            value = read_json(root / CITADEL_SDK_LEDGER)
            keys = {'schema_version', 'target', 'sha256', 'bytes', 'source_sha256', 'source_bytes'}
            if set(value) != keys or type(value['schema_version']) is not int or value['schema_version'] != 1 or value['target'] != CITADEL_SDK:
                raise ValueError('Invalid Citadel SDK ownership receipt')
            if any(not isinstance(value[key], str) or not re.fullmatch('[a-f0-9]{64}', value[key]) for key in ('sha256', 'source_sha256')) or any(type(value[key]) is not int or not 0 < value[key] <= SDK_LIMIT for key in ('bytes', 'source_bytes')):
                raise ValueError('Invalid Citadel SDK ownership digest/size')
            if not target or target[0] != 'file' or target[3] != value['sha256'] or target[2].st_size != value['bytes']:
                raise ValueError('Citadel SDK was modified; preserve it for explicit migration')
        elif target and target[0] == 'file':
            source = sdk_regular(root, '.steam/sdk64/steamclient.so', SDK_LIMIT)
            if source is None or target[3] != digest(root / '.steam/sdk64/steamclient.so'):
                raise ValueError('Untracked Citadel SDK differs; preserve it for explicit migration')

    def restore(self):
        failures = []
        for relative, before in self.before.items():
            try:
                path = self.root / relative
                confined(self.root, str(PurePosixPath(relative).parent))
                if before is None:
                    sdk_unlink(self.root, relative)
                elif before[0] == 'link':
                    if path.is_symlink() and os.readlink(path) == before[1]:
                        continue
                    sdk_unlink(self.root, relative)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.symlink_to(before[1])
                    if os.geteuid() == 0:
                        os.lchown(path, before[2].st_uid, before[2].st_gid)
                else:
                    if path.is_symlink():
                        sdk_unlink(self.root, relative)
                    metadata = sdk_regular(self.root, relative, SDK_LIMIT if relative == CITADEL_SDK else 65536)
                    old = before[2]
                    if metadata and digest(path) == before[3] and (metadata.st_mode, metadata.st_uid, metadata.st_gid) == (old.st_mode, old.st_uid, old.st_gid):
                        continue
                    with before[1].open('rb') as source:
                        publish_stream(self.root, relative, lambda output: shutil.copyfileobj(source, output), metadata=old)
            except Exception as error:
                failures.append(error)
        if failures:
            raise RuntimeError('Citadel SDK rollback incomplete; both owned paths were attempted') from failures[0]

    def publish_current(self):
        source = self.root / '.steam/sdk64/steamclient.so'
        metadata = sdk_regular(self.root, '.steam/sdk64/steamclient.so', SDK_LIMIT)
        if metadata is None:
            raise ValueError('Citadel requires the official Steam Linux64 SDK library')
        # Revalidate both parents before changing either destination.
        for relative in self.before:
            confined(self.root, str(PurePosixPath(relative).parent))
        destination = self.root / CITADEL_SDK
        expected = digest(source)
        if destination.is_symlink():
            if destination.resolve() not in (self.root / 'linux64/steamclient.so', source):
                raise ValueError('Unexpected Citadel SDK link target')
            sdk_unlink(self.root, CITADEL_SDK)
        if not destination.exists() or digest(destination) != expected:
            publish(self.root, CITADEL_SDK, source.read_bytes(), mode=0o644)
        value = {'schema_version': 1, 'target': CITADEL_SDK, 'sha256': expected, 'bytes': metadata.st_size,
                 'source_sha256': expected, 'source_bytes': metadata.st_size}
        publish(self.root, CITADEL_SDK_LEDGER, (json.dumps(value, sort_keys=True) + '\n').encode(), mode=0o600)


def install_sdk(root):
    with tempfile.TemporaryDirectory(prefix='voltra-citadel-sdk-', dir=root) as temporary:
        state = CitadelSDK(root, Path(temporary))
        try:
            state.publish_current()
        except Exception:
            state.restore()
            raise


def unpack_portal(root):
    archive_path = confined(root, 'dedicated_server.zip')
    if not archive_path.is_file() or archive_path.stat().st_size > 2 * 1024**3:
        raise ValueError('The official client depot must contain a bounded dedicated_server.zip')
    receipt_path = confined(root, '.voltra/fantasy-worlds/portal-files.json')
    old = read_json(receipt_path) if receipt_path.exists() else {}
    tracked = old.get('files', {})
    if not isinstance(tracked, dict):
        raise ValueError('Invalid Portal program receipt')
    exclusions = [tuple(part.casefold() for part in PurePosixPath(value).parts) for value in protected(root, 'portal')]
    with zipfile.ZipFile(archive_path) as archive, tempfile.TemporaryDirectory(prefix='voltra-portal-', dir=confined(root, '.')) as rollback:
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or '\\' in entry.filename or ':' in entry.filename or any(part in ('.', '..') for part in path.parts) or any(ord(c) < 32 for c in entry.filename) or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1:
                raise ValueError('Unsafe Portal dedicated-server archive member')
        entries = [entry for entry in archive.infolist() if not entry.is_dir()]
        executable = [entry for entry in entries if PurePosixPath(entry.filename).name.casefold() == 'pk_dedicated_server.exe']
        if len(executable) != 1:
            raise ValueError('Publisher archive must contain exactly one dedicated-server executable')
        prefix = PurePosixPath(executable[0].filename).parts[:-1]
        changes, hashes, seen = [], {}, set()
        total = 0
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or '\\' in entry.filename or ':' in entry.filename or any(part in ('.', '..') for part in path.parts) or any(ord(c) < 32 for c in entry.filename) or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1:
                raise ValueError('Unsafe Portal dedicated-server archive member')
            if path.parts[:len(prefix)] != prefix:
                raise ValueError('Ambiguous Portal archive wrapper layout')
            stripped = path.parts[len(prefix):]
            if not stripped:
                continue
            relative = PurePosixPath('dedicated_server', *stripped).as_posix()
            identity = relative.casefold()
            if identity in seen:
                raise ValueError('Case-insensitive duplicate Portal archive destination')
            seen.add(identity)
            parts = tuple(part.casefold() for part in PurePosixPath(relative).parts)
            if any(parts[:len(excluded)] == excluded for excluded in exclusions):
                continue
            total += entry.file_size
            if entry.file_size > 256 * 1024**2 or total > 4 * 1024**3 or len(seen) > 16384:
                raise ValueError('Portal archive expansion exceeds bounded size')
            with archive.open(entry) as source:
                expected = hashlib.file_digest(source, 'sha256').hexdigest()
            hashes[relative] = expected
            destination = confined(root, relative)
            if destination.exists():
                actual = digest(destination)
                if actual == expected:
                    continue
                if tracked.get(relative) != actual:
                    raise ValueError('Portal program file is modified or unmanaged; preserve it for explicit migration')
                backup = Path(rollback) / str(len(changes))
                shutil.copyfile(destination, backup)
                metadata = destination.stat()
            else:
                backup, metadata = None, None
            changes.append((entry, relative, backup, metadata))
        published = []
        def commit(relative, write, backup, metadata, mode=0o644):
            reserved = {}
            def writer(output):
                write(output)
                reserved['inode'] = os.fstat(output.fileno())
            try:
                steam_template._publish(root, relative, writer, default_mode=mode)
            except BaseException:
                path = confined(root, relative)
                current = path.stat() if path.exists() else None
                inode = reserved.get('inode')
                if current and inode and (current.st_dev, current.st_ino) == (inode.st_dev, inode.st_ino):
                    published.append((relative, backup, metadata, current))
                raise
            published.append((relative, backup, metadata, confined(root, relative).stat()))
        try:
            for entry, relative, backup, metadata in changes:
                with archive.open(entry) as source:
                    commit(relative, lambda output: shutil.copyfileobj(source, output), backup, metadata)
            receipt_backup, receipt_metadata = None, None
            if receipt_path.exists():
                receipt_backup = Path(rollback) / 'receipt'
                shutil.copyfile(receipt_path, receipt_backup)
                receipt_metadata = receipt_path.stat()
            data = (json.dumps({'files': hashes}, indent=2) + '\n').encode()
            commit('.voltra/fantasy-worlds/portal-files.json', lambda output: output.write(data), receipt_backup, receipt_metadata, 0o600)
        except BaseException as failure:
            rollback_errors = []
            for relative, backup, metadata, inode in reversed(published):
                try:
                    path = confined(root, relative)
                    current = path.stat()
                    if (current.st_dev, current.st_ino) != (inode.st_dev, inode.st_ino):
                        raise ValueError('Portal rollback destination changed')
                    if backup is None:
                        path.unlink()
                    else:
                        with backup.open('rb') as source:
                            publish_stream(root, relative, lambda output: shutil.copyfileobj(source, output), metadata=metadata)
                except BaseException as error:
                    rollback_errors.append(error)
            if rollback_errors:
                raise RuntimeError('Portal publication failed; rollback reported an error and all owned destinations were attempted') from failure
            raise


def install(root, game, env, validate=True):
    root = root.resolve()
    if game not in APPS or str(env.get('SRCDS_APPID', APPS[game])) != str(APPS[game]):
        raise ValueError('Use the original reviewed Steam application ID')
    if env.get('EXTRA_FLAGS', ''):
        raise ValueError('Arbitrary Steam EXTRA_FLAGS are unsupported; use typed Steam options')
    platform = 'windows' if game == 'portal' else 'linux'
    uploaded = game == 'portal' and env.get('PORTAL_INSTALL_MODE', 'steam') == 'uploaded'
    if game == 'portal' and env.get('PORTAL_INSTALL_MODE', 'steam') not in ('steam', 'uploaded'):
        raise ValueError('Choose Steam or legally uploaded Portal payload')
    validation = {key: value for key, value in env.items() if key not in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')} if uploaded else env
    steam_template.arguments(root, APPS[game], validation, validate, platform=platform)
    # Credential and branch validation precedes preservation copies and processes.
    with tempfile.TemporaryDirectory(prefix='voltra-fantasy-preserve-', dir=confined(root, '.')) as backup:
        state = Retention(root, game, backup)
        sdk = None
        if game == 'citadel':
            sdk_backup = Path(backup) / 'sdk-state'
            sdk_backup.mkdir(mode=0o700)
            sdk = CitadelSDK(root, sdk_backup)
        try:
            try:
                required = {'citadel': ('CitadelServer.sh',), 'portal': ('dedicated_server.zip',), 'solace': ('Solace Crafting.x86_64',)}[game]
                try:
                    result = {'source': 'operator-uploaded', 'native_verification': 'not_verified'} if uploaded else steam_template.update(root, APPS[game], env, validate=validate, required=required, platform=platform)
                finally:
                    if sdk:
                        # The original SDK ownership boundary precedes Steam,
                        # even when a fresh depot supplies a different old SDK.
                        sdk.restore()
                if sdk:
                    sdk.publish_current()
                elif game == 'portal':
                    if not uploaded or confined(root, 'dedicated_server.zip').is_file():
                        unpack_portal(root)
                    if not confined(root, 'dedicated_server/pk_dedicated_server.exe').is_file():
                        raise ValueError('Upload a legally acquired Portal dedicated_server.zip or dedicated_server directory')
                    from fantasy_worlds_wine_build import ensure
                    ensure(root)
                return result
            finally:
                state.restore()
        except Exception:
            if sdk:
                sdk.restore()
            raise


if __name__ == '__main__':
    try:
        install(Path.cwd(), sys.argv[1], dict(os.environ))
    except Exception:
        print('Fantasy-world installation failed. Check publisher entitlement, private Steam limitations, official depot layout and existing operator-file collisions.', file=sys.stderr)
        sys.exit(1)
