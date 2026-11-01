#!/usr/bin/env python3
"""MIT. Serialize native console values and retain operator configuration."""
import os
from pathlib import Path
import re
import secrets
import tempfile


def statements(text):
    """Native console separators; do not execute operator commands here."""
    # The native line reader separates CR/LF bytes, not Unicode line symbols.
    for line in re.split(r'\r\n|\r|\n', text):
        line = line.removeprefix('\ufeff')
        start, quoted, escaped = 0, False, False
        for index, char in enumerate(line):
            if escaped:
                escaped = False
                continue
            if char == '\\' and index + 1 < len(line) and line[index + 1] in '\\"':
                escaped = True
            elif char == '"':
                quoted = not quoted
            elif not quoted and char in ';#':
                if line[start:index].strip():
                    yield line[start:index].strip()
                if char == '#':
                    start = len(line)
                    break
                start = index + 1
        if quoted:
            raise ValueError('Unclosed native console quote requires operator review')
        if line[start:].strip():
            yield line[start:].strip()


def scalar(raw):
    if raw.startswith('"'):
        if len(raw) < 2 or not raw.endswith('"'):
            raise ValueError('Native scalar needs exactly one quoted argument')
        result, index = '', 1
        while index < len(raw) - 1:
            char = raw[index]
            if char == '"':
                raise ValueError('Native scalar contains extra arguments')
            if char == '\\' and index + 1 < len(raw) - 1 and raw[index + 1] in '\\"':
                index += 1
                char = raw[index]
            result += char
            index += 1
        return result
    # Native config strings use the rest-of-line argument format (?r).
    # Integer fields are separately validated as exact decimal scalars.
    if not raw:
        raise ValueError('Native scalar needs an argument')
    return raw


def quote(value, limit):
    if len(value.encode('utf-8')) > limit or any(c in value for c in '\x00\r\n'):
        raise ValueError('Native text field exceeds its UTF-8 limit or contains a control character')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def plan_settings(env, root):
    root = Path(root)
    target = root / 'autoexec.cfg'
    if target.is_symlink() or target.exists() and not target.is_file():
        raise ValueError('Native autoexec must be an ordinary file')
    original = target.read_bytes() if target.exists() else b''
    text = original.decode('utf-8')
    # Startup controls seed only missing fields. Native edits remain authoritative.
    fields = {'sv_name': ('SERVER_NAME', 'Teeworlds server', 127),
              'sv_motd': ('SERVER_MOTD', '', 899),
              'sv_map': ('SERVER_MAP', 'dm1', 127),
              'sv_gametype': ('GAME_TYPE', 'dm', 15),
              'sv_max_clients': ('MAX_PLAYERS', '16', None),
              'sv_register': ('PUBLIC_SERVER', '0', None),
              'password': ('SERVER_PASSWORD', '', 31),
              'sv_rcon_password': ('RCON_PASSWORD', '', 31)}
    values, includes = {}, False
    for command in statements(text):
        parts = command.split(None, 1)
        key = parts[0].lower()
        includes |= key in ('exec', 'exec_if', 'exec_if_exists')
        if key not in fields:
            continue
        if key in values or len(parts) != 2:
            raise ValueError('Ambiguous native setting requires operator review: ' + key)
        values[key] = scalar(parts[1])
    missing = [key for key in fields if key not in values]
    if includes and missing:
        raise ValueError('Included native configs require explicit scalar settings before seed-only initialization')
    seeds = {}
    for key in missing:
        name, default, _ = fields[key]
        seeds[key] = env.get(name, default)
    credential = root / '.voltra/teeworlds-rcon-password'
    if credential.is_symlink() or credential.exists() and not credential.is_file():
        raise ValueError('Retained RCON credential must be an ordinary file')
    if 'sv_rcon_password' in seeds and not seeds['sv_rcon_password']:
        seeds['sv_rcon_password'] = credential.read_text() if credential.exists() else secrets.token_hex(15)
    merged = {**seeds, **values}
    for key, (_, _, limit) in fields.items():
        if limit is not None:
            quote(merged[key], limit)
    if not merged['sv_rcon_password']:
        raise ValueError('An explicit empty RCON password would print a generated secret; configure a private nonempty value')
    players = int(merged['sv_max_clients'])
    if not 1 <= players <= 64 or merged['sv_register'] not in ('0', '1'):
        raise ValueError('Invalid native player limit or public listing')
    if not re.fullmatch(r'[A-Za-z0-9 _-]{1,100}', merged['sv_map']):
        raise ValueError('Choose a map basename without an extension')
    if merged['sv_gametype'] not in ('dm', 'tdm', 'ctf', 'lms', 'lts'):
        raise ValueError('Unsupported native game type')
    newline = '\r\n' if '\r\n' in text else '\r' if '\r' in text else '\n'
    addition = ''
    if seeds:
        addition = (newline if text and not text.endswith(('\r', '\n')) else '')
        for key, value in seeds.items():
            limit = fields[key][2]
            addition += key + ' ' + (quote(value, limit) if limit is not None else value) + newline
    return target, original + addition.encode('utf-8'), merged


def configure_settings(target, content):
    original = target.read_bytes() if target.exists() else b''
    if target.exists() and original == content:
        return
    def has_rcon(data):
        return any(command.split(None, 1)[0].lower() == 'sv_rcon_password'
                   for command in statements(data.decode('utf-8')))
    private_new_secret = has_rcon(content) and not has_rcon(original)
    fd, temporary = tempfile.mkstemp(prefix='.teeworlds-config-', dir=target.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        if target.exists():
            info = target.stat()
            # A newly introduced administrator secret must not make a formerly
            # nonsecret operator file group/world-readable. Existing native
            # credential files keep their operator-selected mode unchanged.
            os.chmod(temporary, 0o600 if private_new_secret else info.st_mode & 0o777)
            if hasattr(os, 'chown'):
                os.chown(temporary, info.st_uid, info.st_gid)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def arguments(env, root):
    port = int(env['SERVER_PORT'])
    if not 1 <= port <= 65535:
        raise ValueError('Invalid allocated game port')
    target, content, native = plan_settings(env, root)
    game_map = native['sv_map']
    if not any((root / p / (game_map + '.map')).is_file() for p in ('maps', 'data/maps')):
        raise ValueError('Selected map does not exist in maps or data/maps')
    configure_settings(target, content)
    commands = ['bindaddr 0.0.0.0', 'sv_port ' + str(port)]
    # The native engine loads autoexec.cfg itself before processing arguments.
    # Passing -f again would execute operator commands twice.
    return [str(root / 'teeworlds_srv'), *commands]


if __name__ == '__main__':
    root = Path.cwd()
    argv = arguments(os.environ, root)
    os.execv(argv[0], argv)
