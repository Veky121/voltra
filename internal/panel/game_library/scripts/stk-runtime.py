#!/usr/bin/env python3
"""MIT. STK LAN discovery configuration using its supported --stk-config.

Only source/offline fixtures verified. This helper does not establish native
readiness, discovery replies, shutdown, or permission to retry a blocked run.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import xml.etree.ElementTree as ET

from small_games_family_runtime import configure as family_configure
from native_console import run

GENERATED = 'voltra-stk-network.xml'
MAX_XML = 1024 * 1024


def number(value):
    if not isinstance(value, str) or not re.fullmatch(r'[1-9][0-9]{0,4}', value) or int(value) > 65535:
        raise ValueError('STK ports must be canonical integers from 1 through 65535')
    return int(value)


def select_ports(environment):
    primary = number(environment.get('SERVER_PORT', ''))
    raw = environment.get('VOLTRA_ALLOCATED_PORTS', '')
    ports = [number(value) for value in raw.split(',')]
    if len(ports) != len(set(ports)) or len(ports) < 2 or primary not in ports:
        raise ValueError('STK LAN requires two distinct selected allocations on the same address')
    supplied = environment.get('DISCOVERY_PORT', '')
    discovery = number(supplied) if supplied else min(port for port in ports if port != primary)
    if discovery == primary or discovery not in ports:
        raise ValueError('STK discovery port must be a separate selected allocation')
    return primary, discovery


def network_config(source, primary, discovery):
    if len(source) > MAX_XML or b'<!DOCTYPE' in source.upper() or b'<!ENTITY' in source.upper():
        raise ValueError('STK stock configuration is too large or contains unsupported XML declarations')
    try:
        document = ET.fromstring(source)
    except ET.ParseError as error:
        raise ValueError('STK stock configuration is not valid XML') from error
    nodes = document.findall('network-ports')
    if document.tag != 'config' or len(nodes) != 1:
        raise ValueError('STK stock configuration needs exactly one network-ports element')
    required = ('server-discovery-port', 'client-port', 'server-port')
    original = {key: number(nodes[0].attrib.get(key, '')) for key in required}
    if len(set(original.values())) != 3:
        raise ValueError('STK stock network defaults must be distinct')
    # This is the engine's CLIENT default, not a third server listener. Preserve
    # its semantics; STKConfig rejects collisions between all three defaults.
    client = original['client-port']
    if client in (primary, discovery):
        raise ValueError('STK listener conflicts with the stock client-port; select a different allocation')
    values = {'server-discovery-port': discovery, 'client-port': client, 'server-port': primary}
    text = source.decode('utf-8')
    pattern = r'<network-ports\b[^<>]*/>'
    matches = list(re.finditer(pattern, text))
    if len(matches) != 1:
        raise ValueError('STK network-ports layout is unsupported; original configuration preserved')
    node = matches[0].group()
    for key, value in values.items():
        node, count = re.subn(r'(\b' + re.escape(key) + r'\s*=\s*[\'"])[0-9]+([\'"])',
                              lambda match: match[1] + str(value) + match[2], node)
        if count != 1:
            raise ValueError('STK network-ports attribute layout is unsupported')
    updated = (text[:matches[0].start()] + node + text[matches[0].end():]).encode('utf-8')
    parsed = ET.fromstring(updated).find('network-ports')
    if any(parsed.attrib[key] != str(value) for key, value in values.items()):
        raise ValueError('STK generated port configuration failed verification')
    return updated, values


def confined(root, relative):
    current = root
    for part in Path(relative).parts:
        if part in ('.', '..') or '/' in part or '\\' in part or ':' in part:
            raise ValueError('Invalid STK managed path')
        current = current / part
        if current.is_symlink():
            raise ValueError('STK managed paths must not contain symlinks')
    return current


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def sync_directory(directory):
    if os.name != 'nt':
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def atomic_write(path, content, previous, default_mode):
    descriptor, name = tempfile.mkstemp(prefix='.stk-write-', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        if previous is not None and os.name != 'nt':
            os.chown(temporary, previous.st_uid, previous.st_gid)
        os.chmod(temporary, stat.S_IMODE(previous.st_mode) if previous is not None else default_mode)
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()


def prepare_config(root, primary, discovery):
    stock = confined(root, 'stk/data/stk_config.xml')
    generated = confined(root, 'stk/data/' + GENERATED)
    receipt = confined(root, '.voltra/stk-discovery.json')
    with stock.open('rb') as stream:
        source = stream.read(MAX_XML + 1)
    updated, values = network_config(source, primary, discovery)
    old = None
    receipt_bytes = None
    if receipt.exists():
        try:
            with receipt.open('rb') as stream:
                receipt_bytes = stream.read(65537)
            if len(receipt_bytes) > 65536:
                raise ValueError()
            old = json.loads(receipt_bytes)
            if old['format'] != 1 or old['path'] != 'stk/data/' + GENERATED:
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise ValueError('STK managed discovery receipt is invalid; inspect before starting') from None
    previous_stat = generated.stat() if generated.exists() else None
    if previous_stat is not None and previous_stat.st_size > MAX_XML:
        raise ValueError('STK generated discovery configuration is oversized')
    previous_bytes = generated.read_bytes() if previous_stat is not None else None
    receipt_stat = receipt.stat() if receipt.exists() else None
    if previous_bytes is not None and (old is None or sha256(previous_bytes) != old.get('sha256')):
        raise ValueError('STK generated discovery configuration was operator-modified or is unowned; inspect before starting')
    content = (json.dumps({'format': 1, 'path': 'stk/data/' + GENERATED, 'sha256': sha256(updated),
                          'stock_sha256': sha256(source), 'ports': values}, sort_keys=True) + '\n').encode()
    if previous_bytes == updated and receipt.exists() and receipt.read_bytes() == content:
        return
    receipt.parent.mkdir(parents=True, exist_ok=True)
    try:
        atomic_write(generated, updated, previous_stat, 0o644)
        atomic_write(receipt, content, receipt_stat, 0o600)
    except BaseException:
        # In-process publication failure preserves the previous configuration.
        # A process/power interruption is fail-closed on receipt hash mismatch;
        # no automatic repair or native start is inferred from partial state.
        if receipt_bytes is None:
            receipt.unlink(missing_ok=True)
        else:
            atomic_write(receipt, receipt_bytes, receipt_stat, 0o600)
        if previous_bytes is None:
            generated.unlink(missing_ok=True)
        else:
            atomic_write(generated, previous_bytes, previous_stat, 0o644)
        raise


def configure(root, environment):
    root = Path(root).absolute()
    if root.resolve() != root or root.is_symlink():
        raise ValueError('STK server root must not contain symlinks')
    primary, discovery = select_ports(environment)
    if discovery != 2757:
        print('STK uses custom discovery UDP port %d. Stock LAN discovery expects 2757; configure a matching client discovery port or use an explicit direct server address. Native/client discovery compatibility is not verified.' % discovery, flush=True)
    cwd, argv, child_environment, stop, credentials, ready = family_configure(root, 'stk', environment)
    prepare_config(root, primary, discovery)
    argv.append('--stk-config=' + GENERATED)
    return cwd, argv, child_environment, stop, credentials, ready


if __name__ == '__main__':
    cwd, argv, environment, stop, credentials, ready = configure(Path.cwd(), dict(os.environ))
    sys.exit(run(cwd, argv, environment, stop, credentials, ready_marker=ready.encode(),
                 terminal_input=True, terminal_query_reply=True))
