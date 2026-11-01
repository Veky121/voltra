"""Neos operator-payload adapter. No acquisition and no settings rewrite."""
import json
import os
from pathlib import Path
import platform
import shutil
import sys
from native_console import run


def path(root, name):
    target = root / name
    if not target.resolve().is_relative_to(root) or any(p.is_symlink() for p in (target, *target.parents) if p.is_relative_to(root)):
        raise ValueError('Operator path traverses a symlink')
    return target


def boolean(value):
    if value not in ('true', 'false', '1', '0'):
        raise ValueError('Invalid boolean')
    return value in ('true', '1')


def integer(value):
    if isinstance(value, bool) or not str(value).isascii() or not str(value).isdigit() or not 1 <= int(value) <= 65535:
        raise ValueError('Invalid allocated port')
    return int(value)


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError('Duplicate config key')
        result[key] = value
    return result


def secrets(value):
    result = []
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, str) and item and any(x in key.lower() for x in ('password', 'token', 'secret', 'credential')):
                result.append(item)
            result.extend(secrets(item))
    elif isinstance(value, list):
        for item in value:
            result.extend(secrets(item))
    return result


def plan(root, env):
    root = root.resolve()
    if boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'))):
        raise ValueError('Private acquisition/update transport unavailable; retain operator payload and select AUTO_UPDATE=0')
    if env.get('SRCDS_APPID', '740250') != '740250' or env.get('SRCDS_BETAID', 'headless-client') != 'headless-client':
        raise ValueError('Wrong Neos app/branch')
    if platform.system() != 'Linux' or platform.machine().lower() not in ('x86_64', 'amd64'):
        raise ValueError('Requires Linux amd64; ARM64 native support and emulation are unverified')
    mono = shutil.which('mono')
    if not mono or not path(root, 'Neos.exe').is_file():
        raise ValueError('Operator-provided Neos.exe and Mono required')
    primary = integer(env.get('SERVER_PORT', ''))
    allocated = {integer(x) for x in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if x}
    if primary not in allocated:
        raise ValueError('Primary port not allocated')
    config = path(root, 'Config/Config.json')
    logs = path(root, 'Logs')
    if logs.exists() and not logs.is_dir():
        raise ValueError('Logs must be a directory')
    if not config.is_file() or config.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('Existing authoritative Config/Config.json required; no schema defaults available')
    value = json.loads(config.read_bytes().decode('utf-8-sig'), object_pairs_hook=pairs,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
    if not isinstance(value, dict) or not isinstance(value.get('startWorlds'), list) or len(value['startWorlds']) > 256:
        raise ValueError('Invalid startWorlds')
    for world in value['startWorlds']:
        if not isinstance(world, dict):
            raise ValueError('Invalid world')
        if world.get('forcePort') is None:
            raise ValueError('World port authority is ambiguous')
        if integer(world['forcePort']) not in allocated:
            raise ValueError('World port not allocated')
    for key in ('dataFolder', 'cacheFolder', 'logsFolder'):
        if value.get(key):
            candidate = Path(value[key])
            if '..' in candidate.parts or (candidate.is_absolute() and not candidate.is_relative_to(root)):
                raise ValueError('Data folder outside volume')
            path(root, candidate)
    argv = [mono, str(path(root, 'Neos.exe')), '-c', str(config), '-l', str(logs)]
    if boolean(env.get('ENABLE_MODLOADER', 'false')):
        # Never replace an operator-selected loader or fetch code on startup.
        for name in ('NeosModLoaderHeadless.dll', 'nml_libs/0Harmony.dll'):
            if not path(root, name).is_file():
                raise ValueError('Operator mod loader and Harmony prerequisite missing')
        argv += ['-LoadAssembly', str(path(root, 'NeosModLoaderHeadless.dll'))]
    clean = {k: v for k, v in env.items() if not k.startswith(('STEAM_', 'NSS_WRAPPER_')) and k not in ('SRCDS_BETAPASS', 'PYTHONPATH', 'PYTHONHOME', 'LD_PRELOAD')}
    clean['HOME'] = str(root)
    return config, value, argv, clean, secrets(value)


def launch(root, env):
    config, value, argv, clean, credentials = plan(root, env)
    # Shared supervisor preserves raw exit status and redacts native output.
    return run(root, argv, clean, 'shutdown', credentials=credentials,
               ready_marker=b'World running...', terminal_input=True)


if __name__ == '__main__':
    try:
        sys.exit(launch(Path.cwd(), dict(os.environ)))
    except Exception:
        print('Neos preflight/startup failed; check operator payload, Linux amd64 Mono, allocations and configuration. No acquisition attempted.', file=sys.stderr)
        sys.exit(1)
