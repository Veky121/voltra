#!/usr/bin/env python3
"""Moria-only preflight and seed-once native configuration authority."""
import importlib.util
import os
from pathlib import Path
import re
import stat
import sys


def load(name, filename):
    path = Path(__file__).with_name(filename)
    if not path.exists():
        path = path.with_name(filename.replace('-', '_'))
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


load('steam_template', 'steam-template.py')
load('additional_survival_install', 'additional-survival-install.py')
game = load('moria_shared_adapter', 'fantasy-survival-servers.py')
original_install = game.install


def regular(root, name):
    path = root / name
    for part in (path, *path.parents):
        if part == root:
            break
        if part.is_symlink():
            raise ValueError('Moria operator paths must not contain symbolic links')
    game.confined(root, name)
    if path.exists() and not stat.S_ISREG(path.stat().st_mode):
        raise ValueError('Moria configuration must be a regular file')
    if path.exists() and path.stat().st_size > 8 * 1024**2:
        raise ValueError('Moria configuration exceeds 8MiB')
    return path


def plan(root, env):
    """Pure preflight: no directories, downloads, prefix preparation or writes."""
    port = game.primary(env)
    difficulty = env.get('DIFFICULTY', 'normal')
    if difficulty not in ('story', 'solo', 'normal', 'hard', 'custom'):
        raise ValueError('Invalid Moria difficulty')
    desired = {'Host': {'ListenPort': port},
               'Main': {'OptionalPassword': game.text(env.get('SERVER_PASSWORD', ''), 20)},
               'World': {'Name': '"' + game.text(env.get('WORLD_NAME', 'A Pterodactyl Server'), 80, True) + '"'},
               'World.Create': {'Difficulty.Preset': difficulty},
               'Console': {'Enabled': 'false'}}
    path = regular(root, 'MoriaServerConfig.ini')
    before = path.read_bytes() if path.exists() else b''
    content = before.decode('utf-8-sig')
    if '\x00' in content:
        raise ValueError('Invalid Moria configuration encoding')
    # Native INI identities are treated conservatively: never guess which duplicate wins.
    resolved = game.config.resolve_ini_identities(content, desired)
    existing, section = {}, None
    for line in content.splitlines():
        header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line)
        if header:
            section = header[1].casefold()
        elif line.lstrip().startswith('['):
            raise ValueError('Malformed Moria INI section')
        elif section and '=' in line and not line.lstrip().startswith((';', '#')):
            key, value = line.split('=', 1)
            existing[(section, key.strip().casefold())] = value.strip()
    changes = {}
    for section, keys in resolved.items():
        for key, value in keys.items():
            current = existing.get((section.casefold(), key.casefold()))
            # Only the allocation-owned listen port is reapplied on later starts.
            if current is None or (section.casefold(), key.casefold()) == ('host', 'listenport') and current != port:
                changes.setdefault(section, {})[key] = value
    after = game.config.patch_ini(content, changes).encode('utf-8') if changes else before
    if changes and before.startswith(b'\xef\xbb\xbf'):
        after = b'\xef\xbb\xbf' + after
    return path, before, after


def preflight(root, env):
    root = Path(root).resolve()
    plan(root, env)
    if env.get('SRCDS_APPID', '3349480') != '3349480' or env.get('WINDOWS_INSTALL', '1') != '1':
        raise ValueError('Moria requires the original Windows dedicated application 3349480')
    if env.get('ACCEPT_WINDOWS_RUNTIME_LICENSES', 'false') != 'true':
        raise ValueError('Explicit Microsoft runtime licence acknowledgement required before acquisition')
    if env.get('WINEARCH', 'win64') != 'win64':
        raise ValueError('Moria requires a private win64 prefix')
    if env.get('VOLTRA_WINETRICKS_RUN', env.get('WINETRICKS_RUN', 'vcrun2022')).split() != ['vcrun2022']:
        raise ValueError('Moria permits only the original vcrun2022 prerequisite')
    prefix = Path(env.get('WINEPREFIX', str(root / '.wine')))
    if not prefix.is_absolute() or not prefix.resolve().is_relative_to(root):
        raise ValueError('Moria Wine prefix must stay inside its server volume')
    registry = regular(root, str(prefix.relative_to(root) / 'system.reg'))
    if registry.exists() and '#arch=win32' in registry.read_text(errors='replace')[:1024]:
        raise ValueError('Existing win32 prefix preserved; win64 required')
    game.arguments(root, 3349480, env, True, platform='windows')
    return root


def configure(root, selected, env):
    if selected != 'moria':
        raise ValueError('Moria wrapper cannot configure another game')
    path, before, after = plan(Path(root).resolve(), env)
    if after != before:
        game.private_bytes(path, after, path.stat() if path.exists() else None)


def install(root, selected, env):
    if selected != 'moria':
        raise ValueError('Moria wrapper cannot install another game')
    return original_install(preflight(root, env), selected, env)


game.configure = configure
game.install = install


def launch(root, env):
    root = preflight(root, env)
    path, _, _ = plan(root, env)
    password, section = '', ''
    if path.exists():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line)
            if header:
                section = header[1].casefold()
            elif section == 'main' and '=' in line and not line.lstrip().startswith((';', '#')):
                key, value = line.split('=', 1)
                if key.strip().casefold() == 'optionalpassword':
                    password = value.strip().strip('"')
    # A native-file password may differ from the old creation environment.
    # Include both in both output paths without passing the secret as an argv value.
    run, tail = game.console.run, game.tail_log
    def redacted_run(*args, credentials=(), **kwargs):
        return run(*args, credentials=(*credentials, password), **kwargs)
    def redacted_tail(path, finish, credentials):
        return tail(path, finish, (*credentials, password))
    game.console.run, game.tail_log = redacted_run, redacted_tail
    try:
        return game.launch(root, 'moria', env)
    finally:
        game.console.run, game.tail_log = run, tail

if __name__ == '__main__':
    action = sys.argv[1]
    env = dict(os.environ)
    root = preflight(Path.cwd(), env)
    if action == 'install':
        install(root, 'moria', env)
    elif action == 'run':
        sys.exit(launch(root, env))
    else:
        raise ValueError('Unknown Moria operation')
