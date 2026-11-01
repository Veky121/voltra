#!/usr/bin/env python3
"""Arma 3-only native controls. Uses the shared pure publication planner."""
import importlib.util
from pathlib import Path
import sys
import re

spec = importlib.util.spec_from_file_location('arma_shared', Path(__file__).with_name('arma-native.py'))
arma = importlib.util.module_from_spec(spec)
spec.loader.exec_module(arma)


def managed_values(env):
    # Only supplied controls own assignments. Older installations retain their native values.
    values = {}
    for control, key, limit in [('SERVER_NAME', 'hostname', 255), ('ADMIN_PASSWORD', 'passwordAdmin', 128)]:
        if control in env:
            values[key] = arma.cfg_string(arma.text(env, control, limit=limit))
    for control, key in [('BATTLEYE', 'BattlEye'), ('PERSISTENT', 'persistent'),
                         ('DISABLE_VON', 'disableVoN')]:
        if control in env:
            values[key] = '1' if arma.boolean(env, control) else '0'
    if 'VERIFY_SIGNATURES' in env:
        values['verifySignatures'] = str(arma.integer(env, 'VERIFY_SIGNATURES', 2, 0, 2))
    if 'VON_CODEC_QUALITY' in env:
        values['vonCodecQuality'] = str(arma.integer(env, 'VON_CODEC_QUALITY', 10, 1, 30))
    return values


original_configure = arma.configure
original_child_environment = arma.child_environment


def native_password(content):
    """Read only a literal top-level password; errors never include native values."""
    tokens = re.findall(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:""|[^"])*"|[A-Za-z_][A-Za-z_0-9]*|\s+|.', content)
    tokens = [t for t in tokens if not t.isspace() and not t.startswith(('//', '/*'))]
    depth, found = 0, []
    for i, token in enumerate(tokens):
        if token == '{': depth += 1
        elif token == '}': depth -= 1
        elif depth == 0 and token.lower() == 'password':
            if token != 'password' or i + 3 >= len(tokens) or tokens[i+1] != '=' or tokens[i+3] != ';' or not re.fullmatch(r'"(?:""|[^"])*"', tokens[i+2]):
                raise ValueError('Unsupported native headless password syntax')
            found.append(tokens[i+2][1:-1].replace('""', '"'))
    if len(found) > 1 or '#' in ''.join(t for t in tokens if not t.startswith('"')):
        raise ValueError('Ambiguous native headless password syntax')
    value = found[0] if found else ''
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Unsupported native headless password characters')
    return value


def configure(root, game, env):
    if game != 'arma3':
        raise ValueError('Arma 3 controls cannot configure another game')
    values = managed_values(env)
    values.update({
        'password': arma.cfg_string(arma.text(env, 'SERVER_PASSWORD')),
        'maxPlayers': str(arma.integer(env, 'MAX_PLAYERS', 32, 1, 2147483647)),
        'headlessClients[]': '{"127.0.0.1"}',
        'localClient[]': '{"127.0.0.1"}',
    })
    path = arma.checked_path(root, 'server.cfg')
    # Keep operator line endings when missing defaults require publication.
    # read_text() translates CRLF and would rewrite every existing line.
    content = path.read_bytes().decode('utf-8') if path.exists() else ''
    # Probe with an impossible scalar to distinguish missing assignments without
    # treating nested mission assignments as server settings. Duplicates fail closed.
    missing = {}
    prefix = content + ('\n' if not content.endswith('\n') else '')
    for key, value in values.items():
        probe = arma.patch_cfg(content, {key: '__VOLTRA_SEED_PROBE__'})
        if probe.startswith(prefix + key + ' = __VOLTRA_SEED_PROBE__;'):
            missing[key] = value
    seeded = arma.patch_cfg(content, missing) if missing else (path.read_text() if path.exists() else '')
    plan = arma.plan_arma3(root, env, seeded)
    if plan[1]:
        password = native_password(seeded)
        for client in plan[1]:
            client[:] = [('-password=' + password) if arg.startswith('-password=') else arg for arg in client]
    return arma.publish_arma3(plan)




def child_environment(root, game, env):
    result = original_child_environment(root, game, env)
    result.pop('ADMIN_PASSWORD', None)
    return result


arma.configure = configure
arma.child_environment = child_environment

if __name__ == '__main__':
    try:
        if len(sys.argv) != 3 or sys.argv[2] != 'arma3':
            raise ValueError('Expected install/run arma3')
        sys.exit(arma.main())
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Arma 3 operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
