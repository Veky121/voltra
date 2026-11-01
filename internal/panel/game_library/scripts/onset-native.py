"""Onset native-file authority adapter. Shared acquisition and preservation remain unchanged."""
import importlib.util
import json
import os
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('onset_shared', Path(__file__).with_name('open_world_servers.py'))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


def plan(root, env):
    root = Path(root).resolve()
    if env.get('WINDOWS_INSTALL', '0') != '0':
        raise ValueError('Onset native adapter requires Linux')
    if env.get('SRCDS_APPID', '1204170') != '1204170':
        raise ValueError('Onset dedicated identity is fixed')
    shared.arguments(root, 1204170, env, True, platform='linux')
    shared.boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1')))
    port, ports = shared.allocated(env)
    if port < 3 or not {port-2, port-1, port}.issubset(ports):
        raise ValueError('Onset requires game, game-1 UDP and game-2 TCP allocations')
    path = shared.confined(root, 'server_config.json')
    if path.exists() and path.stat().st_size > 8*1024**2:
        raise ValueError('Onset config exceeds bounds')
    original = path.read_bytes() if path.exists() else None
    data = shared.json_object(original.decode('utf-8-sig')) if original is not None else {}
    seeds = {'servername': shared.text(env.get('SERVER_NAME', 'Onset server'), 260),
             'password': shared.text(env.get('SERVER_PASSWORD', ''), 128),
             'masterlist': shared.boolean(env.get('PUBLIC_SERVER', 'true'))}
    values = {k:v for k,v in seeds.items() if k not in data}
    for key, value in {'ipaddress':'0.0.0.0', 'port':port}.items():
        if data.get(key) != value:
            values[key] = value
    if not values:
        return path, original, original
    # Replace only managed value spans; preserve every unknown byte and numeric lexeme.
    body = original.decode('utf-8-sig') if original is not None else '{}'
    decoder = json.JSONDecoder()
    index = body.index('{')+1
    edits = []
    while True:
        while body[index].isspace(): index += 1
        if body[index] == '}': break
        key, end = decoder.raw_decode(body, index)
        index = end
        while body[index].isspace() or body[index] == ':': index += 1
        start = index
        _, index = decoder.raw_decode(body, index)
        if key in values:
            edits.append((start,index,json.dumps(values.pop(key),ensure_ascii=False)))
        while body[index].isspace(): index += 1
        if body[index] == ',': index += 1
    if values:
        addition = (',' if data else '') + ','.join(json.dumps(k)+':'+json.dumps(v,ensure_ascii=False) for k,v in values.items())
        edits.append((index,index,addition))
    for start,end,value in reversed(edits): body = body[:start]+value+body[end:]
    result = (b'\xef\xbb\xbf' if original and original.startswith(b'\xef\xbb\xbf') else b'')+body.encode()
    return path, original, result


def configure(root, game, env):
    if game != 'onset': raise ValueError('Onset only')
    path, original, result = plan(root, env)
    if result != original:
        shared.private_bytes(path, result, path.stat() if path.exists() else None)


shared.configure = configure


def install(root, env):
    plan(root, env)  # Refuse before shared staging/acquisition.
    receipt = shared.install(root, 'onset', env)
    configure(root, 'onset', env)
    return receipt


def run(root, env):
    plan(root, env)  # Shared launch may update; validate before that boundary.
    return shared.launch(root, 'onset', env)


if __name__ == '__main__':
    action, = sys.argv[1:]
    if action == 'install': install(Path.cwd(), dict(os.environ))
    elif action == 'run': sys.exit(run(Path.cwd(), dict(os.environ)))
    else: raise ValueError('Unknown Onset action')
