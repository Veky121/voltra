#!/usr/bin/env python3
"""Risk-only candidate. Keep operator CFG bytes; reuse shared install/supervision."""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

spec = importlib.util.spec_from_file_location('risk_adventure', Path(__file__).with_name('adventure-servers.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
original_install = base.install
CONFIG = 'Risk of Rain 2_Data/Config/server.cfg'


def quote(value):
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Control characters unsupported')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def statements(content):
    # Strip comments outside strings and split terminators without allowing a
    # command hidden behind comments, unsupported escapes or multiline strings.
    rows = []; row = ''; quoted = False; escaped = False; comment = False
    for i, c in enumerate(content):
        if comment:
            if c not in '\r\n':
                continue
            comment = False
        elif not quoted and content[i:i+2] == '//':
            comment = True
            continue
        if escaped:
            if c not in ('"', '\\'):
                raise ValueError('Unsupported escape')
            escaped = False; row += c; continue
        if quoted and c == '\\':
            escaped = True; row += c; continue
        if c == '"':
            quoted = not quoted
        if (ord(c) < 32 and c not in '\t\r\n') or ord(c) == 127 or (quoted and c in '\r\n'):
            raise ValueError('Unsupported control')
        if not quoted and c in ';\r\n':
            if row.strip(): rows.append(row.strip())
            row = ''
        else:
            row += c
    if quoted or escaped: raise ValueError('Malformed string')
    if row.strip(): rows.append(row.strip())
    return rows


def native_values(content):
    values = {}
    keys = {'sv_hostname', 'sv_password', 'sv_maxplayers', 'sv_port',
            'steam_server_query_port', 'steam_server_steam_port', 'steam_server_heartbeat_enabled'}
    for row in statements(content):
        match = re.fullmatch(r'([a-z_]+)\s+("(?:\\["\\]|[^"\\])*"|[0-9]+)', row)
        if not match or match[1] not in keys or match[1] in values:
            raise ValueError('Unknown, executable, duplicate or ambiguous native command')
        key, value = match.groups()
        if key in ('sv_hostname', 'sv_password'):
            if not value.startswith('"'): raise ValueError('String must be quoted')
            value = json.loads(value)
        elif value.startswith('"'):
            raise ValueError('Numeric setting must be unquoted')
        if key == 'steam_server_heartbeat_enabled' and value not in ('0', '1'):
            raise ValueError('Invalid heartbeat')
        values[key] = value
    return values


def preflight(root, env):
    root = Path(root).resolve()
    base.identity('risk', env)
    base.engineering.choice(env, 'AUTO_UPDATE', '1', ('0', '1'))
    base.engineering.choice(env, 'VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'), ('0', '1'))
    base.engineering.choice(env, 'INSTALL_MODE', 'steam', ('steam', 'operator_files'))
    base.steam.arguments(root, 1180760, env, platform='windows')
    if env.get('ACCEPT_WINDOWS_RUNTIME_LICENSES', 'false') != 'true':
        raise ValueError('Explicit private runtime license acceptance required')
    if env.get('VOLTRA_WINETRICKS_RUN', env.get('WINETRICKS_RUN', 'mono')).split() != ['mono']:
        raise ValueError('Only original mono prerequisite supported')
    for key, default in [('WINEPREFIX', str(root / '.wine')), ('WINEPATH', str(root))]:
        base.shared.confined(root, Path(env.get(key, default)))
    registry = base.shared.confined(root, Path(env.get('WINEPREFIX', str(root / '.wine'))) / 'system.reg')
    if registry.exists() and '#arch=win32' in registry.read_text(errors='replace')[:1024]:
        raise ValueError('Existing win32 prefix requires review')
    base.shared.text(env, 'WINEDEBUG', '-all', 32)
    # Validate all controls without invoking configure or writing seeded defaults.
    base.shared.text(env, 'PASSWORD', '', 40)
    base.shared.text(env, 'HOSTNAME', '"Risk of Rain 2 Dedicated Server"', 40)
    base.shared.integer(env, 'PLAYERS', 4, 1, 2147483647)
    base.engineering.choice(env, 'ADVERTISE', '1', ('0', '1'))
    mode = base.engineering.choice(env, 'PORT_MODE', 'allocated', ('allocated', 'original'))
    if mode == 'allocated':
        roles = base.shared.roles(env, [], offsets=(1, 2))
        ports = [roles['primary'], roles['1'], roles['2']]
    else:
        roles = base.shared.roles(env, ['QUERY', 'STEAM'])
        ports = [roles['primary'], roles['QUERY'], roles['STEAM']]
        if ports[2] != ports[1] + 1:
            raise ValueError('Original Steam port must equal query+1')
    target = base.shared.confined(root, root / CONFIG)
    startup = base.shared.confined(root, target.with_name('server_startup.cfg'))
    pregame = base.shared.confined(root, target.with_name('server_pregame.cfg'))
    # Do not rewrite operator programs. A narrow bootstrap can only execute the
    # authoritative file, host, and remove local users, in that order.
    if startup.exists():
        rows = statements(startup.read_bytes().decode('utf-8-sig'))
        allowed = [['exec server', 'host'], ['exec server.cfg', 'host']]
        if rows and rows[-1] == 'remove_all_local_users':
            rows = rows[:-1]
        if rows not in allowed:
            raise ValueError('Startup script requires active-file authority review')
    if pregame.exists() and statements(pregame.read_bytes().decode('utf-8-sig')):
        raise ValueError('Pregame script can override typed authority; review required')
    if target.exists():
        values = native_values(target.read_bytes().decode('utf-8-sig'))
        for key, port in zip(('sv_port', 'steam_server_query_port', 'steam_server_steam_port'), ports):
            if values.get(key) != str(port):
                raise ValueError('Native ports must match allocation before acquisition')
    return target


def configure(root, game, env):
    if game != 'risk':
        raise ValueError('Risk-only variant')
    target = preflight(root, env)
    if not target.exists():
        values = {
            'sv_password': quote(env.get('PASSWORD', '')),
            'steam_server_heartbeat_enabled': env.get('ADVERTISE', '1'),
            'sv_hostname': quote(env.get('HOSTNAME', '"Risk of Rain 2 Dedicated Server"')),
            'sv_maxplayers': str(base.shared.integer(env, 'PLAYERS', 4, 1, 2147483647)),
        }
        if env.get('PORT_MODE', 'allocated') == 'allocated':
            roles = base.shared.roles(env, [], offsets=(1, 2))
            ports = [roles['primary'], roles['1'], roles['2']]
        else:
            roles = base.shared.roles(env, ['QUERY', 'STEAM'])
            ports = [roles['primary'], roles['QUERY'], roles['STEAM']]
        values.update(zip(('sv_port', 'steam_server_query_port', 'steam_server_steam_port'), map(str, ports)))
        content = ''.join(key + ' ' + value + ';\n' for key, value in values.items())
        native_values(content)  # Refuse unsupported strings before publication.
        base.shared.write_config(root, target, content)
    values = native_values(target.read_bytes().decode('utf-8-sig'))
    secrets = [env.get('PASSWORD', ''), values.get('sv_password', '')]
    return ['xvfb-run', '-a', 'wine', str(Path(root) / base.PINS['risk']['binary']), '+exec', 'server.cfg'], secrets, None


def install(root, game, env):
    if game != 'risk':
        raise ValueError('Risk-only variant')
    preflight(root, env)
    return original_install(root, game, env)


base.configure = configure
base.install = install

if __name__ == '__main__':
    try:
        action = sys.argv[1]
        root = Path.cwd()
        env = dict(os.environ)
        preflight(root, env)
        if action == 'install':
            install(root, 'risk', env)
        elif action == 'run':
            sys.exit(base.run(root, 'risk', env))
        else:
            raise ValueError('Unsupported action')
    except Exception:
        print('Risk setup refused; review native port configuration and explicit runtime prerequisites. Existing settings retained.', file=sys.stderr)
        sys.exit(1)
