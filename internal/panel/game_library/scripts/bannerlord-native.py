#!/usr/bin/env python3
"""Bannerlord-only read-only prerequisite gate around the shared melee runtime."""
import importlib.util
import os
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('bannerlord_melee', Path(__file__).with_name('melee-native.py'))
melee = importlib.util.module_from_spec(spec)
spec.loader.exec_module(melee)


def xml_file(root, path):
    path = melee.confined(root, path)
    if not path.is_file() or path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('Missing or oversized Bannerlord module metadata')
    data = path.read_bytes()
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('Bannerlord module metadata declarations are unsupported')
    try:
        return ET.fromstring(data)
    except ET.ParseError:
        raise ValueError('Malformed Bannerlord module metadata') from None


def preflight(root, env, require_binary=True):
    root = Path(root).resolve()
    # Shared validation is read-only for this recipe, including token, platform,
    # literal config filename and ordered module syntax.
    result = melee.configure(root, 'bannerlord', env)
    config = melee.confined(root, root / 'Modules/Native' / env.get('SERVER_CONFIG', 'tdm_config.txt'))
    if config.stat().st_size > 1024 * 1024:
        raise ValueError('Bannerlord config exceeds 1 MiB')
    try:
        text = config.read_bytes().decode('utf-8-sig')
    except UnicodeError:
        raise ValueError('Bannerlord config must be UTF-8; original bytes retained') from None
    if '\x00' in text:
        raise ValueError('Bannerlord config contains NUL')
    modules = env.get('SERVER_MODULES', 'Native,Multiplayer').split(',')
    for index, name in enumerate(modules):
        metadata = xml_file(root, root / 'Modules' / name / 'SubModule.xml')
        identity = metadata.find('Id')
        if identity is None or identity.get('value') != name:
            raise ValueError('Bannerlord module ID does not match selected folder')
        for dependency in metadata.findall('./DependedModules/DependedModule'):
            if dependency.get('Optional', 'false').lower() == 'true':
                continue
            if dependency.get('Id') not in modules[:index]:
                raise ValueError('Bannerlord required module dependency is missing or out of order')
    for line in text.splitlines():
        parts = line.strip().split()
        if not parts or parts[0].startswith(('#', '//')):
            continue
        if parts[0].lower() in ('map', 'add_map_to_automated_battle_pool', 'add_map_to_usable_maps'):
            if len(parts) < 2 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', parts[1]) or parts[1] in ('.', '..'):
                raise ValueError('Invalid Bannerlord scene reference')
            scenes = [melee.confined(root, root / 'Modules' / module / 'SceneObj' / parts[1]) for module in modules]
            if not any(path.is_dir() for path in scenes):
                raise ValueError('Bannerlord configured scene is missing from selected modules')
    if require_binary and not melee.confined(root, root / melee.GAMES['bannerlord'][2]).is_file():
        raise ValueError('Bannerlord dedicated executable is missing')
    return result


def install(root, env, validate=True):
    preflight(root, env, require_binary=False)
    return melee.install(root, 'bannerlord', env, validate=validate)


def run(root, env):
    preflight(root, env)
    if env.get('VOLTRA_STEAM_AUTO_UPDATE', '0') == '1':
        install(root, env, validate=env.get('VALIDATE', '0') == '1')
    preflight(root, env)
    return melee.run(root, 'bannerlord', {**env, 'VOLTRA_STEAM_AUTO_UPDATE': '0'})


if __name__ == '__main__':
    try:
        mode = sys.argv[1]
        if mode not in ('install', 'run'):
            raise ValueError('Expected install or run')
        if mode == 'install':
            install(Path.cwd(), dict(os.environ))
        else:
            sys.exit(run(Path.cwd(), dict(os.environ)))
    except Exception:
        # Never expose parser exceptions, config lines, paths or native tokens.
        print('Bannerlord prerequisite or runtime failure; operator files retained. Verify token, selected modules, config and runtime.', file=sys.stderr)
        sys.exit(1)
