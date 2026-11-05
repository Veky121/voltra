#!/usr/bin/env python3
"""Astro-only native-file authority; retain the shared acquisition and supervisor."""
import os
from pathlib import Path
import re
import sys
from astrocolony_seed import FILE, SECTION, seed_settings
import unreal_survival_next as shared


def safe_path(root, relative):
    result = root / relative
    cursor = root
    for part in Path(relative).parts:
        if part in ('..', '.') or Path(part).is_absolute():
            raise ValueError('Unsafe Astro Colony path')
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError('Symlink in Astro Colony path')
        if cursor != result and cursor.exists() and not cursor.is_dir():
            raise ValueError('Invalid Astro Colony parent directory')
    if not result.resolve().is_relative_to(root):
        raise ValueError('Astro Colony path leaves server volume')
    if result.exists() and not result.is_file():
        raise ValueError('Expected regular Astro Colony file')
    return result


def native_password(data):
    active = False
    for line in data.decode('utf-8-sig').splitlines():
        stripped = line.strip()
        header = re.fullmatch(r'\[([^\]]+)\]\s*(?:[;#].*)?', stripped)
        if header:
            active = header.group(1).casefold() == SECTION.casefold()
        elif active and not stripped.startswith((';', '#')) and '=' in stripped:
            key, value = stripped.split('=', 1)
            if key.strip().casefold() == 'serverpassword':
                raw = value.strip()
                values = [raw]
                quoted = re.match(r'^"((?:[^"\\]|\\.)*)"', raw)
                if quoted:
                    values.append(re.sub(r'\\(["\\])', r'\1', quoted.group(1)))
                else:
                    values.append(re.split(r'\s+[;#]', raw, maxsplit=1)[0].strip())
                return [value for value in values if value]
    return []


def plan(root, environment, require_binary=True, require_ports=True):
    root = Path(root).resolve()
    info = shared.metadata()['astro']
    env = {**info['defaults'], **{k: v for k, v in environment.items() if k in info['defaults']}}
    shared.checked(env)
    if env['SRCDS_APPID'] != str(info['app']):
        raise ValueError('Unexpected dedicated application')
    for key, kind in info['types'].items():
        if kind == 'boolean' and env[key] not in ('0', '1'):
            raise ValueError('Invalid original boolean ' + key)
        if kind == 'number' and not re.fullmatch(r'-?\d+(?:\.\d+)?', env[key]):
            raise ValueError('Invalid original numeric control ' + key)
    ports = {int(value) for value in environment.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}
    primary = int(environment.get('SERVER_PORT', '0'))
    query = int(env['SERVER_QUERY_PORT']) if env['SERVER_QUERY_PORT'] else 0
    if require_ports and (not 1 <= primary <= 65535 or not 1 <= query <= 65535 or primary == query or not {primary, query} <= ports):
        raise ValueError('Choose distinct allocated primary and query ports')
    if not require_ports and (not 0 <= primary <= 65535 or not 0 <= query <= 65535 or primary and primary == query):
        raise ValueError('Invalid install-time port prerequisites')
    binary = safe_path(root, info['binary'])
    if require_binary and not binary.is_file():
        raise ValueError('Reinstall to restore native server executable')
    target = safe_path(root, FILE.lstrip('/'))
    if target.exists() and target.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('Native settings exceeds 8 MiB')
    previous = target.read_bytes() if target.exists() else b''
    planned = seed_settings(previous, env)
    credentials = native_password(planned)
    credentials += [environment.get(key, '') for key in ('SERVER_PASSWORD', 'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    argv = [str(binary), '-log', '-stdout', '-FullStdOutLogOutput', '-Port=' + str(primary), '-QueryPort=' + str(query), '-SteamServerName=' + env['SERVER_NAME']]
    return {'root': root, 'binary': binary, 'target': target, 'previous': previous,
            'planned': planned, 'argv': argv, 'credentials': credentials,
            'child': shared.wine_environment(root, env), 'ready': info['ready'].encode()}


def publish(planned):
    root, target = planned['root'], planned['target']
    safe_path(root, str(target.relative_to(root)))
    current = target.read_bytes() if target.exists() else b''
    if current != planned['previous']:
        raise ValueError('Native settings changed during startup; retry')
    if current != planned['planned']:
        shared._publish(root, str(target.relative_to(root)), lambda output: output.write(planned['planned']), 0o600)
    target.chmod(0o600)
    planned['binary'].chmod(planned['binary'].stat().st_mode | 0o100)


def main():
    action = sys.argv[1] if len(sys.argv) == 2 else ''
    if action not in ('install', 'run'):
        raise ValueError('Expected install or run')
    root, environment = Path.cwd(), dict(os.environ)
    updating = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0')) == '1'
    # Validate ports, paths and all native identities before invoking acquisition.
    planned = plan(root, environment, require_binary=action == 'run' and not updating, require_ports=action == 'run')
    if action == 'install' or updating:
        shared.install(root, 'astro', environment)
        if action == 'install':
            return 0
        planned = plan(root, environment)
    publish(planned)
    return shared.run(planned['root'], planned['argv'], planned['child'], '\x03',
                      credentials=planned['credentials'], ready_marker=planned['ready'], terminal_input=True)


if __name__ == '__main__':
    sys.exit(main())
