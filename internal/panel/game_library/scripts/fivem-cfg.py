#!/usr/bin/env python3
"""Conservative FXServer cfg adapter. Unsupported syntax stays in Files."""
import re

MANAGED = {'endpoint_add_tcp', 'endpoint_add_udp', 'sv_hostname', 'sv_maxclients',
           'sv_maxplayers', 'sv_licensekey', 'steam_webapikey', 'sv_lan', 'gamename'}
FIELDS = {'sv_hostname': {'type': 'string', 'max_length': 128},
          'sv_maxclients': {'type': 'integer', 'minimum': 1, 'maximum': 48},
          'sv_lan': {'type': 'boolean'}}

def refused():
    return ValueError('Executable or ambiguous server.cfg cannot be edited safely; use the plain Files editor. No configuration was changed.')

def parse(raw):
    if len(raw.encode('utf-8')) > 1024 * 1024 or any(ord(c) < 32 and c not in '\r\n\t' for c in raw):
        raise refused()
    rows = []
    seen = set()
    for line in raw.splitlines(keepends=True):
        tokens = []
        i = 0
        while i < len(line):
            if line[i].isspace():
                i += 1
                continue
            if line[i] == '#' or line[i:i+2] == '//':
                break
            start = i
            if line[i] == '"':
                i += 1
                while i < len(line) and line[i] != '"':
                    if line[i] == '\\':
                        i += 1
                        if i >= len(line) or line[i] not in ('"', '\\'):
                            raise refused()
                    if line[i] in '\r\n':
                        raise refused()
                    i += 1
                if i >= len(line):
                    raise refused()
                i += 1
                if i < len(line) and not line[i].isspace() and line[i] != '#':
                    raise refused()
            else:
                while i < len(line) and not line[i].isspace() and line[i] != '#':
                    if line[i] in ';"\\':
                        raise refused()
                    i += 1
            tokens.append((line[start:i], start, i))
        key = None
        value = None
        if tokens:
            command = tokens[0][0].lower()
            # exec may load later overrides or resource-local cfg. Never flatten it.
            if command in ('exec', 'vstr') or command.startswith('+'):
                raise refused()
            index = 1 if command in ('set', 'setr', 'sets') else 0
            if len(tokens) > index:
                candidate = tokens[index][0].lower()
                if candidate in MANAGED:
                    if len(tokens) != index + 2 or candidate in seen:
                        raise refused()
                    key = candidate
                    value = tokens[index+1]
                    seen.add(key)
        rows.append((line, key, value))
    if 'sv_maxclients' in seen and 'sv_maxplayers' in seen:
        raise refused()
    return rows

def render(raw, values):
    rows = parse(raw)
    remaining = dict(values)
    result = []
    for line, key, token in rows:
        canonical = 'sv_maxclients' if key == 'sv_maxplayers' else key
        if canonical in remaining:
            value = remaining.pop(canonical)
            line = line[:token[1]] + value + line[token[2]:]
        result.append(line)
    text = ''.join(result)
    newline = '\r\n' if '\r\n' in raw else '\n'
    if remaining and text and not text.endswith(('\n', '\r')):
        text += newline
    for key, value in remaining.items():
        prefix = 'set ' if key in ('sv_lan', 'gamename', 'steam_webapikey') else ''
        spelling = {'sv_licensekey': 'sv_licenseKey', 'steam_webapikey': 'steam_webApiKey'}.get(key, key)
        text += prefix + spelling + ' ' + value + newline
    return text


def typed_values(raw):
    """Expose only supported nonsecret scalar fields; never return unknown convars."""
    result = {}
    for line, key, token in parse(raw):
        if key not in FIELDS:
            continue
        value = token[0]
        if value.startswith('"'):
            value = value[1:-1].replace('\\"', '"').replace('\\\\', '\\')
        if key == 'sv_maxclients':
            if not re.fullmatch(r'[0-9]+', value) or not 1 <= int(value) <= 48:
                raise refused()
            value = int(value)
        elif key == 'sv_lan':
            if value not in ('true', 'false', '0', '1'):
                raise refused()
            value = value in ('true', '1')
        elif len(value.encode("utf-8")) > 128:
            raise refused()
        result[key] = value
    return result


def typed_patch(raw, changes):
    typed_values(raw)
    values = {}
    for key, value in changes.items():
        if key not in FIELDS:
            raise refused()
        if key == 'sv_maxclients':
            if type(value) is not int or not 1 <= value <= 48:
                raise refused()
            values[key] = str(value)
        elif key == 'sv_lan':
            if type(value) is not bool:
                raise refused()
            values[key] = 'true' if value else 'false'
        else:
            if not isinstance(value, str) or len(value.encode("utf-8")) > 128 or any(ord(c) < 32 or ord(c) == 127 for c in value):
                raise refused()
            values[key] = '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'
    return render(raw, values)


def native_environment(raw, env):
    """Existing native scalars own game settings and credentials; allocations do not."""
    result = dict(env)
    game = env.get('TXHOST_GAME_NAME', env.get('VOLTRA_CFX_GAME', 'fivem'))
    mapping = {'sv_hostname': 'SERVER_HOSTNAME', 'sv_maxclients': 'MAX_PLAYERS',
               'sv_maxplayers': 'MAX_PLAYERS', 'sv_licensekey': 'FIVEM_LICENSE',
               'steam_webapikey': 'STEAM_WEBAPIKEY', 'sv_lan': 'LAN_ONLY'}
    for line, key, token in parse(raw):
        if key not in mapping and key != 'gamename':
            continue
        value = token[0]
        if value.startswith('"'):
            value = value[1:-1].replace('\\"', '"').replace('\\\\', '\\')
        if key == 'gamename':
            if value != ('rdr3' if game == 'redm' else 'gta5'):
                raise refused()
        elif key == 'sv_lan':
            if value not in ('true', 'false', '0', '1'):
                raise refused()
            result[mapping[key]] = '1' if value in ('true', '1') else '0'
        else:
            result[mapping[key]] = value
    return result
