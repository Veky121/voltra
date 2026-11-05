"""Windrose-only adapter. Native JSON is authoritative after missing-key seeding."""
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import sys
import threading
import ocean_space_servers as shared


def spans(body, start=0):
    """Return direct object value spans without serializing unknown values."""
    decoder = json.JSONDecoder()
    pos = start + 1
    result = {}
    while True:
        while body[pos].isspace(): pos += 1
        if body[pos] == '}': return result, pos
        key, pos = decoder.raw_decode(body, pos)
        while body[pos].isspace(): pos += 1
        if body[pos] != ':': raise ValueError('Expected JSON colon')
        pos += 1
        while body[pos].isspace(): pos += 1
        begin = pos
        _, pos = decoder.raw_decode(body, pos)
        result[key] = (begin, pos)
        while body[pos].isspace(): pos += 1
        if body[pos] == ',': pos += 1
        elif body[pos] == '}': return result, pos
        else: raise ValueError('Expected JSON delimiter')


def plan(root, env):
    root = Path(root).resolve()
    shared.arguments(root, 4129620, env, True, platform='windows')
    if env.get('SRCDS_APPID', '4129620') != '4129620' or env.get('WINDOWS_INSTALL', '1') != '1':
        raise ValueError('Windrose requires its original Windows dedicated app')
    shared.boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1')))
    shared.wine_environment(root, 'windrose', env)
    for name in shared.PRESERVE['windrose']:
        protected = shared.confined(root, name)
        if protected.is_dir():
            for item in protected.rglob('*'):
                shared.confined(root, str(item.relative_to(root)))
                if not (item.is_file() or item.is_dir()): raise ValueError('Unsupported operator filesystem entry')
    path = shared.confined(root, 'R5/ServerDescription.json')
    if not path.is_file(): raise ValueError('Upload publisher-generated ServerDescription.json while stopped; no identity bootstrap')
    if path.stat().st_size > 8 * 1024**2: raise ValueError('Config exceeds 8MiB')
    before = path.read_bytes()
    body = before.decode('utf-8-sig')
    value = shared.json_object(body)
    section = value.get('ServerDescription_Persistent')
    if not isinstance(section, dict) or any(not isinstance(section.get(k), str) or not section[k] for k in ('PersistentServerId', 'WorldIslandId')):
        raise ValueError('Publisher-generated server/world identities required')
    defaults = dict(ServerName=shared.text(env.get('SERVER_NAME', 'Pterodactyl Windrose Server'), 40),
        InviteCode=shared.text(env.get('INVITE_CODE', ''), 32),
        IsPasswordProtected=shared.boolean(env.get('SERVER_PASSWORD_PROTECTED', '0')),
        Password=shared.text(env.get('SERVER_PASSWORD', ''), 30),
        MaxPlayerCount=shared.integer(env.get('MAX_PLAYERS', '8')),
        P2pProxyAddress=shared.text(env.get('P2P_PROXY', '127.0.0.1')),
        UseDirectConnection=shared.boolean(env.get('USE_DIRECT_CONNECTION', '0')))
    effective = dict(defaults, **section)
    known = set(defaults) | {'PersistentServerId', 'WorldIslandId', 'DirectConnectionServerAddress', 'DirectConnectionServerPort'}
    for key in section:
        if key not in known and key.casefold() in {k.casefold() for k in known}: raise ValueError('Ambiguous case-variant native key')
    for key, maximum in [('ServerName', 40), ('Password', 30), ('InviteCode', 32)]: shared.text(effective[key], maximum)
    if effective['InviteCode'] and not re.fullmatch('[a-zA-Z0-9]{6,32}', effective['InviteCode']): raise ValueError('Invalid invite code')
    for key in ('IsPasswordProtected', 'UseDirectConnection'):
        if type(effective[key]) is not bool: raise ValueError('Native boolean required')
    if bool(effective['Password']) != effective['IsPasswordProtected']: raise ValueError('Password protection must agree with native password')
    if type(effective['MaxPlayerCount']) is not int: raise ValueError('Native integer required')
    shared.integer(effective['MaxPlayerCount'])
    # Retain original hidden fixed proxy policy for seeded values; existing publisher native address stays authoritative.
    if defaults['P2pProxyAddress'] != '127.0.0.1': raise ValueError('Original environment proxy is fixed')
    ipaddress.ip_address(effective['P2pProxyAddress'])
    managed = dict(DirectConnectionServerAddress=str(ipaddress.ip_address(env.get('SERVER_IP', '0.0.0.0'))), DirectConnectionServerPort=shared.primary(env))
    fields, _ = spans(body, len(body) - len(body.lstrip()))
    fields, close = spans(body, fields['ServerDescription_Persistent'][0])
    edits = [(fields[k][0], fields[k][1], json.dumps(v)) for k, v in managed.items() if k in fields and section[k] != v]
    missing = {k: v for k, v in dict(defaults, **managed).items() if k not in fields}
    if missing: edits.append((close, close, (',' if fields else '') + ','.join(json.dumps(k) + ':' + json.dumps(v, ensure_ascii=False) for k, v in missing.items())))
    for begin, end, replacement in sorted(edits, reverse=True): body = body[:begin] + replacement + body[end:]
    after = (b'\xef\xbb\xbf' if before.startswith(b'\xef\xbb\xbf') else b'') + body.encode('utf-8')
    return path, before, after


def configure(root, env):
    path, before, after = plan(root, env)
    if after != before: shared.private_bytes(path, after, path.stat())


def install(root, env):
    plan(root, env)  # All config/runtime gates precede acquisition and volume mutation.
    return shared.install(root, 'windrose', env)


def launch(root, env):
    configure(root, env)
    if shared.boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'))): install(root, env)
    credentials = tuple(env.get(k, '') for k in ('SERVER_PASSWORD', 'INVITE_CODE'))
    native = shared.read_json(Path(root) / 'R5/ServerDescription.json')['ServerDescription_Persistent']
    credentials += (native.get('Password', ''), native.get('InviteCode', ''))
    finished = threading.Event()
    worker = threading.Thread(target=shared.follow_log, args=(shared.confined(Path(root), shared.GAMES['windrose'][2]), finished, credentials), daemon=True)
    worker.start()
    try: return shared.console.run(Path(root), shared.command(Path(root), 'windrose', env), shared.wine_environment(Path(root), 'windrose', env), '^C', credentials=credentials, stop_signal=signal.SIGINT)
    finally:
        finished.set()
        worker.join(timeout=2)


if __name__ == '__main__':
    action = sys.argv[1]
    if action == 'install': install(Path.cwd(), dict(os.environ))
    elif action == 'run': sys.exit(launch(Path.cwd(), dict(os.environ)))
    else: raise ValueError('Unknown Windrose operation')
