#!/usr/bin/env python3
"""MIT. Soldat classic native-file authority around the existing publisher adapter."""
import importlib.util
import os
from pathlib import Path
import re
import sys


def load_base():
    target = Path(__file__).with_name('soldat-native.py')
    spec = importlib.util.spec_from_file_location('soldat_native_classic_base', target)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = load_base()
KEYS = ('Port', 'Max_Players', 'Game_Password', 'Admin_Password', 'Server_Name', 'Lobby_Register')


def safe_path(root, relative, directory=False):
    path = root / relative
    current = root
    for part in Path(relative).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('Linked Soldat managed path')
    if not path.resolve().is_relative_to(root):
        raise ValueError('Soldat path leaves volume')
    if path.exists() and (not path.is_dir() if directory else not path.is_file()):
        raise ValueError('Unexpected Soldat managed path type')
    return path


def known_values(content):
    # Shared identity resolution rejects duplicate managed section/key aliases.
    base.native.resolve_ini_identities(content, {'NETWORK': {key: '' for key in KEYS}})
    section, values = '', {}
    for line in content.splitlines():
        header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line.strip())
        if header:
            section = header.group(1).casefold()
        elif section == 'network' and not line.lstrip().startswith((';', '#')) and '=' in line:
            key, value = line.split('=', 1)
            if key.strip().casefold() in {k.casefold() for k in KEYS}:
                values[key.strip().casefold()] = value.strip()
    return values


def plan(root, env, require_ports=True, seed_existing=False):
    root = Path(root).resolve()
    if env.get('SRCDS_APPID', '638500') != '638500':
        raise ValueError('Soldat requires Steam638500')
    port = base.number(env, 'SERVER_PORT', 23073, 1, 65525)
    raw = env.get('VOLTRA_ALLOCATED_PORTS', '')
    if not raw and not require_ports:
        raw = str(port) + ',' + str(port + 10)
    if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*', raw):
        raise ValueError('Missing Soldat port allocations')
    ports = {int(p) for p in raw.split(',')}
    if not {port, port + 10}.issubset(ports) or any(not 1 <= p <= 65535 for p in ports):
        raise ValueError('Soldat requires game/admin and primary+10 allocations')
    for relative in ('.voltra', '.voltra/soldat', '.voltra/soldat/config-backups'):
        safe_path(root, relative, directory=True)
    credential = safe_path(root, '.voltra/soldat/admin-password')
    config = safe_path(root, 'soldat.ini')
    content = config.read_bytes().decode('utf-8') if config.exists() else ''
    existing = known_values(content)
    defaults = {
        'Port': str(port),
        'Max_Players': str(base.number(env, 'MAX_PLAYERS', 10, 1, 20)),
        'Game_Password': base.text(env, 'SRV_PWD', '', 20),
        'Admin_Password': base.text(env, 'ADMIN_PASSWD', '', 20),
        'Server_Name': base.text(env, 'SRV_NAME', 'MySoldatServer', 100),
        'Lobby_Register': str(base.number(env, 'PUBLIC_SERVER', 0, 0, 1)),
    }
    if defaults['Admin_Password'] and not defaults['Admin_Password'].strip():
        raise ValueError('Whitespace-only Soldat administrator credential')
    for key, value in ({} if seed_existing else existing).items():
        if key in ('port', 'max_players', 'lobby_register'):
            low, high = {'port': (1, 65535), 'max_players': (1, 20), 'lobby_register': (0, 1)}[key]
            base.number({key: value}, key, 0, low, high)
        else:
            base.text({key: value}, key, '', 100 if key == 'server_name' else 20)
            if key == 'admin_password' and not value:
                raise ValueError('Soldat requires a nonempty native administrator password')
    # Validate retained private fallback before any writes or acquisition, too.
    if credential.exists():
        stored = credential.read_text(encoding='utf-8').strip()
        base.text({'stored': stored}, 'stored', '', 20)
        if not stored and not defaults['Admin_Password'] and (seed_existing or 'admin_password' not in existing):
            raise ValueError('Empty Soldat persistent administrator credential')
    sections = {'NETWORK': {key: value for key, value in defaults.items()
                             if seed_existing or key == 'Port' or key.casefold() not in existing}}
    # Plan the shared byte-preserving patch before generating a missing secret.
    base.native.patch_ini(content, sections, case_insensitive=True)
    return root, config, credential, content, existing, sections


def configure(root, env, seed_existing=False, require_ports=True):
    root, config, credential, content, existing, sections = plan(root, env, require_ports=require_ports, seed_existing=seed_existing)
    if (seed_existing or 'admin_password' not in existing) and not sections['NETWORK']['Admin_Password']:
        sections['NETWORK']['Admin_Password'] = base.credential(root, 'soldat', '')
    updated = base.native.patch_ini(content, sections, case_insensitive=True)
    if updated != content:
        previous = config.stat() if config.exists() else None
        if previous:
            import time
            backup = root / '.voltra/soldat/config-backups' / (str(time.time_ns()) + '-soldat.ini')
            base.native.private_write(backup, content)
        base.native.private_write(config, updated)
        if previous:
            os.chown(config, previous.st_uid, previous.st_gid)
            config.chmod(previous.st_mode & 0o7777)
    return [str(root / 'soldatserver')]


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('install', 'run'):
        raise ValueError('Use install or run')
    root, env = Path.cwd(), dict(os.environ)
    if sys.argv[1] == 'install':
        planned = plan(root, env, require_ports=False)
        first_config = not planned[1].exists()
        base.install_soldat(root, env)
        # Only an absent pre-install config permits creation controls to seed
        # the fresh publisher sample. Reinstalls never reset operator values.
        if first_config:
            configure(root, env, seed_existing=True, require_ports=False)
        return 0
    argv = configure(root, env)
    # Preserve the native Soldat signal and raw status path, without a shell.
    os.execv(argv[0], argv)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, UnicodeError):
        print('Soldat native setup refused invalid configuration, paths or allocated ports.', file=sys.stderr)
        sys.exit(1)
