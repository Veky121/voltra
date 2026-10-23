#!/usr/bin/env python3
"""MIT. Preserve native INI comments and unknown settings during managed updates."""
import os
from pathlib import Path
import re
import tempfile
import time


def patch_ini(content, sections):
    newline = '\r\n' if '\r\n' in content else '\n'
    result, seen_sections, seen_keys = [], set(), set()
    section = None

    def missing(name):
        for key, value in sections.get(name, {}).items():
            if (name, key) not in seen_keys:
                result.append(key + ' = ' + value + newline)
                seen_keys.add((name, key))

    for line in content.splitlines(keepends=True):
        header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line.strip())
        if header:
            missing(section)
            section = header.group(1)
            if section in sections and section in seen_sections:
                raise ValueError('Duplicate managed INI section: ' + section)
            seen_sections.add(section)
        elif section in sections and not line.lstrip().startswith((';', '#')) and '=' in line:
            key = line.split('=', 1)[0].strip()
            if key in sections[section]:
                if (section, key) in seen_keys:
                    raise ValueError('Duplicate managed INI key: ' + key)
                seen_keys.add((section, key))
                line = line.split('=', 1)[0] + '= ' + sections[section][key] + newline
        if result and not result[-1].endswith(('\n', '\r')):
            result[-1] += newline
        result.append(line)
    if result and not result[-1].endswith(('\n', '\r')):
        result[-1] += newline
    missing(section)
    for name in sections:
        if name not in seen_sections:
            result.append('[' + name + ']' + newline)
            missing(name)
    return ''.join(result)


def private_write(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.voltra-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as output:
            output.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def configure_ini(root, path, sections, backups):
    root = Path(root).resolve()
    path, backups = Path(path), Path(backups)
    if not all(p.resolve().is_relative_to(root) for p in (path, backups)):
        raise ValueError('Native configuration leaves the server volume')
    if path.exists():
        with path.open(encoding='utf-8', newline='') as source:previous = source.read()
    else:previous = ''
    updated = patch_ini(previous, sections)
    if updated != previous:
        if path.exists():private_write(backups / (str(time.time_ns()) + '-' + path.parent.name + '-' + path.name), previous)
        private_write(path, updated)
    else:path.chmod(0o600)
