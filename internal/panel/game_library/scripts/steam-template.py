#!/usr/bin/env python3
"""MIT. Shared SteamCMD contract for imported game templates, without shell flags."""
import hashlib
from contextlib import contextmanager
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import subprocess
import stat
import tarfile
import tempfile
import urllib.request

BOOTSTRAP = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz'


@contextmanager
def _publication_parent(root, relative, create=False):
    """Walk from the volume with anchored directory FDs, never symlinks."""
    parts = PurePosixPath(relative).parts
    if not parts or PurePosixPath(relative).is_absolute() or any(p in ('.', '..') for p in parts):
        raise ValueError('Invalid Steam publication path')
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    if root.resolve() != root or root.is_symlink():
        raise ValueError('Steam publication volume path changed')
    descriptor = os.open(root, flags)
    volume = os.fstat(descriptor)
    try:
        for part in parts[:-1]:
            try:
                next_descriptor = os.open(part, flags, dir_fd=descriptor)
            except FileNotFoundError:
                if not create:
                    yield None, parts[-1], volume
                    return
                os.mkdir(part, 0o755, dir_fd=descriptor)
                next_descriptor = os.open(part, flags, dir_fd=descriptor)
                try:
                    if os.geteuid() == 0:
                        os.fchown(next_descriptor, volume.st_uid, volume.st_gid)
                except BaseException:
                    os.close(next_descriptor)
                    raise
            os.close(descriptor)
            descriptor = next_descriptor
        yield descriptor, parts[-1], volume
    finally:
        os.close(descriptor)


