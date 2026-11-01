#!/usr/bin/env python3
"""Barotrauma native setting authority; shared installer and console retained."""
import os
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ATTRIBUTES = {'servername': 'SERVER_NAME', 'password': 'SERVER_PASSWORD', 'maxplayers': 'MAX_PLAYERS', 'ispublic': 'PUBLIC_SERVER'}
IDENTITIES = set(ATTRIBUTES) | {'port', 'queryport', 'enableupnp'}


def native_environment(root, environment):
    root = Path(root).resolve()
    target = root / 'serversettings.xml'
    effective = dict(environment)
    if target.is_symlink() or not target.resolve().is_relative_to(root):
        raise ValueError('Native Barotrauma configuration leaves the volume')
    if target.exists():
        if not target.is_file() or target.stat().st_size > 8 * 1024 * 1024:
            raise ValueError('Invalid Barotrauma native configuration')
        data = target.read_text(encoding='utf-8-sig')
        if '<!DOCTYPE' in data.upper() or '<!ENTITY' in data.upper():
            raise ValueError('Unsupported XML declarations')
        element = ET.fromstring(data)
        if element.tag.lower() != 'serversettings':
            raise ValueError('Expected native serversettings XML root')
        seen = set()
        for name, value in element.attrib.items():
            key = name.lower()
            if key not in IDENTITIES:
                continue
            if key in seen:
                raise ValueError('Ambiguous native Barotrauma attribute')
            seen.add(key)
            if key in ATTRIBUTES:
                if key == 'ispublic':
                    if value.lower() not in ('true', 'false'):
                        raise ValueError('Invalid native public flag')
                    value = '1' if value.lower() == 'true' else '0'
                effective[ATTRIBUTES[key]] = value
    # These checks happen before acquisition as well as shared configuration.
    for name, limit in (('SERVER_NAME', 60), ('SERVER_PASSWORD', 128)):
        value = effective.get(name, 'Barotrauma server' if name == 'SERVER_NAME' else '')
        if len(value.encode()) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('Invalid native text setting')
    if not 1 <= int(effective.get('MAX_PLAYERS', '8')) <= 16:
        raise ValueError('Invalid maximum players')
    if effective.get('PUBLIC_SERVER', '0') not in ('0', '1'):
        raise ValueError('Invalid public flag')
    return effective


def validate_ports(environment):
    """Read-only mirror of the shared runtime's allocation selection."""
    primary = int(environment.get('SERVER_PORT', ''))
    ports = sorted({int(port) for port in environment.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if port})
    if not 1 <= primary <= 65535 or primary not in ports or len(ports) < 2 or any(not 1 <= port <= 65535 for port in ports):
        raise ValueError('Choose two allocated native ports')
    query = int(environment.get('QUERY_PORT') or next(port for port in ports if port != primary))
    if query == primary or query not in ports:
        raise ValueError('Query port must be a distinct allocated port')
    return primary, query


def main():
    import barotrauma_runtime as shared
    root = Path.cwd()
    environment = native_environment(root, os.environ)
    auto = environment.get('VOLTRA_STEAM_AUTO_UPDATE', '0')
    if auto not in ('0', '1'):
        raise ValueError('Invalid automatic update flag')
    validate_ports(environment)
    if auto == '1':
        shared.install(root, 'barotrauma', environment, validate=False)
    binary = root / 'DedicatedServer'
    if binary.is_symlink() or not binary.is_file() or not binary.resolve().is_relative_to(root):
        raise ValueError('Steam installation is missing a confined DedicatedServer')
    argv, child, credentials = shared.configure(root, environment)
    return shared.run(root, argv, child, 'quit', credentials=credentials, ready_marker=b'Server started', terminal_input=True, terminal_query_reply=True)


if __name__ == '__main__':
    sys.exit(main())
