#!/usr/bin/env python3
"""Astro Colony seed-only INI planner candidate. No filesystem or acquisition IO."""
import codecs
import re

SECTION = '/Script/ACFeature.EHServerSubsystem'
FILE = '/AstroColony/Saved/Config/LinuxServer/ServerSettings.ini'
FIELDS = {
    'ServerPassword': 'SERVER_PASSWORD', 'Seed': 'SERVER_MAPSEED',
    'MapName': 'SERVER_MAPNAME', 'MaxPlayers': 'SERVER_MAXPLAYERS',
    'ShouldLoadLatestSavegame': 'SERVER_LOADLATESTSAVEGAME',
    'AdminList': 'SERVER_ADMINS', 'SharedTechnologies': 'SERVER_SHAREDTECHNOLOGIES',
    'OxygenConsumption': 'SERVER_OXYGENCONSUMPTION', 'FreeConstruction': 'SERVER_FREECONSTRUCTION',
    'AutosaveInterval': 'SERVER_AUTOSAVEINTERVAL', 'AutosavesCount': 'SERVER_AUTOSAVESCOUNT',
}


def seed_settings(data, environment):
    """Return planned bytes, retaining existing scalar values and all unknown text.

    Case aliases in Unreal's managed section are resolved, but duplicate scalar
    identities and sections fail before the caller can publish anything. Array
    operators are not scalar aliases and are retained unchanged.
    """
    if not isinstance(data, bytes) or len(data) > 8 * 1024 * 1024:
        raise ValueError('Native settings exceeds 8 MiB')
    bom = data.startswith(codecs.BOM_UTF8)
    text = data.decode('utf-8-sig')
    if '\x00' in text:
        raise ValueError('NUL in native settings')
    lines = text.splitlines(keepends=True)
    newline = '\r\n' if '\r\n' in text else '\n'
    start = end = None
    seen = set()
    folded = {key.casefold(): key for key in FIELDS}
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith((';', '#')):
            continue
        header = re.fullmatch(r'\[([^\]]+)\]\s*(?:[;#].*)?', stripped)
        if header:
            if start is not None and end is None:
                end = index
            if header.group(1).casefold() == SECTION.casefold():
                if start is not None:
                    raise ValueError('Duplicate native settings section')
                start = index
            continue
        if start is not None and end is None and '=' in stripped:
            key = stripped.split('=', 1)[0].strip().casefold()
            if key.lstrip('+-!') == 'serverpassword' and key != 'serverpassword':
                raise ValueError('Ambiguous native password operator')
            if key in folded:
                if key in seen:
                    raise ValueError('Duplicate native setting')
                seen.add(key)
    missing = []
    for key, variable in FIELDS.items():
        if key.casefold() in seen:
            continue
        value = environment[variable]
        if not isinstance(value, str) or len(value.encode()) > 8192 or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('Invalid native setting seed')
        missing.append(key + '=' + value + newline)
    if not missing:
        return data
    if start is None:
        if lines and not lines[-1].endswith(('\n', '\r')):
            lines[-1] += newline
        lines += ['[' + SECTION + ']' + newline, *missing]
    else:
        end = len(lines) if end is None else end
        if end and not lines[end - 1].endswith(('\n', '\r')):
            lines[end - 1] += newline
        lines[end:end] = missing
    return (codecs.BOM_UTF8 if bom else b'') + ''.join(lines).encode('utf-8')
