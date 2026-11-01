#!/usr/bin/env python3
"""Stage lip updates without touching the operator installation. No publication."""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys


def validate(env, machine):
    if env.get('BEDROCK_TERMS_ACCEPTED') != 'true':
        raise ValueError('Explicit Minecraft EULA and Usage Guidelines consent required')
    if machine.lower() not in ('amd64', 'x86_64'):
        raise ValueError('LeviLamina win-x64 requires x64 Wine; native ARM64 unsupported')
    version = env.get('VERSION', '')
    if version not in ('', 'latest') and not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('VERSION must be blank, latest or exact x.y.z')
    for key, default in [('SERVERNAME', 'Bedrock Dedicated Server'), ('WORLDNAME', 'Bedrock level')]:
        value = env.get(key, default)
        if not value or len(value.encode()) > 256 or any(ord(c) < 32 for c in value):
            raise ValueError('Invalid ' + key)
        if key == 'WORLDNAME' and (value in ('.', '..') or any(c in value for c in '/\\:')):
            raise ValueError('WORLDNAME must be a single directory name')
    for key, choices, default in [('GAMEMODE', ('survival', 'creative', 'adventure'), 'survival'),
                                  ('DIFFICULTY', ('peaceful', 'easy', 'normal', 'hard'), 'easy')]:
        if env.get(key, default) not in choices:
            raise ValueError('Invalid ' + key)
    players = env.get('MAXPLAYERS', '10')
    if not re.fullmatch(r'[0-9]+', players) or not 1 <= int(players) <= 2147483647:
        raise ValueError('Invalid MAXPLAYERS')
    return 'github.com/LiteLDev/LeviLamina' + ('@' + version if version not in ('', 'latest') else '')


def checked_tree(root):
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Installation must be an existing real directory')
    for path in root.rglob('*'):
        if path.is_symlink() or (not path.is_file() and not path.is_dir()):
            raise ValueError('Refusing links or special files in staging input')


def protected(relative):
    # Preserve operator bytes, including loader JSON, arbitrary plugin configs,
    # worlds and secrets. Only package-managed executable/library data can change.
    return (relative.parts[0] in ('worlds', 'mods', 'behavior_packs', 'resource_packs')
            or relative.name in ('server.properties', 'allowlist.json', 'permissions.json', 'lip-install.txt')
            or relative.suffix.lower() in ('.json', '.jsonc', '.ini', '.cfg', '.toml', '.yaml', '.yml', '.properties')
            or (relative.parts[0] == 'plugins' and relative.parts[1:2] != ('LeviLamina',)))


def stage(root, destination, env, machine, lip_command):
    package = validate(env, machine)
    root = root.absolute()
    destination = destination.absolute()
    checked_tree(root)
    if destination.exists() or destination.is_symlink() or destination.resolve().is_relative_to(root.resolve()) or root.resolve().is_relative_to(destination.resolve()):
        raise ValueError('Stage must be a new directory outside the installation')
    # Operator package lists are not silently executed. They require a separate
    # reviewed package plan and are retained byte-for-byte.
    packages = root / 'lip-install.txt'
    if packages.exists() and any(line.strip() and not line.lstrip().startswith('#') for line in packages.read_text(encoding='utf-8-sig').splitlines()):
        raise ValueError('Additional lip-install.txt packages require a reviewed compatibility plan')
    shutil.copytree(root, destination)
    try:
        subprocess.run([*lip_command, 'install', package], cwd=destination, env=env, check=True)
        checked_tree(destination)
        for original in root.rglob('*'):
            relative = original.relative_to(root)
            if original.is_file() and protected(relative):
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(original, target)
        binary = destination / 'bedrock_server.exe'
        if not binary.is_file() or binary.stat().st_size < 2 or binary.read_bytes()[:2] != b'MZ':
            raise ValueError('lip did not stage Windows BDS; no ready/install-success claim')
        return {'package': package, 'stage': str(destination), 'published': False,
                'native_verified': False, 'operator_installation_unchanged': True}
    except BaseException:
        # Retain failed stage for diagnosis. The original never receives writes.
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    print(json.dumps(stage(args.root, args.destination, dict(os.environ), platform.machine(), ['lip'])))


if __name__ == '__main__':
    main()
