#!/usr/bin/env python3
"""MIT. Reviewed Unreal dedicated installs with operator-file retention."""
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import shutil
import re
import ipaddress
from steam_template import update, _publish, arguments


def metadata():
    name='unreal_survival_release.json' if '_' in Path(__file__).name else 'unreal-survival-release.json'
    return json.loads(Path(__file__).with_name(name).read_text())


def confined(root, name):
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError('Unreal server path leaves its volume')
    return path


def front_preflight(root, environment, info=None):
    """Read-only validation; no native document authority is inferred here."""
    root = Path(root).resolve()
    info = metadata()['front'] if info is None else info
    env = {**info['defaults'], **environment}
    for key in set(info['defaults']) | {'SERVER_PORT', 'SERVER_IP', 'VOLTRA_ALLOCATED_PORTS'}:
        value = env.get(key, '0.0.0.0' if key == 'SERVER_IP' else '')
        if not isinstance(value, str) or len(value.encode()) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('Invalid Front setting')
    ports = [int(env[key]) for key in ['SERVER_PORT', *info['ports']]]
    allocated = {int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if p}
    if len(set(ports)) != len(ports) or any(not 1 <= p <= 65535 or p not in allocated for p in ports):
        raise ValueError('Choose distinct allocated native service ports')
    for key, kind in info['types'].items():
        if kind == 'boolean' and env[key] not in ('0', '1', 'true', 'false'):
            raise ValueError('Invalid native boolean ' + key)
        if kind == 'number' and not re.fullmatch(r'-?\d+(?:\.\d+)?', env[key]):
            raise ValueError('Invalid native number ' + key)
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,20}', env['CFG_NAME']):
        raise ValueError('Config name must be a single save-directory name')
    ipaddress.ip_address(env.get('SERVER_IP', '0.0.0.0'))
    if env['SRCDS_APPID'] != str(info['app']):
        raise ValueError('Dedicated application ID differs from reviewed recipe')
    if env['WINDOWS_INSTALL'] not in ('0', '1'):
        raise ValueError('Choose an explicit Front platform')
    if env.get('VOLTRA_STEAM_AUTO_UPDATE', env['AUTO_UPDATE']) not in ('0', '1', 'true', 'false'):
        raise ValueError('Invalid Front auto-update setting')
    platform = 'windows' if env['WINDOWS_INSTALL'] == '1' else 'linux'
    for app in (1007, info['app']):
        arguments(root, app, env, platform=platform, force_platform=True)
    # Inspect every retained object before opening a spool or acquiring payloads.
    paths = [root / name for name in info['binaries']]
    paths += [root / 'TheFrontManager' / env['CFG_NAME'], root / '.steam/steam',
              root / ('.steam/steam/steamapps/compatdata/' + str(info['app'])), root / '.voltra', root / '.voltra/steamcmd/steamcmd.sh', root / '.steam/sdk64/steamclient.so']
    for pattern in info['preserve']:
        base = root / pattern
        paths.append(base)
        if base.is_dir() and not base.is_symlink():
            paths.extend(base.rglob('*'))
    for path in paths:
        for part in (path, *path.parents):
            if part == root: break
            if part.is_symlink(): raise ValueError('Front paths must not contain symlinks')
            if part != path and part.exists() and not part.is_dir():
                raise ValueError('Front path parent must be a directory')
        confined(root, path.relative_to(root))
        if path.exists() and not (path.is_file() or path.is_dir()):
            raise ValueError('Nonregular Front path')
    candidates = [name for name in info['binaries'] if name.endswith('.exe') == (platform == 'windows') and (root / name).is_file()]
    if len(candidates) > 1:
        raise ValueError('Ambiguous Front native server layout')
    if any(arg.startswith('-ServerPassword=') for arg in info['fixed_args']):
        raise ValueError('Expected exactly one managed Front password argument')
    return env


