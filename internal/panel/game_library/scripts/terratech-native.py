#!/usr/bin/env python3
"""TerraTech-only native authority adapter. No acquisition at import/preflight."""
import importlib.util
import json
from pathlib import Path
import re
import sys


def helper(name):
    path = Path(__file__).with_name(name + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def patch(raw, port, password, slots):
    """Preserve every untouched byte; seed gameplay keys only when absent."""
    bom = raw.startswith(b'\xef\xbb\xbf')
    text = raw.decode('utf-8-sig')
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key.casefold() in {k.casefold() for k in result}:
                raise ValueError('Ambiguous JSON identity')
            result[key] = value
        return result
    decoder = json.JSONDecoder(object_pairs_hook=pairs,
        parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
    data = decoder.decode(text)
    if not isinstance(data, dict):
        raise ValueError('Native config must be an object')
    for key in ('Port', 'Password', 'SlotCount'):
        if any(k.casefold() == key.casefold() and k != key for k in data):
            raise ValueError('Ambiguous managed key')
    if 'Password' in data and (not isinstance(data['Password'], str) or len(data['Password']) > 128 or re.search(r'[\x00-\x1f\x7f]', data['Password'])):
        raise ValueError('Invalid native password')
    if 'SlotCount' in data and (type(data['SlotCount']) is not int or not 1 <= data['SlotCount'] <= 6):
        raise ValueError('Native slots outside retained canonical bounds')
    spans = {}; index = text.index('{') + 1
    while True:
        while text[index].isspace(): index += 1
        if text[index] == '}': break
        key, index = decoder.raw_decode(text, index)
        while text[index].isspace(): index += 1
        index += 1
        while text[index].isspace(): index += 1
        start = index
        _, index = decoder.raw_decode(text, index)
        spans[key] = (start, index)
        while text[index].isspace(): index += 1
        if text[index] == ',': index += 1
        else: break
    if 'Port' in spans:
        start, end = spans['Port']; text = text[:start] + str(port) + text[end:]
    missing = {key: value for key, value in {'Port': port, 'Password': password, 'SlotCount': slots}.items() if key not in data}
    if missing:
        end = text.rfind('}')
        text = text[:end] + (',' if data else '') + json.dumps(missing, ensure_ascii=False)[1:-1] + text[end:]
    return (b'\xef\xbb\xbf' if bom else b'') + text.encode('utf-8')


def validate(root, env, base):
    root = Path(root).resolve()
    base.identity('terra', env)
    base.engineering.choice(env, 'AUTO_UPDATE', '1', ('0', '1'))
    base.engineering.choice(env, 'VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'), ('0', '1'))
    mode = base.engineering.choice(env, 'INSTALL_MODE', 'steam', ('steam', 'operator_files'))
    if mode == 'steam': base.steam.arguments(root, 2533070, env, platform='windows')
    port = base.shared.roles(env, [])['primary']
    password = base.shared.text(env, 'SERVER_PASSWORD', '', 128)
    slots = base.shared.integer(env, 'MAX_PLAYERS', 6, 1, 6)
    target = base.shared.confined(root, root / 'dedicated_server_config.json')
    raw = target.read_bytes() if target.exists() else b'{}\n'
    updated = patch(raw, port, password, slots)
    identity = base.shared.confined(root, root / 'steam_appid.txt')
    if identity.exists() and identity.read_text().strip() != '2313330':
        raise ValueError('Conflicting Steam identity')
    return target, raw, updated


def bind(base):
    original_install = base.install
    def install(root, game, env):
        if game != 'terra': raise ValueError('TerraTech only')
        validate(root, env, base)
        return original_install(root, game, env)
    def configure(root, game, env):
        if game != 'terra': raise ValueError('TerraTech only')
        target, old, updated = validate(root, env, base)
        if old != updated or not target.exists():
            base.native.private_write(target, updated.decode('utf-8'))
        import json
        password = json.loads(updated.decode('utf-8-sig'))['Password']
        root = Path(root).resolve()
        return [str(base.helper('enshrouded-proton').location(root)), 'run', str(root / base.PINS['terra']['binary']), '-log'], [password], base.shared.confined(root, root / 'TT2/Saved/Logs/TT2.log')
    base.install = install
    base.configure = configure
    return base


if __name__ == '__main__':
    import os
    try:
        base = bind(helper('adventure-servers'))
        root = Path.cwd(); env = dict(os.environ)
        validate(root, env, base)
        action = sys.argv[1]
        if action == 'preflight': pass
        elif action == 'install': base.install(root, 'terra', env)
        elif action == 'run': sys.exit(base.run(root, 'terra', env))
        else: raise ValueError('Unknown action')
    except Exception:
        print('TerraTech validation or runtime failed; check native config, allocation and prerequisites.', file=sys.stderr)
        sys.exit(1)
