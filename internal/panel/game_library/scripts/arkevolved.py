#!/usr/bin/env python3
"""ASE-only defaults. Shared ARK transport and lifecycle remain authoritative."""
import importlib.util
import os
from pathlib import Path
import re
import sys


def load():
    path = Path(__file__).with_name('ark_family.py')
    if not path.exists():
        path = path.with_name('ark-family.py')
    spec = importlib.util.spec_from_file_location('ark_evolved_shared', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ark = load()
DEFAULTS = {
    'GameUserSettings.ini': {'ServerSettings': {
        'ServerPVE': 'False', 'DifficultyOffset': '1.0',
        'XPMultiplier': '1.0', 'TamingSpeedMultiplier': '1.0',
        'HarvestAmountMultiplier': '1.0'}},
    'Game.ini': {'/Script/ShooterGame.ShooterGameMode': {
        'bUseSingleplayerSettings': 'False'}},
}


CONFIG = 'ShooterGame/Saved/Config/LinuxServer/GameUserSettings.ini'
FIELDS = {
    ('ServerSettings', 'ServerAdminPassword'): 'ARK_ADMIN_PASSWORD',
    ('ServerSettings', 'ServerPassword'): 'ARK_PASSWORD',
    ('SessionSettings', 'SessionName'): 'SESSION_NAME',
}


def effective(root, env):
    result = dict(env)
    path = ark.confined(root, CONFIG)
    content = path.read_text(encoding='utf-8-sig') if path.exists() else ''
    section = ''
    lookup = {(s.casefold(), k.casefold()): v for (s, k), v in FIELDS.items()}
    seen = set()
    for line in content.splitlines():
        header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line)
        if header:
            section = header.group(1).casefold()
        elif not line.lstrip().startswith((';', '#')) and '=' in line:
            key, value = line.split('=', 1)
            identity = (section, key.strip().casefold())
            if identity in lookup:
                if identity in seen:
                    raise ValueError('Ambiguous ASE native identity')
                seen.add(identity)
                result[lookup[identity]] = value.strip()
    plan = ark.build(root, 'evolved', result)
    # Include every shared managed key, not only file-authoritative identities.
    ark.native.resolve_ini_identities(content, plan['sections'])
    # Validate both seed documents before install/build/config can publish anything.
    for filename, sections in DEFAULTS.items():
        target = ark.confined(root, 'ShooterGame/Saved/Config/LinuxServer/' + filename)
        previous = target.read_text(encoding='utf-8-sig') if target.exists() else ''
        ark.native.resolve_ini_identities(previous, sections)
    return result


def configure(root, env):
    plan = ark.build(root, 'evolved', effective(root, env))
    path = ark.confined(root, plan['config'])
    previous = path.read_bytes() if path.exists() else b''
    content = previous.decode('utf-8-sig')
    updated = ark.native.patch_ini(content, plan['sections'], case_insensitive=True)
    # Native operator bytes outside managed rows retain their newline and BOM.
    if previous.startswith(b'\xef\xbb\xbf'):
        updated = '\ufeff' + updated
    if updated.encode('utf-8') != previous:
        if previous:
            backup = ark.confined(root, '.voltra/arkevolved/config-backups/' + str(ark.time.time_ns()) + '-GameUserSettings.ini')
            backup.parent.mkdir(parents=True, exist_ok=True)
            backup.write_bytes(previous)
            backup.chmod(0o600)
        ark.native.private_write(path, updated)
    else:
        path.chmod(0o600)
    return plan


def seed(content, sections):
    """Append only absent keys; keep repeated operator rows and sections verbatim."""
    present, section = set(), None
    for line in content.splitlines():
        header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line)
        if header:
            section = header.group(1).casefold()
        elif not line.lstrip().startswith((';', '#')) and '=' in line:
            present.add((section, line.split('=', 1)[0].strip().casefold()))
    newline = '\r\n' if '\r\n' in content else '\n'
    for section, values in sections.items():
        missing = [(k, v) for k, v in values.items() if (section.casefold(), k.casefold()) not in present]
        if missing:
            if content and not content.endswith(('\r', '\n')):
                content += newline
            additions = ''.join(k + '=' + v + newline for k, v in missing)
            header = re.search(r'^\s*\[' + re.escape(section) + r'\][^\r\n]*(?:\r?\n|$)', content, re.M | re.I)
            if header:
                content = content[:header.end()] + additions + content[header.end():]
            else:
                content += '[' + section + ']' + newline + additions
    return content


def seed_files(root):
    for filename, sections in DEFAULTS.items():
        path = ark.confined(root, 'ShooterGame/Saved/Config/LinuxServer/' + filename)
        previous = path.read_bytes() if path.exists() else b''
        text = previous.decode('utf-8-sig')
        updated = seed(text, sections)
        if updated != text:
            if previous:
                backup = ark.confined(root, '.voltra/arkevolved/config-backups/' + str(ark.time.time_ns()) + '-' + filename)
                backup.parent.mkdir(parents=True, exist_ok=True)
                backup.write_bytes(previous)
                backup.chmod(0o600)
            ark.native.private_write(path, ('\ufeff' if previous.startswith(b'\xef\xbb\xbf') else '') + updated)


def main():
    if sys.argv[1:] not in (['install'], ['run']):
        raise ValueError('Expected ASE install or run')
    root, env = Path.cwd().resolve(), dict(os.environ)
    toggle = 'VOLTRA_STEAM_AUTO_UPDATE' if 'VOLTRA_STEAM_AUTO_UPDATE' in env else 'AUTO_UPDATE'
    automatic_update = ark.boolean(env, toggle, True)
    # Fail before acquisition if Saved contains foreign links, including worlds.
    saved = ark.confined(root, 'ShooterGame/Saved')
    if saved.exists():
        for path in saved.rglob('*'):
            ark.confined(root, path.relative_to(root))
    env = effective(root, env)
    if sys.argv[1] == 'install':
        ark.install(root, 'evolved', env)
        return 0
    ark.build(root, 'evolved', env)
    child_env = ark.environment(root, 'evolved', env)
    if automatic_update and env.get('SRCDS_APPID', '376030'):
        ark.install(root, 'evolved', env)
    plan = configure(root, env)
    seed_files(root)
    return ark.run(root, 'evolved', plan, child_env)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'ASE operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
