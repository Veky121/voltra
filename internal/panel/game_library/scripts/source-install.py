#!/usr/bin/env python3
"""MIT. Preserve native Source operator configuration around Steam validation."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import uuid
from steam_template import update as steam_update
from steam_template import SteamInstallError

GAME_DIRECTORIES = {232330: 'cstrike', 232250: 'tf', 232370: 'hl2mp', 295230: 'fof',
                    346680: 'bms', 317670: 'nmrih', 222840: 'left4dead',
                    222860: 'left4dead2', 673990: 'iosoccer', 349090: 'baseq3',
                    4020: 'garrysmod', 293030: 'contagion', 244310: 'open_fortress'}


def confined(root, path):
    if not path.resolve().is_relative_to(root):
        raise ValueError('Source configuration path escapes the server volume')


def protected_files(root, game):
    folder = root / game
    confined(root, folder)
    if not folder.exists(): return []
    result = []
    for path in folder.rglob('*'):
        relative = path.relative_to(folder)
        configuration = any(part.casefold() in ('cfg', 'config', 'configs') for part in relative.parts[:-1])
        if not configuration and path.suffix.casefold() not in ('.cfg', '.rc', '.ini', '.vdf') and path.name.casefold() not in ('mapcycle.txt', 'motd.txt', 'motd_text.txt', 'gameinfo.txt'):
            continue
        confined(root, path)
        if path.is_file(): result.append(path)
        elif path.is_symlink(): raise ValueError('Source configuration has a broken symbolic link')
    return sorted(result)


def restore_file(root, record):
    path = root / record['path']
    target = root / record['target']
    confined(root, path.parent); confined(root, target)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.voltra-restore-', dir=target.parent)
    try:
        with os.fdopen(fd, 'wb') as output, Path(record['backup']).open('rb') as source:
            shutil.copyfileobj(source, output)
            os.fchown(output.fileno(), record['uid'], record['gid'])
            os.fchmod(output.fileno(), record['mode'])
        os.replace(temporary, target)
        os.utime(target, ns=(record['atime_ns'], record['mtime_ns']))
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    if record['link'] is not None:
        with tempfile.TemporaryDirectory(prefix='.voltra-link-', dir=path.parent) as directory:
            link = Path(directory) / 'configuration'
            link.symlink_to(record['link'])
            os.lchown(link, record['link_uid'], record['link_gid'])
            os.replace(link, path)


def install_application(root, app_id, env, validate, required, platform):
    try:
        return steam_update(root, app_id, env=env, validate=validate, required=required, platform=platform)
    except SteamInstallError as initial:
        if app_id != 222860 or initial.app_id != app_id or initial.reason != 'invalid_platform': raise
        # Publisher-specific FreeToDownload platform bug, documented upstream:
        # https://github.com/ValveSoftware/steam-for-linux/issues/11522
        # https://github.com/GameServerManagers/LinuxGSM/commit/3bca8733303e2f949ea7b7c26943a19e707c2764
        # Exactly one Windows acquisition, followed by explicit Linux validation.
        # This is not a generic retry or an authentication substitute.
        directory = root / '.voltra/source/platform-corrections'
        confined(root, directory); directory.mkdir(parents=True, exist_ok=True)
        audit = directory / (uuid.uuid4().hex + '.json')
        report = {'appid': app_id, 'initial_reason': initial.reason, 'initial_status': initial.status, 'phase': 'windows_acquisition'}
        def save():
            fd, temporary = tempfile.mkstemp(prefix='.voltra-', dir=directory)
            try:
                with os.fdopen(fd, 'w', encoding='utf-8') as output: json.dump(report, output)
                os.replace(temporary, audit)
            finally:
                if os.path.exists(temporary): os.unlink(temporary)
        save()
        settings = dict(os.environ if env is None else env)
        try:
            print('L4D2 publisher platform correction: acquire Windows content once, then validate Linux content.', flush=True)
            steam_update(root, app_id, env={**settings, 'WINDOWS_INSTALL':'1'}, validate=False, required=(), platform='windows')
            report['phase'] = 'linux_validation'; save()
            result = steam_update(root, app_id, env={**settings, 'WINDOWS_INSTALL':'0'}, validate=True, required=required, platform='linux', force_platform=True)
            binary = root / 'srcds_linux'; confined(root, binary)
            with binary.open('rb') as source: header = source.read(6)
            if len(header) != 6 or header[:4] != b'\x7fELF' or header[4] not in (1,2) or header[5] != 1:
                raise ValueError('L4D2 platform correction did not produce a native Linux server')
            report['phase'] = 'complete'; report['final_platform'] = 'linux'; report['final_buildid'] = result['buildid']; report['elf_bits'] = 32 if header[4] == 1 else 64; save()
            return result
        except BaseException as error:
            report['failed'] = True; report['failure_type'] = type(error).__name__; save()
            raise


def update(root, app_id, env=None, validate=True, required=(), platform='linux'):
    root = Path(root).resolve()
    if app_id not in GAME_DIRECTORIES or platform not in ('linux','windows') or platform=='windows' and app_id!=293030:
        raise ValueError('Choose a reviewed Source application and target platform')
    selected = protected_files(root, GAME_DIRECTORIES[app_id])
    records = []
    if selected:
        state = root / '.voltra/source/steam-preservation' / uuid.uuid4().hex
        confined(root, state)
        state.mkdir(parents=True, mode=0o700)
        for path in selected:
            relative = str(path.relative_to(root))
            target = path.resolve()
            info, link_info = target.stat(), path.lstat()
            backup = state / hashlib.sha256(relative.encode('utf-8')).hexdigest()
            with path.open('rb') as source, backup.open('xb') as output:
                os.fchmod(output.fileno(), 0o600)
                shutil.copyfileobj(source, output)
            records.append({'path': relative, 'target': str(target.relative_to(root)), 'backup': str(backup),
                            'uid': info.st_uid, 'gid': info.st_gid, 'mode': info.st_mode & 0o7777,
                            'atime_ns': info.st_atime_ns, 'mtime_ns': info.st_mtime_ns,
                            'link': os.readlink(path) if path.is_symlink() else None,
                            'link_uid': link_info.st_uid, 'link_gid': link_info.st_gid})
        metadata = state / 'files.json'
        with metadata.open('x', encoding='utf-8') as output:
            os.fchmod(output.fileno(), 0o600)
            json.dump(records, output)
    try:
        return install_application(root, app_id, env, validate, required, platform)
    finally:
        # Restore even when Steam fails after replacing a publisher-tracked CFG.
        errors = []
        for record in records:
            try: restore_file(root, record)
            except Exception as error: errors.append(type(error).__name__)
        if errors: raise RuntimeError('Unable to restore protected Source configuration: ' + ', '.join(errors))