def _publication_leaf(parent, name):
    try:
        metadata = os.stat(name, dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(metadata.st_mode):
        raise ValueError('Steam publication destination must be a regular file')
    return metadata


def _publication_check(root):
    # Run before bootstrap/SteamCMD and again after the publisher, including
    # missing leaves: existing parent components must still be confined.
    for relative in ('.voltra/steam-template-release.json',
                     '.steam/sdk32/steamclient.so', '.steam/sdk64/steamclient.so',
                     '.voltra/steamcmd/linux32/steamclient.so',
                     '.voltra/steamcmd/linux64/steamclient.so'):
        with _publication_parent(root, relative) as (parent, name, _):
            if parent is not None:
                _publication_leaf(parent, name)


def _publish(root, relative, writer, default_mode=0o644):
    """Publish new bytes while retaining existing ownership and permissions."""
    with _publication_parent(root, relative, create=True) as (parent, name, volume):
        previous = _publication_leaf(parent, name)
        temporary, descriptor, identity = None, None, None
        try:
            for attempt in range(5):
                candidate = '.voltra-publish-' + secrets.token_hex(16)
                try:
                    descriptor = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                         0o600, dir_fd=parent)
                    temporary = candidate
                    break
                except FileExistsError:
                    continue
            if descriptor is None:
                raise ValueError('Cannot reserve a private Steam publication file')
            identity = os.fstat(descriptor)
            with os.fdopen(os.dup(descriptor), 'wb') as output:
                writer(output)
                output.flush()
            metadata = previous or volume
            if os.geteuid() == 0:
                os.fchown(descriptor, metadata.st_uid, metadata.st_gid)
            os.fchmod(descriptor, stat.S_IMODE(previous.st_mode) if previous else default_mode)
            os.fsync(descriptor)
            with _publication_parent(root, relative) as (current, leaf, _):
                if current is None or (os.fstat(current).st_dev, os.fstat(current).st_ino) != (os.fstat(parent).st_dev, os.fstat(parent).st_ino):
                    raise ValueError('Steam publication parent changed')
                latest = _publication_leaf(current, leaf)
                signature = lambda value: None if value is None else (value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
                if signature(latest) != signature(previous):
                    raise ValueError('Steam publication destination changed')
                candidate = os.stat(temporary, dir_fd=parent, follow_symlinks=False)
                if (candidate.st_dev, candidate.st_ino) != (identity.st_dev, identity.st_ino):
                    raise ValueError('Steam publication temporary file changed')
                os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
                temporary = None
                os.fsync(parent)
            _publication_check(root)
        finally:
            if temporary is not None and identity is not None:
                # Remove only the inode reserved by this invocation. A replaced
                # or unknown name is never deleted as failure cleanup.
                try:
                    current = os.stat(temporary, dir_fd=parent, follow_symlinks=False)
                    if (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino):
                        os.unlink(temporary, dir_fd=parent)
                except FileNotFoundError:
                    pass
            if descriptor is not None:
                os.close(descriptor)


class SteamInstallError(RuntimeError):
    def __init__(self, app_id, status, reason):
        self.app_id, self.status, self.reason = app_id, status, reason
        super().__init__('SteamCMD failed (' + reason + '); inspect the redacted installation output')


def failure_reason(output, app_id):
    clean = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', output)
    expected = ("ERROR! Failed to install app '" + str(app_id) + "' (Invalid platform)").encode('ascii')
    return 'invalid_platform' if any(line.strip() == expected for line in clean.splitlines()) else 'steamcmd_failed'


def arguments(root, app_id, env, validate=True, platform='linux', *, force_platform=False):
    # SteamCMD reparses its argv using its own command language. Raw argv is
    # therefore not a faithful credential transport (e.g. a leading + value
    # becomes another command). Keep unverified private paths unavailable.
    if (env.get('SRCDS_BETAPASS', '') or env.get('STEAM_PASS', '') or
            env.get('STEAM_AUTH', '') or env.get('STEAM_USER', '') not in ('', 'anonymous')):
        raise ValueError('Private Steam credentials are not enabled until native command parsing is verified')
    if not isinstance(app_id, int) or isinstance(app_id, bool) or not 1 <= app_id <= 2**31 - 1:
        raise ValueError('Choose a numeric Steam application ID')
    branch = env.get('SRCDS_BETAID', '')
    if branch and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}', branch):
        raise ValueError('Invalid Steam branch name')
    credentials = [env.get(name, '') for name in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH')]
    if any(value.startswith(('+', '-')) or any(ord(c) < 32 or ord(c) == 127 for c in value) for value in credentials):
        raise ValueError('Steam credentials cannot contain controls or begin with command prefixes')
    if credentials[0] and credentials[0] != 'anonymous':
        if not credentials[1]:
            raise ValueError('A Steam account password is required for account login')
        login = credentials[:2] + ([credentials[2]] if credentials[2] else [])
    else:
        login = ['anonymous']
    if platform not in ('linux', 'windows'):
        raise ValueError('Choose a reviewed Steam target platform')
    if not isinstance(force_platform, bool): raise ValueError('Platform selection must be an explicit boolean')
    if env.get('WINDOWS_INSTALL', '1' if platform == 'windows' else '0') != ('1' if platform == 'windows' else '0'):
        raise ValueError('Steam target platform does not match this reviewed template')
    args = [str(root / '.voltra/steamcmd/steamcmd.sh'), '+@ShutdownOnFailedCommand', '1',
            '+@NoPromptForPassword', '1', '+force_install_dir', str(root)]
    if platform == 'windows' or force_platform:
        args += ['+@sSteamCmdForcePlatformType', platform]
    args += ['+login', *login,
            # Required for first installs in a cold SteamCMD metadata cache.
            '+app_info_update', '1', '+app_info_print', str(app_id)]
    if app_id == 90:
        game = env.get('HLDS_GAME', 'cstrike')
        if not re.fullmatch(r'[A-Za-z0-9_]{1,32}', game):
            raise ValueError('Choose a native HLDS mod directory')
        args += ['+app_set_config', '90', 'mod', game]
    args += ['+app_update', str(app_id)]
    if branch and branch != 'public':
        args += ['-beta', branch]
    beta_password = env.get('SRCDS_BETAPASS', '')
    if beta_password:
        if not branch or branch == 'public' or beta_password.startswith(('+', '-')) or any(ord(c) < 32 or ord(c) == 127 for c in beta_password):
            raise ValueError('A beta password requires a selected private branch')
        args += ['-betapassword', beta_password]
    if env.get('INSTALL_FLAGS', ''):
        raise ValueError('Use typed Steam options instead of arbitrary INSTALL_FLAGS')
    if validate:
        args += ['validate']
    return args + ['+quit']


def manifest(root, app_id):
    path = root / 'steamapps' / ('appmanifest_' + str(app_id) + '.acf')
    text = path.read_text(encoding='utf-8')
    values = {}
    for key in ('appid', 'StateFlags', 'buildid'):
        matches = re.findall(r'"' + key + r'"\s+"([0-9]+)"', text)
        if len(matches) != 1:
            raise ValueError('Steam manifest is missing an unambiguous ' + key)
        values[key] = int(matches[0])
    if values['appid'] != app_id or values['StateFlags'] != 4 or values['buildid'] < 1:
        raise ValueError('Steam did not leave a fully installed application manifest')
    return values


class Redactor:
    """Keep incomplete credential matches across pipe reads out of console output."""
    def __init__(self, values):
        self.values = sorted({v.encode('utf-8') for v in values if v}, key=len, reverse=True)
        self.keep = max((len(v) for v in self.values), default=1)
        self.pending = b''

    def feed(self, chunk, final=False):
        self.pending += chunk
        cut = len(self.pending) if final else max(0, len(self.pending) - self.keep)
        if not final:
            for secret in self.values:
                position = self.pending.find(secret)
                while position >= 0 and position < cut:
                    if position + len(secret) > cut:
                        cut = position
                        break
                    position = self.pending.find(secret, position + 1)
        output, self.pending = self.pending[:cut], self.pending[cut:]
        for secret in self.values:
            output = output.replace(secret, b'[redacted]')
        return output


def bootstrap(root):
    target = root / '.voltra/steamcmd'
    if target.is_symlink() or not target.resolve().is_relative_to(root):
        raise ValueError('SteamCMD destination escapes the server volume')
    if (target / 'steamcmd.sh').is_file() and (target / 'linux32/steamcmd').is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.steam-bootstrap-', dir=target.parent) as temporary:
        stage = Path(temporary)
        archive = stage / 'steamcmd.tar.gz'
        checksum, count = hashlib.sha256(), 0
        with urllib.request.urlopen(BOOTSTRAP, timeout=120) as response, archive.open('xb') as output:
            if not response.geturl().startswith('https://'):
                raise ValueError('SteamCMD bootstrap redirected outside HTTPS')
            while True:
                block = response.read(1048576)
                if not block:
                    break
                count += len(block)
                if count > 128 * 1024**2:
                    raise ValueError('SteamCMD bootstrap archive exceeds its size limit')
                checksum.update(block)
                output.write(block)
        ready = stage / 'ready'; ready.mkdir()
        seen, total = set(), 0
        with tarfile.open(archive, 'r:gz') as source:
            for member in source:
                path = PurePosixPath(member.name)
                if path.is_absolute() or '..' in path.parts or '\\' in member.name or not (member.isfile() or member.isdir()):
                    raise ValueError('Unsafe SteamCMD bootstrap archive')
                if path.as_posix() == '.':
                    continue
                if path.as_posix() in seen:
                    raise ValueError('Duplicate SteamCMD bootstrap path')
                seen.add(path.as_posix()); total += member.size
                if len(seen) > 10000 or total > 512 * 1024**2:
                    raise ValueError('SteamCMD bootstrap expansion exceeds its limit')
                destination = ready.joinpath(*path.parts)
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with source.extractfile(member) as inp, destination.open('xb') as output:
                        shutil.copyfileobj(inp, output)
                    destination.chmod(member.mode & 0o777)
        for name in ('steamcmd.sh', 'linux32/steamcmd'):
            if not (ready / name).is_file():
                raise ValueError('SteamCMD bootstrap is missing its launcher')
            (ready / name).chmod(0o755)
        if target.exists():
            raise ValueError('Incomplete existing SteamCMD folder needs operator review')
        os.replace(ready, target)
        (target.parent / 'steamcmd-bootstrap.json').write_text(json.dumps({'url': BOOTSTRAP, 'sha256': checksum.hexdigest(), 'bytes': count}) + '\n')


def update(root, app_id, env=None, validate=True, required=(), platform='linux', *, force_platform=False):
    supplied_root = root.absolute()
    root = root.resolve()
    env = os.environ if env is None else env
    args = arguments(root, app_id, env, validate, platform=platform, force_platform=force_platform)
    if supplied_root != root:
        raise ValueError('Steam publication volume must not contain symlinks or traversal')
    _publication_check(root)
    bootstrap(root)
    _publication_check(root)
    child_env = {**os.environ, 'HOME': str(root)}
    for name in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD'):
        child_env.pop(name, None)
    # The bundled Python dependency directory belongs to the helper only.
    child_env.pop('LD_LIBRARY_PATH', None)
    print('SteamCMD: refresh target metadata, then ' + ('validate/install' if validate else 'update') + ' application ' + str(app_id), flush=True)
    child = subprocess.Popen(['timeout', '--signal=TERM', '--kill-after=30s', '7200s', *args], cwd=root, env=child_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    secrets = [env.get(key, '') for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    redactor = Redactor(secrets)
    failure_tail = b''
    import sys
    try:
        while True:
            block = child.stdout.read1(16384)
            if not block:
                break
            failure_tail = (failure_tail + block)[-8192:]
            sys.stdout.buffer.write(redactor.feed(block)); sys.stdout.buffer.flush()
        sys.stdout.buffer.write(redactor.feed(b'', final=True)); sys.stdout.buffer.flush()
        status = child.wait()
    except BaseException:
        child.terminate()
        try:
            child.wait(timeout=30)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        # TimeoutExpired includes the original command arguments, which can
        # contain Steam credentials. Never let that exception reach the console.
        raise RuntimeError('Steam helper interrupted; inspect the redacted output') from None
    if status != 0:
        raise SteamInstallError(app_id, status, failure_reason(failure_tail, app_id))
    _publication_check(root)
    receipt = manifest(root, app_id)
    for name in required:
        path = root / name
        if not path.resolve().is_relative_to(root) or not path.is_file() or path.stat().st_size == 0:
            raise ValueError('Steam installation lacks a required server file')
    for bits in ('32', '64'):
        with _publication_parent(root, '.voltra/steamcmd/linux' + bits + '/steamclient.so') as (parent, name, _):
            if parent is None or _publication_leaf(parent, name) is None:
                continue
            descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
            with os.fdopen(descriptor, 'rb') as source:
                metadata = os.fstat(source.fileno())
                if not stat.S_ISREG(metadata.st_mode):
                    raise ValueError('Steam SDK source must be a regular file')
                _publish(root, '.steam/sdk' + bits + '/steamclient.so',
                         lambda output: shutil.copyfileobj(source, output), metadata.st_mode & 0o777)
    payload = (json.dumps({**receipt, 'branch': env.get('SRCDS_BETAID', '') or 'public', 'platform': platform}, indent=2) + '\n').encode('utf-8')
    _publish(root, '.voltra/steam-template-release.json', lambda output: output.write(payload))
    return receipt
