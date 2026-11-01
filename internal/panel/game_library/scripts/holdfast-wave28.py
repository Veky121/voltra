#!/usr/bin/env python3
"""Holdfast-only authority adapter; uses installer-emitted shared helper names."""
import importlib.util
from pathlib import Path
import re
import sys


def load():
    path = Path(__file__).with_name('steam-native-next.py')
    spec = importlib.util.spec_from_file_location('holdfast_shared', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def patch_existing(raw, ports):
    # Byte-preserving allocation reconciliation. Imported port authority is unsafe.
    lines = raw.splitlines(keepends=True)
    seen = set()
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith((b'import ', b'rc ')):
            raise ValueError('Imported/executable configuration needs native review')
        for key, value in ports.items():
            name = key.encode()
            match = re.fullmatch(rb'([ \t]*' + name + rb'[ \t]+)([0-9]+)([ \t]*)(\r?\n)?', line)
            if match:
                if key in seen:
                    raise ValueError('Duplicate allocation setting')
                seen.add(key)
                lines[i] = match[1] + str(value).encode() + match[3] + (match[4] or b'')
            elif stripped.startswith(name + b' '):
                raise ValueError('Unsafe allocation setting')
    if seen != set(ports):
        raise ValueError('Missing allocation setting; native review required')
    return b''.join(lines)


def configure(shared, root, env):
    root = Path(root)
    target = shared.confined(root, root/'holdfastnaw-dedicated'/'configs'/shared.relative(env, 'SERVER_CONFIG_PATH', 'serverconfig_default.txt'))
    raw = target.read_bytes()
    marker = b'# Voltra Holdfast native authority v1'
    if any(line.strip().startswith((b'import ', b'rc ')) for line in raw.splitlines()):
        raise ValueError('Imported/executable configuration needs native review')
    original = shared.patch_holdfast
    def patch(content, values):
        if marker not in raw and b'# Voltra managed server fields' not in raw:
            return original(content, values) + '\n' + marker.decode() + '\n'
        ports = {k:v for k,v in values.items() if k in ('server_port','steam_communications_port','steam_query_port')}
        return patch_existing(raw, ports).decode('utf-8')
    shared.patch_holdfast = patch
    try:
        argv, secrets = shared.configure(root, 'holdfast', env)
        # Include authoritative native credentials in shared log redaction.
        for line in target.read_text().splitlines():
            m = re.match(r'^\s*server_(?:admin_)?password\s+(.*)$', line)
            if m: secrets.append(m[1])
        return argv, secrets
    finally:
        shared.patch_holdfast = original


def preflight(shared, root, env):
    root = Path(root)
    if env.get('VOLTRA_STEAM_AUTO_UPDATE', '0') not in ('0', '1'):
        raise ValueError('Invalid auto update')
    ports = shared.roles(env, ['SERVER_COMM_PORT', 'SERVER_QUERY_PORT'])
    config = shared.relative(env, 'SERVER_CONFIG_PATH', 'serverconfig_default.txt')
    archive = shared.relative(env, 'SERVER_LOG_ARCHIVE_PATH', 'logs_archive')
    folder = shared.confined(root, root/'holdfastnaw-dedicated')
    target = shared.confined(root, folder/'configs'/config)
    raw = target.read_bytes()
    text = raw.decode('utf-8-sig')
    if any(line.strip().startswith((b'import ', b'rc ')) for line in raw.splitlines()):
        raise ValueError('Imported/executable configuration needs native review')
    values = {'server_port': ports['primary'], 'steam_communications_port': ports['SERVER_COMM_PORT'], 'steam_query_port': ports['SERVER_QUERY_PORT']}
    for key, name, default, limit in [('server_name','SERVER_NAME','Holdfast',200),('server_welcome_message','MOTD','Welcome!',500),('server_region','REGION','europe',50),('server_admin_password','ADMIN_PASS','',50),('server_password','SERVER_PASS','',50)]:
        values[key] = shared.text(env, name, default, limit)
    if not values['server_admin_password']:
        raise ValueError('Original Holdfast administrator password is required')
    values['maximum_players'] = shared.integer(env, 'PLAYERS', 32, 1, 250)
    shared.integer(env, 'FPSMAX', 60, 1, 1000)
    if b'# Voltra Holdfast native authority v1' in raw or b'# Voltra managed server fields' in raw:
        patch_existing(raw, {k: values[k] for k in ('server_port','steam_communications_port','steam_query_port')})
    else:
        shared.patch_holdfast(text, values)
    for sub, prefix in [('logs_output','output_'),('logs_adminactions','admin_'),('logs_playerlogin','players_'),('logs_score','scorelog_'),('logs_chat','chatlog_')]:
        shared.confined(root, folder/sub/(prefix+config))
    for name in ('workshop','micspammers.txt','mutedplayersvoip.txt','mutedplayerschat.txt','bannedplayers.txt'):
        shared.confined(root, folder/name)
    shared.confined(root, folder/archive)


def run(root, env):
    shared = load()
    preflight(shared, root, env)
    original = shared.configure
    def dispatch(root, game, env):
        shared.configure = original
        try: return configure(shared, root, env)
        finally: shared.configure = dispatch
    shared.configure = dispatch
    return shared.run(root, 'holdfast', env)


if __name__ == '__main__':
    import os
    if sys.argv[1:] != ['run']:
        raise SystemExit('Only Holdfast run is supported')
    raise SystemExit(run(Path.cwd(), dict(os.environ)))
