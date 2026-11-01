# SPDX-License-Identifier: MIT
"""Render managed native settings without shell interpolation, then exec Luanti."""
import os
import json
import re
import secrets
import subprocess
import tempfile
import time
from pathlib import Path


RUNTIME_SETTINGS = frozenset(('port', 'bind_address', 'default_game'))
SETTING_ENV = {
    'name': 'SERVER_ADMIN_NAME', 'server_name': 'SERVER_NAME',
    'server_description': 'SERVER_DESC', 'server_address': 'SERVER_DOMAIN',
    'server_url': 'SERVER_URL', 'serverlist_url': 'SERVER_LIST_URL',
    'motd': 'SERVER_MOTD', 'default_password': 'SERVER_PASSWORD',
    'server_announce': 'SERVER_ANNOUNCE', 'max_users': 'SERVER_MAX_USERS',
}


def native_lines(text):
    # settings.cpp uses std::getline: Unicode line symbols are literal text.
    parts = text.split('\n')
    return [part + '\n' for part in parts[:-1]] + ([parts[-1]] if parts[-1] else [])


def records(text):
    lines, found, index = native_lines(text), [], 0
    while index < len(lines):
        start, line = index, lines[index]
        index += 1
        trimmed = line.strip(' \t\r\n\v\f')
        if not trimmed or trimmed.startswith('#') or '=' not in trimmed:
            continue
        key, value = (v.strip(' \t\r\n\v\f') for v in trimmed.split('=', 1))
        kind = 'scalar'
        if value in ('{', '"""'):
            kind = 'group' if value == '{' else 'multiline'
            index = object_end(lines, index, value)
        found.append((key, value, kind, start, index))
    return lines, found


def contained(root, relative):
    current = Path(root)
    parts = Path(relative).parts
    for index, part in enumerate(parts):
        if part in ('..', '.'):
            raise ValueError('Managed Luanti path leaves its server root')
        current = current / part
        if current.is_symlink():
            raise ValueError('Managed Luanti path must not be a symbolic link')
        if index < len(parts) - 1 and current.exists() and not current.is_dir():
            raise ValueError('Managed Luanti parent must be a directory')
    return current


def scalar(value, field):
    value = str(value)
    if any(c in value for c in '\r\n\x00') or value != value.strip(' \t\r\n\v\f') or value in ('{', '"""'):
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
    pairs = {key: field for key, field in SETTING_ENV.items() if key not in ('server_announce', 'max_users')}
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
        line = lines[index].strip(' \t\r\n\v\f')
        index += 1
        if kind == '"""':
            if raw_line == '"""':
                return index
            continue
        if line == '}':
            return index
        if not line or line.startswith('#') or '=' not in line:
            continue
        value = line.split('=', 1)[1].strip(' \t\r\n\v\f')
        if value in ('{', '"""'):
            index = object_end(lines, index, value)
    raise ValueError('Unterminated native configuration object; existing file was retained')


def render(text, managed):
    for key, value in managed.items():
        scalar(value, key)
    lines, entries = records(text)
    output, seen = list(lines), set()
    for key, value, kind, start, index in entries:
        if key in managed:
            if key in seen:
                raise ValueError('Repeated native setting requires operator review: ' + key)
            seen.add(key)
            if kind == 'group' or key in RUNTIME_SETTINGS and kind != 'scalar':
                raise ValueError('Native scalar setting requires operator review: ' + key)
            if key in RUNTIME_SETTINGS and value != managed[key]:
                line = lines[start]
                offset = line.index('=') + 1
                while offset < len(line) and line[offset] in ' \t':
                    offset += 1
                end = len(line.rstrip(' \t\r\n\v\f'))
                output[start] = line[:offset] + managed[key] + line[end:]
    missing = [key for key in managed if key not in seen]
    newline = '\r\n' if '\r\n' in text else '\n'
    if missing and output and not output[-1].endswith(('\n', '\r')):
        output.append(newline)
    output.extend(key + ' = ' + managed[key] + newline for key in missing)
    return ''.join(output)


