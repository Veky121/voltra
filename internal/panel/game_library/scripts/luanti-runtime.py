# SPDX-License-Identifier: MIT
"""Render managed native settings without shell interpolation, then exec Luanti."""
import os
import json
import re
import secrets
import shutil
import subprocess
import tempfile
from pathlib import Path


def scalar(value, field):
    value = str(value)
    if any(c in value for c in '\r\n\x00') or value != value.strip() or value in ('{', '"""'):
        raise ValueError(field + ' must be a single literal line without surrounding whitespace or native delimiters')
    return value


def slug(value, field):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value):
        raise ValueError(field + ' must contain only letters, numbers, underscores or hyphens')
    return value


def number(env, field, low, high):
    value = env.get(field, '')
    if not re.fullmatch(r'[0-9]+', value) or not low <= int(value) <= high:
        raise ValueError('Invalid ' + field)
    return str(int(value))


def settings(env):
    pairs = {
        'name': 'SERVER_ADMIN_NAME', 'server_name': 'SERVER_NAME',
        'server_description': 'SERVER_DESC', 'server_address': 'SERVER_DOMAIN',
        'server_url': 'SERVER_URL', 'serverlist_url': 'SERVER_LIST_URL',
        'motd': 'SERVER_MOTD', 'default_password': 'SERVER_PASSWORD',
    }
    result = {key: scalar(env.get(field, ''), field) for key, field in pairs.items()}
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,20}', result['name']):
        raise ValueError('Choose a valid SERVER_ADMIN_NAME, at most 20 characters')
    if not result['server_name']:
        raise ValueError('Choose SERVER_NAME')
    if env.get('SERVER_ANNOUNCE') not in ('true', 'false'):
        raise ValueError('SERVER_ANNOUNCE must be true or false')
    result.update(server_announce=env['SERVER_ANNOUNCE'],
                  max_users=number(env, 'SERVER_MAX_USERS', 1, 65535),
                  port=number(env, 'SERVER_PORT', 1, 65535),
                  default_game=slug(env.get('DEFAULT_GAME', ''), 'DEFAULT_GAME'),
                  bind_address='0.0.0.0')
    return result


def object_end(lines, index, kind):
    """Find the end of an existing native multiline value or nested group."""
    while index < len(lines):
        raw_line = lines[index].removesuffix('\n')
        line = lines[index].strip()
        index += 1
        if kind == '"""':
            if raw_line == '"""':
                return index
            continue
        if line == '}':
            return index
        if not line or line.startswith('#') or '=' not in line:
            continue
        value = line.split('=', 1)[1].strip()
        if value in ('{', '"""'):
            index = object_end(lines, index, value)
    raise ValueError('Unterminated native configuration object; existing file was retained')


def render(text, managed):
    for key, value in managed.items():
        scalar(value, key)
    lines = text.splitlines(keepends=True)
    output, seen, index = [], set(), 0
    while index < len(lines):
        start = index
        line = lines[index]
        index += 1
        trimmed = line.strip()
        if not trimmed or trimmed.startswith('#') or '=' not in trimmed:
            output.append(line)
            continue
        key, value = (v.strip() for v in trimmed.split('=', 1))
        if value in ('{', '"""'):
            index = object_end(lines, index, value)
        if key in managed:
            if key not in seen:
                # Keep identical operator formatting and file bytes on reinstall/start.
                if value == managed[key] and index == start + 1:
                    output.append(line)
                else:
                    output.append(key + ' = ' + managed[key] + '\n')
                seen.add(key)
        else:
            output.extend(lines[start:index])
    missing = [key for key in managed if key not in seen]
    if missing and output and not output[-1].endswith(('\n', '\r')):
        output.append('\n')
    output.extend(key + ' = ' + managed[key] + '\n' for key in missing)
    return ''.join(output)


def configure(path, managed):
    path = Path(path)
    old = path.read_bytes() if path.exists() else b''
    new = render(old.decode('utf-8'), managed).encode('utf-8')
    if old == new:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.luanti-config-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(new)
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            shutil.copy2(path, path.with_name(path.name + '.voltra-backup'))
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True


