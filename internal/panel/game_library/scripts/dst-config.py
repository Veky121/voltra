#!/usr/bin/env python3
"""MIT. Native surface/cave configuration; publisher process acceptance pending."""
from pathlib import Path
import re
import secrets
from native_config import configure_ini, private_write


def line(value, limit):
    if len(value.encode('utf-8')) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('DST settings must fit their UTF-8 limit and contain no control characters')
    return value


def credential_file(path, limit):
    with path.open(encoding='utf-8') as source:value = source.read(limit + 2).strip()
    return line(value, limit)


def configure(root, env):
    root = Path(root).resolve()
    identity = env.get('CLUSTER_ID', 'server')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', identity):raise ValueError('Invalid persistent cluster ID')
    online = env.get('ONLINE_MODE', '1')
    if online not in ('0', '1'):raise ValueError('ONLINE_MODE must be 0 or 1')
    token = line(env.get('SERVER_TOKEN', ''), 2048)
    maximum = int(env.get('MAX_PLAYERS', '16'))
    if not 1 <= maximum <= 31:raise ValueError('Player limit must be between 1 and 31')
    mode = env.get('GAME_MODE', 'survival')
    if mode not in ('survival', 'endless', 'wilderness', 'relaxed', 'lightsout'):raise ValueError('Unsupported native game mode')
    pvp, pause = env.get('PVP', '0'), env.get('PAUSE_EMPTY', '1')
    if pvp not in ('0', '1') or pause not in ('0', '1'):raise ValueError('Invalid gameplay toggle')
    primary = int(env['SERVER_PORT'])
    allocated = {int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if p}
    if primary not in allocated or len(allocated) < 6 or any(not 1 <= p <= 65535 for p in allocated):
        raise ValueError('Allocate six distinct ports for both native shards and their Steam services')
    remaining = sorted(allocated - {primary})
    if online == '0':
        candidates = [port for port in remaining if 10998 <= port <= 11018]
        if not 10998 <= primary <= 11018 or not candidates:
            raise ValueError('Native offline LAN mode requires both gameplay ports in the range 10998 through 11018')
        cave = candidates[0]
        ports = [primary, cave, *[port for port in remaining if port != cave][:4]]
    else:ports = [primary, *remaining[:5]]
    cluster = root / 'DoNotStarveTogether/config' / identity
    state = root / '.voltra/dst'
    if not all(path.resolve().is_relative_to(root) for path in (cluster, state)):
        raise ValueError('Cluster state leaves the server volume')
    token_file = cluster / 'cluster_token.txt'
    key_file = state / 'shard-key'
    if not all(path.resolve().is_relative_to(root) for path in (token_file, key_file)):
        raise ValueError('Private cluster credentials leave the server volume')
    effective_token = token
    if online == '1' and not token and token_file.is_file():effective_token = credential_file(token_file, 2048)
    if online == '1' and not effective_token:
        raise ValueError('Online clusters require a Klei server token')
    name = line(env.get('CLUSTER_NAME', 'A Pterodactyl Server'), 256)
    description = line(env.get('CLUSTER_DESC', 'A Pterodactyl Hosted Server'), 1024)
    password = line(env.get('CLUSTER_PASSWORD', ''), 128)
    key = credential_file(key_file, 64) if key_file.exists() else secrets.token_hex(32)
    if not re.fullmatch('[a-f0-9]{64}', key):raise ValueError('Existing private shard key is invalid')
    internal = next(port for port in range(10889, 10989) if port not in allocated)
    if not key_file.exists():private_write(key_file, key + '\n')
    configure_ini(root, cluster / 'cluster.ini', {
        'GAMEPLAY': {'game_mode': mode, 'max_players': str(maximum), 'pvp': str(pvp == '1').lower(), 'pause_when_empty': str(pause == '1').lower()},
        'NETWORK': {'cluster_name': name, 'cluster_description': description, 'cluster_password': password, 'offline_cluster': str(online == '0').lower(), 'lan_only_cluster': str(online == '0').lower()},
        'MISC': {'console_enabled': 'true'},
        'SHARD': {'shard_enabled': 'true', 'bind_ip': '127.0.0.1', 'master_ip': '127.0.0.1', 'master_port': str(internal), 'cluster_key': key},
    }, state / 'config-backups')
    for index, shard in enumerate(('Master', 'Caves')):
        configure_ini(root, cluster / shard / 'server.ini', {
            'NETWORK': {'server_port': str(ports[index])},
            'SHARD': {'is_master': str(index == 0).lower(), 'name': shard, 'id': str(index + 1)},
            'STEAM': {'master_server_port': str(ports[2 + index * 2]), 'authentication_port': str(ports[3 + index * 2])},
        }, state / 'config-backups')
    if token:private_write(token_file, token + '\n')
    elif token_file.exists():token_file.chmod(0o600)
    return {'cluster': cluster, 'identity': identity, 'ports': ports, 'internal_shard_port': internal,
            'credentials': [effective_token, key]}
