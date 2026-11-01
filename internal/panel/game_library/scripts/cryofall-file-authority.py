#!/usr/bin/env python3
"""CryoFall-only native authority/preflight; shared installer and console retained."""
import os
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

DOCUMENT = 'Data/SettingsServer.xml'
FIELDS = {
    'network': {'is_public_server': 'PUBLIC_SERVER'},
    'server': {'name': 'SERVER_NAME', 'players_max_count': 'MAX_PLAYERS',
               'no_client_mods': 'NO_CLIENT_MODS', 'server_operators_list': 'SERVER_OPERATORS'},
}


def confined(root, relative):
    cursor = root
    for part in Path(relative).parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError('CryoFall paths cannot use symbolic links')
        if cursor != root / relative and cursor.exists() and not cursor.is_dir():
            raise ValueError('CryoFall parent must be a directory')
    if not cursor.resolve().is_relative_to(root):
        raise ValueError('CryoFall path leaves server volume')
    return cursor


def preflight(root, environment, require_binary=True):
    root = Path(root).absolute()
    if root.resolve() != root or root.is_symlink():
        raise ValueError('CryoFall root must be a real directory')
    effective = dict(environment)
    target = confined(root, DOCUMENT)
    backups = confined(root, '.voltra/cryofall/config-backups')
    if backups.exists() and not backups.is_dir():
        raise ValueError('CryoFall backup path must be a directory')
    if target.exists():
        if not target.is_file() or target.stat().st_size > 16 * 1024 * 1024:
            raise ValueError('Native CryoFall XML must be bounded regular file')
        data = target.read_bytes()
        decoded = data.decode('utf-16' if data.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig')
        if '<!DOCTYPE' in decoded.upper() or '<!ENTITY' in decoded.upper():
            raise ValueError('Unsupported XML declaration')
        try:
            document = ET.fromstring(data)
        except ET.ParseError:
            raise ValueError('Invalid native CryoFall XML') from None
        if document.tag != 'settings':
            raise ValueError('Expected native settings root')
        sections = set()
        for section in document:
            identity = section.tag.casefold()
            if identity not in FIELDS:
                continue
            if section.tag != identity or identity in sections:
                raise ValueError('Ambiguous native CryoFall section')
            sections.add(identity)
            recognized = set(FIELDS[identity]) | ({'port', 'ip'} if identity == 'network' else set())
            seen = set()
            for element in section:
                key = element.tag.casefold()
                if key not in recognized:
                    continue
                if key != element.tag or key in seen or len(element):
                    raise ValueError('Ambiguous native CryoFall setting')
                seen.add(key)
                if key in FIELDS[identity]:
                    effective[FIELDS[identity][key]] = element.text or ''
    if str(effective.get('SRCDS_APPID', '1061710')) != '1061710':
        raise ValueError('Unexpected CryoFall application')
    port = int(effective.get('SERVER_PORT', '0'))
    allocated = {int(value) for value in effective.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}
    if not 1 <= port <= 65535 or port not in allocated or any(not 1 <= value <= 65535 for value in allocated):
        raise ValueError('Choose allocated native UDP port')
    if any(effective.get(key, '0') not in ('0', '1') for key in ('PUBLIC_SERVER', 'NO_CLIENT_MODS')):
        raise ValueError('CryoFall flags must be 0 or 1')
    if not 1 <= int(effective.get('MAX_PLAYERS', '30')) <= 300:
        raise ValueError('CryoFall player limit must be 1..300')
    for name, maximum in (('SERVER_NAME', 64), ('SERVER_OPERATORS', 1024)):
        value = effective.get(name, 'CryoFall server' if name == 'SERVER_NAME' else '')
        if not isinstance(value, str) or len(value.encode()) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('Invalid CryoFall native text')
    for relative in ('.voltra/dotnet-6/dotnet', 'Binaries/Server/CryoFall_Server.dll'):
        binary = confined(root, relative)
        if require_binary and not binary.is_file():
            raise ValueError('Reinstall to restore CryoFall native payload')
    return effective


def main(shared=None):
    if shared is None:
        import cryofall_runtime as shared
    root, environment = Path.cwd(), dict(os.environ)
    automatic = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1'):
        raise ValueError('Invalid automatic update flag')
    effective = preflight(root, environment, require_binary=automatic != '1')
    if automatic == '1':
        shared.install(root, 'cryofall', effective, validate=False)
        effective = preflight(root, environment)
    argv, child = shared.configure(root, effective)
    return shared.run(root, argv, child, 'stop 0',
                      credentials=[effective.get(key, '') for key in ('STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')],
                      ready_marker=b'UDPServer: Socket-server listening on', terminal_input=True, terminal_query_reply=True)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError):
        print('CryoFall setup failed. Review native settings, allocations and installed payload.', file=sys.stderr)
        sys.exit(1)