def prepare_admin(root, world, env):
    enabled = env.get('BOOTSTRAP_ADMIN', '1')
    if enabled not in ('0', '1'):
        raise ValueError('BOOTSTRAP_ADMIN must be 0 or 1')
    name = env['SERVER_ADMIN_NAME']
    directory = root / '.minetest/worlds' / world
    directory.mkdir(parents=True, exist_ok=True)
    password = scalar(env.get('SERVER_ADMIN_PASSWORD', ''), 'SERVER_ADMIN_PASSWORD')
    generated = not password
    if enabled == '1' and generated:
        receipt = directory / ('voltra-admin-password-' + name + '.json')
        if receipt.exists():
            data = json.loads(receipt.read_text(encoding='utf-8'))
            if data.get('name') != name or not isinstance(data.get('password'), str):
                raise ValueError('The existing generated administrator password file is invalid; restore it or choose an explicit password')
            password = scalar(data['password'], 'stored administrator password')
            if not password:
                raise ValueError('The stored administrator password is empty')
        else:
            password = secrets.token_urlsafe(32)
    data = dict(enabled=enabled == '1', name=name, password=password, generated=generated)
    fd, temporary = tempfile.mkstemp(prefix='.luanti-admin-', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(data, stream)
        os.replace(temporary, directory / '.voltra-admin-bootstrap.json')
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    mod = directory / 'worldmods/voltra_admin_bootstrap'
    mod.mkdir(parents=True, exist_ok=True)
    (mod / 'mod.conf').write_text('name = voltra_admin_bootstrap\ndescription = Native administrator account bootstrap\n', encoding='utf-8')
    shutil.copyfile(root / '.voltra/luanti-admin.lua', mod / 'init.lua')


def launch(root, env):
    root = Path(root).resolve()
    world = slug(env.get('WORLD_NAME', ''), 'WORLD_NAME')
    managed = settings(env)
    engine = root / '.voltra/luanti/bin/luantiserver'
    runtime_env = dict(env, LD_LIBRARY_PATH=str(root / '.voltra/luanti-libs'))
    version = subprocess.run([str(engine), '--version'], capture_output=True, text=True, check=True, env=runtime_env)
    if not version.stdout.startswith('Luanti 5.17.0 '):
        raise ValueError('The installed engine is not reviewed Luanti 5.17.0; reinstall this recipe')
    home = root / '.minetest'
    if not (home / 'games' / managed['default_game'] / 'game.conf').is_file():
        raise ValueError('Upload the selected game to .minetest/games/GAME_ID, including game.conf, or reinstall with community download enabled')
    (home / 'worlds').mkdir(parents=True, exist_ok=True)
    (home / 'mods').mkdir(parents=True, exist_ok=True)
    configure(home / 'minetest.conf', managed)
    prepare_admin(root, world, env)
    child_env = dict(runtime_env, HOME=str(root), LUANTI_USER_PATH=str(home),
                     LUANTI_GAME_PATH=str(home / 'games'), MINETEST_GAME_PATH=str(home / 'games'),
                     VOLTRA_LUANTI_PLAIN_CONSOLE='1')
    child_env.setdefault('TERM', 'xterm')
    print('Reviewed runtime: ' + version.stdout.splitlines()[0], flush=True)
    os.chdir(root)
    os.execve(str(engine), [str(engine), '--port', managed['port'], '--gameid', managed['default_game'],
                           '--world', str(home / 'worlds' / world), '--terminal',
                           '--config', str(home / 'minetest.conf'), '--logfile', str(root / 'server.log')], child_env)


if __name__ == '__main__':
    try:
        launch(Path.cwd(), os.environ)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        # Validation errors only identify field names. Never dump the environment.
        if isinstance(error, ValueError):
            print('Luanti setup failed: ' + str(error), flush=True)
        else:
            print('Luanti setup failed. Inspect installed files and reinstall the reviewed recipe.', flush=True)
        raise SystemExit(1)