def abiotic_preflight(root, environment, info=None):
    """Read-only admission without binary discovery or native CONFIG authority."""
    root = Path(root).resolve()
    info = metadata()['abiotic'] if info is None else info
    env = {**info['defaults'], **environment}
    for key in set(info['defaults']) | {'SERVER_PORT', 'VOLTRA_ALLOCATED_PORTS'}:
        value = env.get(key, '')
        if not isinstance(value, str) or len(value.encode()) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('Invalid Abiotic setting')
    ports = [int(env[key]) for key in ['SERVER_PORT', *info['ports']]]
    allocated = {int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if p}
    if len(set(ports)) != len(ports) or any(not 1 <= p <= 65535 or p not in allocated for p in ports):
        raise ValueError('Choose distinct allocated native service ports')
    for key, kind in info['types'].items():
        if kind == 'boolean' and env[key] not in ('0', '1', 'true', 'false'):
            raise ValueError('Invalid native boolean ' + key)
        if kind == 'number' and not re.fullmatch(r'-?\d+(?:\.\d+)?', env[key]):
            raise ValueError('Invalid native number ' + key)
    if env['SRCDS_APPID'] != str(info['app']):
        raise ValueError('Dedicated application ID differs from reviewed recipe')
    paths = [root / name for name in info['binaries']]
    paths += [root / '.voltra', root / '.voltra/steamcmd/steamcmd.sh', root / '.steam/sdk64/steamclient.so',
              root / '.steam/steam', root / ('.steam/steam/steamapps/compatdata/' + str(info['app'])),
              root / '.voltra/proton', root / '.voltra/proton/release.json', root / '.voltra/proton/lib',
              root / '.voltra/proton/lib/libvulkan.so.1', root / '.voltra/public-cache']
    for name in info['preserve']:
        base = root / name
        paths.append(base)
        if base.is_dir() and not base.is_symlink():
            paths.extend(base.rglob('*'))
    for path in paths:
        for part in (path, *path.parents):
            if part == root: break
            if part.is_symlink(): raise ValueError('Abiotic paths must not contain symlinks')
            if part != path and part.exists() and not part.is_dir():
                raise ValueError('Abiotic path parent must be a directory')
        confined(root, path.relative_to(root))
        if path.exists() and not (path.is_file() or path.is_dir()):
            raise ValueError('Nonregular Abiotic path')
    return env


def install(root, game, env=None):
    root = Path(root).resolve()
    info = metadata()[game]
    env = dict(os.environ if env is None else env)
    if env.get('SRCDS_APPID', str(info['app'])) != str(info['app']):
        raise ValueError('Dedicated application ID differs from reviewed recipe')
    if game == 'front':env = front_preflight(root, env, info)
    if game == 'abiotic':env = abiotic_preflight(root, env, info)
    # Preserve all operator settings, saves, mods and private prefix state,
    # including files absent from older publisher manifests.
    protected = {}
    spool = tempfile.TemporaryDirectory(prefix='.unreal-retention-',dir=root)
    try:
        for pattern in info['preserve']:
            for path in root.glob(pattern):
                candidates = path.rglob('*') if path.is_dir() else [path]
                for candidate in candidates:
                    confined(root, candidate.relative_to(root))
                    if candidate.is_file():
                        value = candidate.stat()
                        if not stat.S_ISREG(value.st_mode):raise ValueError('Nonregular retained file')
                        name=str(candidate.relative_to(root))
                        if name not in protected:
                            backup=Path(spool.name)/str(len(protected))
                            shutil.copyfile(candidate,backup)
                            protected[name] = (backup, value)
    except BaseException:
        spool.cleanup()
        raise
    try:
        platform = 'windows' if game=='front' and env.get('WINDOWS_INSTALL','0')=='1' else info['platform']
        if game=='front':update(root,1007,env=env,platform=platform,force_platform=True)
        result = update(root, info['app'], env=env, platform=platform, force_platform=True)
        if not any(path.endswith('.exe')==(platform=='windows') and confined(root, path).is_file() for path in info['binaries']):
            raise ValueError('Publisher installation lacks a reviewed dedicated binary')
        for path in info['binaries']:
            binary = confined(root, path)
            if binary.is_file() and info['platform']=='linux':binary.chmod(binary.stat().st_mode | 0o100)
        if game == 'abiotic' or platform=='windows':
            from enshrouded_proton import provision
            provision(root)
        return result
    finally:
        for name, (backup, saved) in protected.items():
            confined(root, name)
            def restore(output, backup=backup):
                with backup.open('rb') as source:shutil.copyfileobj(source,output)
            _publish(root, name, restore, stat.S_IMODE(saved.st_mode))
            target = root / name
            if os.geteuid()==0:os.chown(target, saved.st_uid, saved.st_gid)
            target.chmod(stat.S_IMODE(saved.st_mode))
        spool.cleanup()


if __name__ == '__main__':install(Path.cwd(), sys.argv[1])
