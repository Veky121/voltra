#!/usr/bin/env python3
"""ASA-only native file authority, using the reviewed shared ARK lifecycle."""
import re
import os
from pathlib import Path
import sys
import threading
from types import SimpleNamespace

# Installed beside the family helper; source checkout uses its original filename.
import importlib.util
path = Path(__file__).with_name('ark_family.py')
if not path.exists():
    path = path.with_name('ark-family.py')
spec = importlib.util.spec_from_file_location('asa_family', path)
ark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ark)
CONFIG = 'ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini'
FIELDS = {
    ('ServerSettings', 'ServerAdminPassword'): 'ARK_ADMIN_PASSWORD',
    ('ServerSettings', 'ServerPassword'): 'SERVER_PASSWORD',
    ('ServerSettings', 'ServerPVE'): 'SERVER_PVE',
    ('/Script/Engine.GameSession', 'MaxPlayers'): 'MAX_PLAYERS',
    ('SessionSettings', 'SessionName'): 'SESSION_NAME',
}


def effective(root, env):
    result = dict(env)
    # Original RCON control is admin-owned. Never silently pick another port.
    ark.integer(result, 'RCON_PORT', 0)
    path = ark.confined(root, CONFIG)
    if path.exists():
        section, seen = '', set()
        lookup = {(s.casefold(), k.casefold()): v for (s, k), v in FIELDS.items()}
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line)
            if header:
                section = header.group(1).casefold()
            elif not line.lstrip().startswith((';', '#')) and '=' in line:
                key, value = line.split('=', 1)
                identity = (section, key.strip().casefold())
                if identity in lookup:
                    if identity in seen:
                        raise ValueError('Duplicate managed ASA native setting')
                    seen.add(identity)
                    result[lookup[identity]] = value.strip()
    # Validate file-sourced values through exactly the same launch validators.
    plan = ark.build(root, 'ascended', result)
    if path.exists():
        ark.native.resolve_ini_identities(path.read_text(encoding='utf-8-sig'), plan['sections'])
    return result


def configure(root, env):
    # The loaded family module is private to this adapter. Bound the opt-in to
    # this synchronous configure call and restore even on validation failure.
    original = ark.native.patch_ini
    def patch(content, sections):
        return original(content, sections, case_insensitive=True)
    ark.native.patch_ini = patch
    try:
        return ark.configure(root, 'ascended', env)
    finally:
        ark.native.patch_ini = original


def run(root, plan, env):
    """Keep ASA readiness and exit classification local to this private module."""
    requested = threading.Event()
    original_signal, original_command = ark.signal, ark.command
    previous = {}

    def register(sig, handler):
        def stop(*args):
            requested.set()
            return handler(*args)
        if sig in previous:
            return original_signal.signal(sig, handler)
        previous[sig] = original_signal.signal(sig, stop)
        return previous[sig]

    def command(port, password, value, **kwargs):
        if value == 'ListPlayers' and not ark.native_pids(root, 'ascended'):
            raise ValueError('ASA readiness requires an owned native process')
        return original_command(port, password, value, **kwargs)

    ark.signal = SimpleNamespace(SIGINT=original_signal.SIGINT,
                                 SIGTERM=original_signal.SIGTERM, signal=register)
    ark.command = command
    try:
        code = ark.run(root, 'ascended', plan, env)
    finally:
        ark.signal, ark.command = original_signal, original_command
    if not requested.is_set():
        print('ASA unexpected native exit; raw lifecycle exit=' + str(code), file=sys.stderr)
        return code if code else 1
    return code


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('install', 'run'):
        raise ValueError('Expected install or run')
    root = Path.cwd().resolve()
    env = dict(os.environ)
    if sys.argv[1] == 'install':
        ark.integer(env, 'RCON_PORT', 0)
        ark.ports(env, 'ascended')
        ark.install(root, 'ascended', env)
        return 0
    env = effective(root, env)
    child_env = ark.environment(root, 'ascended', env)
    if ark.boolean(env, 'VOLTRA_STEAM_AUTO_UPDATE', True):
        ark.install(root, 'ascended', env)
    # Existing native values supply both launch argv and INI; ports remain allocation-owned.
    return run(root, configure(root, env), child_env)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        # Never print file values or parser errors containing passwords.
        print('ASA operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
