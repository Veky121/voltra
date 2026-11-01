#!/usr/bin/env python3
"""OHD-only native-file authority. Shared acquisition and console remain unchanged."""
import os
from pathlib import Path
import re
import signal
import sys

# Works with both repository names and installer-emitted underscore names.
import importlib.util
p = Path(__file__).with_name('vr_tower_ohd.py')
if not p.exists():
    p = p.with_name('vr-tower-ohd.py')
spec = importlib.util.spec_from_file_location('ohd_shared', p)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
FILE = 'HarshDoorstop/Saved/Config/LinuxServer/Game.ini'
SESSION = '/Script/Engine.GameSession'
RCON = '/Script/RCON.RCONServerSystem'
MAPPING = {(SESSION, 'MaxPlayers'): 'MAX_PLAYERS', (SESSION, 'ServerName'): 'SERVER_NAME',
           (RCON, 'Password'): 'RCON_PASSWORD', (RCON, 'MaxActiveConnections'): 'RCON_MAX_CONNECTIONS',
           (RCON, 'MaxAuthAttempts'): 'RCON_MAX_AUTH_ATTEMPTS'}


def prepare(root, env):
    path = shared.confined(root, FILE)
    before = path.read_bytes().decode('utf-8') if path.exists() else ''
    if '\x00' in before:
        raise ValueError('Invalid native OHD config')
    section = ''; seen_sections = set(); rows = {}; names = {}
    managed = {s.casefold(): s for s in (SESSION, RCON)}
    for line in before.lstrip('\ufeff').splitlines():
        stripped = line.strip()
        if stripped.startswith((';', '#')) or not stripped:
            continue
        if stripped.startswith('['):
            match = re.fullmatch(r'\[([^\]]+)\]\s*(?:[;#].*)?', stripped)
            if not match:
                raise ValueError('Malformed OHD section')
            section = match[1].casefold()
            if section in managed:
                if section in seen_sections:
                    raise ValueError('Ambiguous OHD section')
                seen_sections.add(section); names[managed[section]] = match[1]
        elif section in managed and '=' in line:
            key, value = line.split('=', 1); identity = (section, key.strip().casefold())
            if identity in rows:
                raise ValueError('Ambiguous OHD key')
            rows[identity] = value.strip()
    effective = dict(env)
    for (section, key), variable in MAPPING.items():
        value = rows.get((section.casefold(), key.casefold()))
        if value is not None:
            if value.startswith('"'):
                if not re.fullmatch(r'"[^"\\\r\n]*"', value):
                    raise ValueError('Unsupported OHD quoted scalar')
                value = value[1:-1]
            effective[variable] = value
    # All prerequisites and all native values are checked before acquisition/writes.
    shared.steam_options(root, 'ohd', effective)
    selected = shared.plan(root, 'ohd', effective)
    for (section, key), value in rows.items():
        if any(word in key for word in ('password', 'token', 'apikey')):
            selected['credentials'].extend([value, value.strip('"')])
    listen = rows.get((RCON.casefold(), 'listenport'))
    if listen is not None and listen != str(selected['ports']['RCON_PORT']):
        raise ValueError('Native RCON ListenPort conflicts with managed allocation')
    enabled = rows.get((RCON.casefold(), 'benabled'), 'true').lower()
    if enabled not in ('true', 'false'):
        raise ValueError('OHD bEnabled requires True or False')
    if enabled == 'false':
        selected['args'].remove('-EnableRCON')
    sections = selected['configs'][FILE]
    missing = {names.get(s, s): {k: v for k, v in values.items() if (s.casefold(), k.casefold()) not in rows}
               for s, values in sections.items()}
    missing = {s: v for s, v in missing.items() if v}
    after = shared.native.patch_ini(before, missing) if missing else before
    selected['ready'] = b'LogGameMode: Display: Match State Changed from EnteringMap to WaitingToStart'
    return selected, before, after


def install(root, env):
    prepare(root, env)
    shared.install(root, 'ohd', env)


def main():
    if sys.argv[1:] not in (['install'], ['run']):
        raise ValueError('Expected OHD install or run')
    root = Path.cwd().resolve(); env = dict(os.environ)
    prepare(root, env)
    if sys.argv[1] == 'install':
        install(root, env); return 0
    if shared.boolean(env, 'VOLTRA_STEAM_AUTO_UPDATE', True):
        install(root, env)
    selected, before, after = prepare(root, env)
    if before != after:
        shared.native.private_write(shared.confined(root, FILE), after)
    child = {k: v for k, v in env.items() if k not in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH')
             and not any(word in k for word in ('PASSWORD', 'TOKEN', 'API_KEY', 'STEAM_PASS', 'STEAM_AUTH', 'BETAPASS'))}
    child['HOME'] = str(root)
    return shared.console.run(root, [str(selected['binary']), *selected['args']], child, '',
                              credentials=selected['credentials'], ready_marker=selected['ready'], stop_signal=signal.SIGINT)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'OHD operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
