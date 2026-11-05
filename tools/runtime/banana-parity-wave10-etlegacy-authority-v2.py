#!/usr/bin/env python3
"""ET: Legacy-only seed-once settings; preserve shared Quake supervision."""
import os
from pathlib import Path
import re
import sys
import threading
import quake_family_runtime as shared
from native_config import private_write

NATIVE = 'voltra-native.cfg'
IDENTITY = {'sv_hostname': 'SERVER_NAME', 'sv_maxclients': 'MAX_PLAYERS',
            'g_password': 'SERVER_PASSWORD', 'rconpassword': 'RCON_PASSWORD'}
SECRET_KEYS = ('g_password', 'rconpassword', 'sv_privatepassword',
               'refereepassword', 'shoutcastpassword')
PREFIX = re.compile(r'^\s*(?:(?:(?:seta|sets|setu|set)(?=[ \t"])|"(?:seta|sets|setu|set)")[ \t]*)?"?([A-Za-z_][A-Za-z0-9_]*)', re.I)
ROW = re.compile(r'^\s*(?:(?:set|seta|sets|setu)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+("[^"\\\r\n]*"|[^\s"\\;]+)\s*(?://[^\r\n]*)?$', re.I)


def safe(root, path):
    shared.confined(root, path)
    current = path
    while current != root:
        if current.is_symlink():
            raise ValueError('ET settings paths cannot use symbolic links')
        current = current.parent
    return path


def identity_values(text):
    found = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('//'):
            continue
        head = PREFIX.match(line)
        if not head or head[1].lower() not in (*IDENTITY, *SECRET_KEYS):
            continue
        key = head[1].lower()
        match = ROW.fullmatch(line)
        if key in found or match is None:
            raise ValueError('Ambiguous or unsafe ET identity/credential assignment')
        value = match[2]
        value = value[1:-1] if value.startswith('"') else value
        if key == 'sv_maxclients':
            shared.number({'value': value}, 'value', 20, 1, 64)
        else:
            shared.quoted(value, 255 if key == 'sv_hostname' else 127,
                          key in ('sv_hostname', 'g_password'))
        found[key] = value
    return found


def plan(root, env):
    root = Path(root).resolve()
    game = safe(root, root / 'etlegacy')
    folder = safe(root, game / 'userdata' / 'legacy')
    target = safe(root, folder / NATIVE)
    managed = safe(root, folder / 'voltra-managed.cfg')
    if target.exists() and not target.is_file() or managed.exists() and not managed.is_file():
        raise ValueError('ET settings must be regular files')
    architecture = env.get('ET_VERSION', '32')
    if architecture not in ('32', '64'):
        raise ValueError('ET_VERSION must be 32 or 64')
    binary = safe(root, game / ('etlded.i386' if architecture == '32' else 'etlded.x86_64'))
    if not binary.is_file():
        raise ValueError('Install the selected ET: Legacy architecture first')
    port = shared.number(env, 'SERVER_PORT', 27960, 1, 65535)
    public = shared.number(env, 'PUBLIC_SERVER', 0, 0, 1)
    shared.number(env, 'OMNIBOT', 0, 0, 1)
    shared.number(env, 'MAX_PLAYERS', 20, 1, 64)
    name = shared.quoted(env.get('SERVER_NAME', 'ET: Legacy server'), 255, True)
    password = shared.quoted(env.get('SERVER_PASSWORD', ''), 127, True)
    rcon = shared.quoted(env.get('RCON_PASSWORD', ''), 127)
    game_map = env.get('MAP', 'oasis')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,63}', game_map):
        raise ValueError('Choose a native map basename without .bsp')
    folders = [folder, game / 'legacy', game / 'userdata' / 'etmain', game / 'etmain']
    for path in folders:
        safe(root, path)
    if not shared.map_exists(folders, game_map):
        raise ValueError('The selected map is missing from installed packages')
    if target.exists():
        if target.stat().st_size > 1024**2:
            raise ValueError('ET settings exceed the editor bound')
        with target.open(encoding='utf8', newline='') as stream:
            content = stream.read()
    else:
        # Reviewed publisher defaults; no user configuration is rewritten.
        content = ('// Native ET: Legacy settings. Existing values remain authoritative.\n'
                   'set sv_hostname ' + name + '\n'
                   'set sv_maxclients "' + str(shared.number(env, 'MAX_PLAYERS', 20, 1, 64)) + '"\n'
                   'set g_password ' + password + '\nset rconpassword ' + rcon + '\n'
                   'set sv_privateclients "4"\nset sv_privatepassword ""\n'
                   'set refereePassword ""\nset shoutcastPassword ""\n'
                   'set g_friendlyFire "1"\nset g_doWarmup "0"\nset g_warmup "10"\n'
                   'set g_teamForceBalance "1"\nset g_noTeamSwitching "0"\nset g_xpSave "0"\n')
    values = identity_values(content)
    effective = dict(env)
    for key, variable in IDENTITY.items():
        if key in values:
            effective[variable] = values[key]
    return root, game, target, managed, content, values, effective, port, public


def configure(root, env):
    root, game, target, managed, content, values, effective, port, public = plan(root, env)
    # All game-specific refusal checks finish before the shared writer runs.
    _, argv, _ = shared.configure(effective, root, 'etlegacy')
    if not target.exists():
        private_write(target, content)
    else:
        target.chmod(0o600)
    # The publisher sample sets dedicated=2. Reassert reviewed listener/listing
    # policy after that sample rather than relying on early +set processing.
    with managed.open(encoding='utf8', newline='') as stream:
        original = stream.read()
    policy = ('set dedicated ' + str(2 if public else 1) + '\n'
              'set sv_advert ' + str(3 if public else 0) + '\n'
              'set net_ip "0.0.0.0"\nset net_port ' + str(port) + '\n')
    private_write(managed, original + policy)
    index = argv.index('+map')
    argv[index:index] = ['+exec', NATIVE, '+exec', 'voltra-managed.cfg']
    return game, argv, port, [values.get(key, '') for key in SECRET_KEYS]


def main(root, env):
    game, argv, port, credentials = configure(root, env)
    threading.Thread(target=shared.probe, args=(port,), daemon=True).start()
    return shared.run(game, argv, dict(env), 'quit', credentials=credentials)


if __name__ == '__main__':
    try:
        raise SystemExit(main(Path.cwd(), os.environ))
    except (ValueError, OSError, UnicodeError):
        print('ET: Legacy setup refused. Review native settings, allocations and installed architecture.', file=sys.stderr)
        raise SystemExit(1)
