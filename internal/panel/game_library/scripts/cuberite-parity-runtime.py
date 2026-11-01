#!/usr/bin/env python3
"""Cuberite-only file-authoritative bootstrap. No synthetic lifecycle output."""
import os
from pathlib import Path
import re
import tempfile


def section_name(line, first=False):
    if first:
        line = line.removeprefix('\ufeff')
    match = re.fullmatch(r'\s*\[([^]]+)\]\s*(?:[;#].*)?', line.rstrip('\r\n'))
    return match[1] if match else None


def native_case(text):
    # Native cIniFile enables case-insensitive matching. Managed names are
    # ASCII; do not equate unrelated Unicode operator names with those keys.
    return ''.join(chr(ord(c) + 32) if 'A' <= c <= 'Z' else c for c in text)


def values(text):
    section = None
    result = {}
    for index, line in enumerate(text.splitlines()):
        header = section_name(line, index == 0)
        if header is not None:
            section = header
        elif '=' in line and not line.lstrip().startswith((';', '#')):
            key, value = line.split('=', 1)
            result.setdefault((section, key.strip()), []).append(value)
    return result


def canonical_port_name(content, section_name_value, old_name):
    # ReadUpgradeIniPorts compares each enumerated name with literal "Ports",
    # unlike cIniFile's general case-insensitive scalar lookup.
    section = None
    lines = []
    for index, line in enumerate(content.splitlines(keepends=True)):
        header = section_name(line, index == 0)
        if header is not None:
            section = header
        elif section == section_name_value and '=' in line and not line.lstrip().startswith((';', '#')):
            name, separator, suffix = line.partition('=')
            if name == old_name:
                line = 'Ports' + separator + suffix
        lines.append(line)
    return ''.join(lines)


def plan_configuration(root, env, fresh=()):
    """Validate and prepare edits without acquisition or filesystem publication."""
    root = Path(root).resolve()
    ports = [env.get('SERVER_PORT', ''), env.get('WEB_PORT', '')]
    if any(not re.fullmatch(r'[1-9][0-9]{0,4}', p) or int(p) > 65535 for p in ports) or ports[0] == ports[1]:
        raise ValueError('Cuberite needs distinct allocated game and WebAdmin TCP ports')
    mapping = {'settings.ini': {('Server', 'Ports'): ports[0], ('Server', 'Description'): env.get('SERV_DESC', '')},
               'webadmin.ini': {('WebAdmin', 'Ports'): ports[1], ('User:admin', 'Password'): env.get('ADMIN_PASS', '')}}
    prepared = []
    for name, seeds in mapping.items():
        target = root / name
        if target.is_symlink() or target.exists() and not target.is_file():
            raise ValueError('Cuberite settings must be regular files')
        content = target.read_bytes().decode('utf-8') if target.exists() else ''
        # Cuberite preserves whitespace in key names; padded managed keys
        # would be ignored and native defaults would silently open other ports.
        section = None
        managed = {(native_case(s), native_case(k)) for s, k in seeds}
        for index, line in enumerate(content.splitlines()):
            header = section_name(line, index == 0)
            if header is not None:
                section = header
            elif '=' in line and not line.lstrip().startswith((';', '#')):
                raw_key = line.split('=', 1)[0]
                if section is not None and (native_case(section), native_case(raw_key.strip())) in managed and raw_key != raw_key.strip():
                    raise ValueError('Managed Cuberite keys must not contain alignment whitespace')
        current = values(content)
        # Resolve only managed identities using the publisher's matching rules.
        # Existing spelling and unrelated duplicate plugin rows stay untouched.
        headers = [header for index, line in enumerate(content.splitlines())
                   if (header := section_name(line, index == 0)) is not None]
        resolved = {}
        for key, value in seeds.items():
            sections = [header for header in headers if native_case(header) == native_case(key[0])]
            aliases = [actual for actual in current if actual[0] is not None
                       and native_case(actual[0]) == native_case(key[0])
                       and native_case(actual[1]) == native_case(key[1])]
            if len(sections) > 1 or len(aliases) > 1:
                raise ValueError('Duplicate managed Cuberite aliases require operator review')
            actual = aliases[0] if aliases else (sections[0] if sections else key[0], key[1])
            if native_case(key[1]) == 'ports' and actual[1] != 'Ports':
                content = canonical_port_name(content, actual[0], actual[1])
                current = values(content)
                actual = (actual[0], 'Ports')
            resolved[actual] = value
        seeds = resolved
        edits = {k: v for k, v in seeds.items() if name in fresh or k not in current}
        for key, value in edits.items():
            if any(ord(c) < 32 or ord(c) == 127 for c in value):
                raise ValueError('Cuberite seed must be single-line text')
            if native_case(key[1]) == 'password' and len(value) < 12:
                raise ValueError('Choose a private WebAdmin password of at least 12 characters')
        # An existing file is authoritative. Never normalize unknown keys or duplicates.
        for key, value in edits.items():
            if key in current:
                section = None
                lines = []
                for index, line in enumerate(content.splitlines(keepends=True)):
                    header = section_name(line, index == 0)
                    if header is not None: section = header
                    if section == key[0] and '=' in line and line.split('=', 1)[0].strip() == key[1]:
                        ending = '\r\n' if line.endswith('\r\n') else '\n' if line.endswith('\n') else ''
                        line = key[1] + '=' + value + ending
                    lines.append(line)
                content = ''.join(lines)
            else:
                newline = '\r\n' if '\r\n' in content else '\n'
                end = None
                offset = 0
                for index, line in enumerate(content.splitlines(keepends=True)):
                    if section_name(line, index == 0) == key[0]:
                        end = offset + len(line)
                        if not line.endswith('\n'):
                            content = content[:end] + newline + content[end:]
                            end += len(newline)
                        break
                    offset += len(line)
                if end is not None:
                    content = content[:end] + key[1] + '=' + value + newline + content[end:]
                else:
                    content += ('\n' if content and not content.endswith('\n') else '') + '[' + key[0] + ']\n' + key[1] + '=' + value + '\n'
        for key in seeds:
            found = values(content).get(key, [])
            if len(found) != 1:
                raise ValueError('Duplicate managed Cuberite setting requires operator review')
            if native_case(key[1]) == 'password' and len(found[0]) < 12:
                raise ValueError('Existing WebAdmin password needs operator review before start')
            if native_case(key[1]) == 'ports' and found[0].strip() != seeds[key]:
                raise ValueError('Native port differs from allocation; reconcile settings before start')
        if content.encode() != (target.read_bytes() if target.exists() else b''):
            prepared.append((target, content, target.stat().st_mode & 0o777 if target.exists() else 0o600))
    return prepared


def configure(root, env, fresh=()):
    root = Path(root).resolve()
    prepared = plan_configuration(root, env, fresh)
    for target, content, mode in prepared:
        fd, temporary = tempfile.mkstemp(prefix='.cuberite-', dir=root)
        try:
            with os.fdopen(fd, 'wb') as output:
                output.write(content.encode()); output.flush(); os.fsync(output.fileno())
            os.chmod(temporary, mode)
            if target.exists() and hasattr(os, 'chown'):
                info = target.stat(); os.chown(temporary, info.st_uid, info.st_gid)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)


if __name__ == '__main__':
    root = Path.cwd().resolve()
    configure(root, os.environ)
    os.execv(str(root / 'Cuberite'), [str(root / 'Cuberite')])
