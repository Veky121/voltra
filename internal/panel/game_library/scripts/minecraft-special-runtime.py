#!/usr/bin/env python3
"""MIT. Cuberite's native INI keys must not have Wings alignment whitespace."""
import os
from pathlib import Path
import re
from native_config import private_write


def native_ini(content, sections):
    result, seen, visited = [], set(), set()
    section = None

    def missing(name):
        for key, value in sections.get(name, {}).items():
            if (name, key) not in seen:
                result.append(key + '=' + value + '\n')
                seen.add((name, key))

    for line in content.splitlines():
        header = re.fullmatch(r'\s*\[([^]]+)\]\s*(?:[;#].*)?', line)
        if header:
            missing(section)
            section = header[1]
            visited.add(section)
        elif '=' in line and not line.lstrip().startswith((';', '#')):
            key, value = line.split('=', 1)
            key = key.strip()
            if key in sections.get(section, {}):
                if (section, key) in seen:
                    continue
                value = sections[section][key]
                seen.add((section, key))
            # Cuberite's parser does not trim key alignment written by Wings.
            # Preserve duplicate Plugin keys and unknown values, unlike INI maps.
            line = key + '=' + value
        result.append(line + '\n')
    missing(section)
    for name in sections:
        if name not in visited:
            result.append('[' + name + ']\n')
            missing(name)
    return ''.join(result)


def configure(root, env):
    port, web = env.get('SERVER_PORT', ''), env.get('WEB_PORT', '')
    for value in (port, web):
        if not re.fullmatch(r'[1-9][0-9]{0,4}', value) or int(value) > 65535:
            raise ValueError('Choose valid allocated native ports')
    if port == web:
        raise ValueError('WebAdmin must use a distinct additional allocation')
    description, password = env.get('SERV_DESC', ''), env.get('ADMIN_PASS', '')
    if len(password) < 12 or any(ord(c) < 32 or ord(c) == 127 for c in description + password):
        raise ValueError('Use a private operator password and single-line description')
    mappings = {'settings.ini': {'Server': {'Ports': port, 'Description': description}},
                'webadmin.ini': {'WebAdmin': {'Ports': web}, 'User:admin': {'Password': password}}}
    paths = [root / name for name in mappings]
    if any(not path.resolve().is_relative_to(root) for path in paths):
        raise ValueError('Native settings must stay in this volume')
    for name, sections in mappings.items():
        path = root / name
        private_write(path, native_ini(path.read_text() if path.exists() else '', sections))


if __name__ == '__main__':
    root = Path.cwd().resolve()
    configure(root, os.environ)
    os.execv(str(root / 'Cuberite'), [str(root / 'Cuberite')])