def configure(path, managed, expected=None):
    path = Path(path)
    if path.is_symlink() or path.exists() and not path.is_file():
        raise ValueError('Native configuration must be an ordinary file')
    old = path.read_bytes() if path.exists() else b''
    if expected is not None and old != expected:
        raise ValueError('Native configuration changed during preflight; retry with the current file')
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
            info = path.stat()
            previous_keys = {entry[0] for entry in records(old.decode('utf-8'))[1]}
            new_secret = bool(managed.get('default_password')) and 'default_password' not in previous_keys
            os.chmod(temporary, 0o600 if new_secret else info.st_mode & 0o777)
            if hasattr(os, 'chown'):
                os.chown(temporary, info.st_uid, info.st_gid)
            backup = path.with_name(path.name + '.voltra-backup-' + str(time.time_ns()))
            with os.fdopen(os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'wb') as stream:
                stream.write(old)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True


def planned_settings(root, env):
    config = contained(root, '.minetest/minetest.conf')
    if config.exists() and not config.is_file():
        raise ValueError('Native configuration must be an ordinary file')
    old = config.read_bytes() if config.exists() else b''
    text = old.decode('utf-8')
    _, entries = records(text)
    present = {}
    for key, value, kind, _, _ in entries:
        if key not in SETTING_ENV and key not in RUNTIME_SETTINGS:
            continue
        if key in present:
            raise ValueError('Repeated native setting requires operator review: ' + key)
        if kind == 'group':
            raise ValueError('Native scalar setting requires operator review: ' + key)
        present[key] = (value, kind)
    managed = dict(port=number(env, 'SERVER_PORT', 1, 65535), bind_address='0.0.0.0',
                   default_game=slug(env.get('DEFAULT_GAME', ''), 'DEFAULT_GAME'))
    for key, field in SETTING_ENV.items():
        if key in present:
            value, kind = present[key]
            if key == 'name':
                if kind != 'scalar' or not re.fullmatch(r'[A-Za-z0-9_-]{1,20}', value):
                    raise ValueError('Existing native administrator name requires operator review')
            elif key == 'max_users':
                if kind != 'scalar' or not re.fullmatch(r'[0-9]+', value) or not 1 <= int(value) <= 65535:
                    raise ValueError('Existing native player limit requires operator review')
            continue
        if key == 'max_users':
            value = number(env, field, 1, 65535)
        elif key == 'server_announce':
            value = env.get(field)
            if value not in ('true', 'false'):
                raise ValueError('SERVER_ANNOUNCE must be true or false')
        else:
            value = scalar(env.get(field, ''), field)
            if key == 'name' and not re.fullmatch(r'[A-Za-z0-9_-]{1,20}', value):
                raise ValueError('Choose a valid SERVER_ADMIN_NAME, at most 20 characters')
            if key == 'server_name' and not value:
                raise ValueError('Choose SERVER_NAME')
        managed[key] = value
    render(text, managed)  # Pure structural validation before any directory/write.
    effective_name = present['name'][0] if 'name' in present else managed['name']
    return config, managed, effective_name, old


def selected_world_game(root, world, default):
    metadata = contained(root, '.minetest/worlds/' + world + '/world.mt')
    if not metadata.exists():
        return default
    if not metadata.is_file():
        raise ValueError('Native world metadata must be an ordinary file')
    entries = [entry for entry in records(metadata.read_bytes().decode('utf-8'))[1] if entry[0] == 'gameid']
    if not entries:
        return default
    if len(entries) != 1 or entries[0][2] != 'scalar':
        raise ValueError('Native world game ID requires operator review')
    return slug(entries[0][1], 'native world game ID')


