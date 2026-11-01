#!/usr/bin/env python3
"""Aloft-only validation before updater or Winetricks can mutate the volume."""
import importlib.util
import os
from pathlib import Path
import re
import sys


def load_runtime():
    folder = Path(__file__).resolve().parent
    candidate = folder / 'unreal_survival_next.py'
    if not candidate.exists() and not (folder / 'unreal-survival-next.py').exists():
        folder = folder.parents[1] / 'internal/panel/game_library/scripts'
        candidate = folder / 'unreal-survival-next.py'
    for name in ('steam-template', 'native-config', 'native-console', 'unreal-survival-next'):
        file = folder / (name.replace('-', '_') + '.py')
        if not file.exists():
            file = folder / (name + '.py')
        spec = importlib.util.spec_from_file_location(name.replace('-', '_'), file)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    return sys.modules['unreal_survival_next']


def preflight(runtime, root, environment):
    """Read only. Missing payloads remain repairable by the existing updater."""
    root = Path(root).resolve()
    info = runtime.metadata()['aloft']
    env = {**info['defaults'], **{k: v for k, v in environment.items() if k in info['defaults']}}
    runtime.checked(env)
    for key, kind in info['types'].items():
        if kind == 'boolean' and env[key] not in ('0', '1'):
            raise ValueError('Invalid original boolean ' + key)
        if kind == 'number' and not re.fullmatch(r'-?\d+(?:\.\d+)?', env[key]):
            raise ValueError('Invalid original numeric control ' + key)
    if env['SRCDS_APPID'] != str(info['app']) or env.get('WINDOWS_INSTALL', '1') != '1':
        raise ValueError('Aloft requires its original Windows application')
    for key, grammar in (('SAVE_NAME', r'[A-Za-z0-9]{1,20}'), ('SERVER_NAME', r'[A-Za-z0-9_-]{1,100}')):
        if not re.fullmatch(grammar, env[key]):
            raise ValueError('Invalid Aloft ' + key)
    if not re.fullmatch(r'\d+', env['MAX_PLAYERS']) or not 1 <= int(env['MAX_PLAYERS']) <= 8:
        raise ValueError('Aloft supports 1..8 players')
    if env['CREATIVE_MODE'] not in ('0', '1') or any(env[k] not in ('true', 'false') for k in ('IS_VISIBLE', 'PRIVATE_ISLANDS')):
        raise ValueError('Invalid Aloft boolean')
    if any(not re.fullmatch(r'\d{17}', value) for value in env['ADMIN_IDS'].split()):
        raise ValueError('Each administrator must be one SteamID64')
    ports = {int(value) for value in environment.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}
    primary = int(environment.get('SERVER_PORT', '0'))
    if not 1 <= primary <= 65535 or primary not in ports:
        raise ValueError('Choose an allocated primary port')
    runtime.path(root, info['binary'])
    runtime.path(root, '.wine')
    save = runtime.path(root, env['SAVE_PATH'])
    world = runtime.path(root, save.relative_to(root) / ('w_' + env['SAVE_NAME']))
    # SAVE_PATH is a detection hint, not a publisher launch argument. Never
    # redirect or migrate a world based on the newest directory name.
    local_low = runtime.path(root, '.wine/drive_c/users/container/AppData/LocalLow')
    bases = {save.parent.parent}
    if local_low.is_dir():
        for studio in local_low.iterdir():
            if studio.name.casefold() == 'astrolabe interactive':
                runtime.path(root, studio.relative_to(root))
                if studio.is_dir():
                    for game in studio.iterdir():
                        if game.name.casefold() == 'aloft':
                            bases.add(runtime.path(root, game.relative_to(root)))
    for base in bases:
        if not base.is_dir():
            continue
        for data in base.iterdir():
            if not re.fullmatch(r'data\d+', data.name, re.I):
                continue
            candidate = runtime.path(root, data.relative_to(root) / 'Saves' / ('w_' + env['SAVE_NAME']))
            if candidate.resolve() != world.resolve() and candidate.exists():
                raise ValueError('Aloft world exists outside SAVE_PATH; reconcile publisher build and save path before startup; no world was moved or created')
    if world.exists() and not world.is_dir():
        raise ValueError('Aloft world path must be a directory')
    if not world.is_dir():
        if env['WORLD_GENERATION_SYNTAX'] == 'legacy':
            if not re.fullmatch(r'\d+', env['NUM_ISLANDS']):
                raise ValueError('Invalid legacy island count')
        elif env['WORLD_GENERATION_SYNTAX'] == 'current':
            if env['ISLAND_PRESET'] not in ('0', '1', '2', 'normal', 'big', 'huge') or env['CORRUPTION_PRESET'] not in ('0', '1', '2', 'normal', 'lots', 'shrooms'):
                raise ValueError('Invalid current publisher world preset')
        else:
            raise ValueError('Unknown Aloft creation grammar')
    verbs = env['WINETRICKS_RUN'].split()
    if any(not re.fullmatch(r'[A-Za-z0-9_]+(?:=[A-Za-z0-9_]+)?', verb) for verb in verbs):
        raise ValueError('Winetricks supports literal verbs')
    stamp = runtime.path(root, '.voltra/aloft-winetricks.json')
    if stamp.exists() and not stamp.is_file():
        raise ValueError('Winetricks receipt must be a regular file')


def main(runtime=None):
    runtime = runtime or load_runtime()
    if sys.argv[1:3] != ['run', 'aloft']:
        raise ValueError('This runtime entrypoint is Aloft run only')
    preflight(runtime, Path.cwd(), dict(os.environ))
    return runtime.main()


if __name__ == '__main__':
    sys.exit(main())