def plan_admin(root, world, env):
    enabled = env.get('BOOTSTRAP_ADMIN', '1')
    if enabled not in ('0', '1'):
        raise ValueError('BOOTSTRAP_ADMIN must be 0 or 1')
    name = env['SERVER_ADMIN_NAME']
    directory = contained(root, '.minetest/worlds/' + world)
    pending = contained(root, '.minetest/worlds/' + world + '/.voltra-admin-bootstrap.json')
    receipt = contained(root, '.minetest/worlds/' + world + '/voltra-admin-password-' + name + '.json')
    mod = contained(root, '.minetest/worlds/' + world + '/worldmods/voltra_admin_bootstrap')
    for target in (directory, mod):
        if target.exists() and not target.is_dir():
            raise ValueError('Administrator bootstrap directory needs operator review')
    for target in (pending, receipt, mod / 'mod.conf', mod / 'init.lua'):
        if target.is_symlink() or target.exists() and not target.is_file():
            raise ValueError('Administrator bootstrap file needs operator review')
    source = contained(root, '.voltra/luanti-admin.lua').read_bytes()
    definition = b'name = voltra_admin_bootstrap\ndescription = Native administrator account bootstrap\n'
    for target, content in ((mod / 'mod.conf', definition), (mod / 'init.lua', source)):
        if target.exists() and target.read_bytes() != content:
            raise ValueError('Modified administrator bootstrap mod retained; operator review required')
    password = scalar(env.get('SERVER_ADMIN_PASSWORD', ''), 'SERVER_ADMIN_PASSWORD')
    generated = not password
    if enabled == '1' and generated:
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
    return directory, pending, mod, source, definition, data


def prepare_admin(root, world, env, planned=None):
    directory, pending, mod, source, definition, data = planned or plan_admin(root, world, env)
    directory.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.luanti-admin-', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(data, stream)
        os.replace(temporary, pending)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    mod.mkdir(parents=True, exist_ok=True)
    for target, content in ((mod / 'mod.conf', definition), (mod / 'init.lua', source)):
        if not target.exists():
            target.write_bytes(content)


def launch(root, env):
    root = Path(root).resolve()
    world = slug(env.get('WORLD_NAME', ''), 'WORLD_NAME')
    config, managed, native_name, original = planned_settings(root, env)
    contained(root, '.voltra/luanti/bin/luantiserver')
    game_id = selected_world_game(root, world, managed['default_game'])
    contained(root, '.minetest/games/' + game_id + '/game.conf')
    contained(root, '.minetest/worlds/' + world)
    engine = root / '.voltra/luanti/bin/luantiserver'
    runtime_env = dict(env, LD_LIBRARY_PATH=str(root / '.voltra/luanti-libs'))
    version = subprocess.run([str(engine), '--version'], capture_output=True, text=True, check=True, env=runtime_env)
    if not version.stdout.startswith('Luanti 5.17.0 '):
        raise ValueError('The installed engine is not reviewed Luanti 5.17.0; reinstall this recipe')
    home = root / '.minetest'
    if not (home / 'games' / game_id / 'game.conf').is_file():
        raise ValueError('Upload the selected game to .minetest/games/GAME_ID, including game.conf, or reinstall with community download enabled')
    admin_env = dict(env, SERVER_ADMIN_NAME=native_name)
    admin_plan = plan_admin(root, world, admin_env)
    (home / 'worlds').mkdir(parents=True, exist_ok=True)
    (home / 'mods').mkdir(parents=True, exist_ok=True)
    configure(config, managed, expected=original)
    prepare_admin(root, world, admin_env, planned=admin_plan)
    child_env = dict(runtime_env, HOME=str(root), LUANTI_USER_PATH=str(home),
                     LUANTI_GAME_PATH=str(home / 'games'), MINETEST_GAME_PATH=str(home / 'games'),
                     VOLTRA_LUANTI_PLAIN_CONSOLE='1')
    child_env.setdefault('TERM', 'xterm')
    print('Reviewed runtime: ' + version.stdout.splitlines()[0], flush=True)
    os.chdir(root)
    os.execve(str(engine), [str(engine), '--port', managed['port'], '--gameid', game_id,
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
