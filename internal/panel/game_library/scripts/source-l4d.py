#!/usr/bin/env python3
"""MIT. Native L4D config footer and map-query readiness; no third-party dependencies."""
import os
import ipaddress
from pathlib import Path
import socket
import stat
import tempfile
import threading
import time
import re
import struct
import sys

FOOTER = b'\n// BEGIN VOLTRA L4D MANAGED\nexec voltra-managed.cfg\nexec voltra-variant.cfg\n// END VOLTRA L4D MANAGED\n'
READY = 'VOLTRA_L4D_MAP_READY'
INFO = b'\xff\xff\xff\xffTSource Engine Query\x00'
CONFIG_READY = 'VOLTRA_L4D_CONFIG_APPLIED'
PRIVATE_FOOTER = FOOTER.replace(b'// END', b'echo VOLTRA_L4D_CONFIG_APPLIED\n// END')


def append_footer(root, game, *, readiness_marker=False):
    root = root.resolve()
    target = root / game / 'cfg/server.cfg'
    backups = root / '.voltra/source/l4d-config-backups'
    for path in (target, backups):
        if not path.resolve().is_relative_to(root): raise ValueError('L4D configuration escapes the server volume')
    target = target.resolve()
    original = target.read_bytes() if target.exists() else b''
    footer = PRIVATE_FOOTER if readiness_marker else FOOTER
    if original.endswith(footer) and original.count(footer) == 1: return
    prefix = original.replace(PRIVATE_FOOTER, b'').replace(FOOTER, b'')
    if b'// BEGIN VOLTRA L4D MANAGED' in prefix or b'// END VOLTRA L4D MANAGED' in prefix:
        raise ValueError('Restore the marked L4D footer before changing setup settings')
    metadata = target.stat() if target.exists() else None
    if metadata:
        backups.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix='server-', suffix='.cfg', dir=backups)
        with os.fdopen(fd, 'wb') as backup: backup.write(original)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.voltra-', dir=target.parent)
    try:
        with os.fdopen(fd, 'wb') as output: output.write(prefix + footer)
        if metadata:
            os.chown(name, metadata.st_uid, metadata.st_gid)
            os.chmod(name, stat.S_IMODE(metadata.st_mode))
        else: os.chmod(name, 0o600)
        os.replace(name, target)
    finally:
        if os.path.exists(name): os.unlink(name)


def info_matches(packet, name, game_map, password):
    if len(packet) < 6 or packet[:5] != b'\xff\xff\xff\xffI': return False
    offset, fields = 6, []
    try:
        for _ in range(4):
            end = packet.index(b'\0', offset)
            fields.append(packet[offset:end].decode('utf-8', errors='strict'))
            offset = end + 1
    except (ValueError, UnicodeError): return False
    # AppID(2), players, maximum, bots, type, environment, password, VAC.
    if len(packet) < offset + 9: return False
    return fields[0] == name and fields[1] == game_map and packet[offset + 7] == int(password)


def local_query_address():
    candidates = []
    try:
        candidates = [row[4][0] for row in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_DGRAM)]
    except OSError: pass
    candidates = sorted(set(candidates), key=lambda value: ipaddress.IPv4Address(value).is_loopback)
    for candidate in candidates + ['127.0.0.1']:
        address = ipaddress.IPv4Address(candidate)
        if address.is_unspecified or address.is_multicast: continue
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                probe.bind((candidate, 0))
            return candidate
        except OSError: continue
    raise ValueError('No locally assigned IPv4 address is available for the native map query')


def query_ready(port, name, game_map, password, cancel, *, host='127.0.0.1', timeout=120, emit=print):
    deadline = time.monotonic() + timeout
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
        connection.settimeout(0.25)
        while not cancel.is_set() and time.monotonic() < deadline:
            try:
                connection.sendto(INFO, (host, port))
                packet, source = connection.recvfrom(65536)
                if source != (host, port): continue
                if packet[:5] == b'\xff\xff\xff\xffA':
                    if len(packet) != 9: continue
                    connection.sendto(INFO + packet[5:9], source)
                    packet, source = connection.recvfrom(65536)
                if source == (host, port) and info_matches(packet, name, game_map, password):
                    if not cancel.is_set(): emit(READY, flush=True)
                    return
            except (OSError, ValueError): pass
            cancel.wait(0.25)


class PrivateBoot:
    """Current-process, ordered native initialization evidence; never an auth claim."""
    def __init__(self, game_map):
        self.game_map, self.phase = game_map, 0
        self.configured, self.initialized = threading.Event(), threading.Event()
        self.pending = b''

    def feed(self, data):
        self.pending += data
        while b'\n' in self.pending:
            line, self.pending = self.pending.split(b'\n', 1)
            line = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', line).decode('utf-8', 'replace').strip()
            if 'Host_NewGame on map ' in line:
                actual = line.split('Host_NewGame on map ', 1)[1].strip().strip('"')
                self.phase = 1 if actual == self.game_map else 0
                self.configured.clear(); self.initialized.clear()
            elif line == CONFIG_READY and self.phase == 1:
                self.phase = 2; self.configured.set()
            elif line in ('VAC secure mode disabled.', 'VAC secure mode enabled.') and self.phase == 2:
                self.phase = 3; self.initialized.set()
        # A malformed/no-newline producer cannot grow this observer without bound.
        self.pending = self.pending[-8192:]


def rcon_packet(identifier, kind, body):
    payload = struct.pack('<ii', identifier, kind) + body.encode('utf-8') + b'\0\0'
    return struct.pack('<i', len(payload)) + payload


def rcon_read(connection, cancel):
    def exact(size):
        result = b''
        while len(result) < size:
            if cancel.is_set(): raise OSError('Native readiness cancelled')
            part = connection.recv(size - len(result))
            if not part: raise OSError('Native readiness connection closed')
            result += part
        return result
    size, = struct.unpack('<i', exact(4))
    if not 10 <= size <= 65536: raise ValueError('Invalid native response frame')
    data = exact(size)
    if data[-2:] != b'\0\0': raise ValueError('Invalid native response terminator')
    identifier, kind = struct.unpack('<ii', data[:8])
    return identifier, kind, data[8:-2].decode('utf-8', 'strict')


def rcon_verified(host, port, password, name, game_map, join_password, mode, cancel):
    """Private bounded authenticated status/cvar inspection. Never returns raw output."""
    with socket.create_connection((host, port), timeout=0.5) as connection:
        connection.settimeout(0.5)
        connection.sendall(rcon_packet(4101, 3, password))
        for _ in range(4):
            identifier, kind, _ = rcon_read(connection, cancel)
            if identifier == -1: return False
            if identifier == 4101 and kind == 2: break
        else: return False
        def command(identifier, text):
            connection.sendall(rcon_packet(identifier, 2, text) + rcon_packet(identifier + 1, 0, ''))
            output = ''
            for _ in range(32):
                reply, kind, body = rcon_read(connection, cancel)
                if reply == identifier + 1: return output
                if reply != identifier or kind != 0: raise ValueError('Unexpected native response')
                output += body
                if len(output) > 65536: raise ValueError('Native response exceeds readiness limit')
            raise ValueError('Native response did not terminate')
        # One static command batch avoids leaving Source's second sentinel packet
        # queued ahead of another response. No operator text enters this command.
        status = command(4200, 'status; sv_password')
        hostname = re.search(r'^hostname\s*:\s*(.*?)\s*$', status, re.M)
        native_map = re.search(r'^map\s*:\s*(\S+)', status, re.M)
        players = re.search(r'^players\s*:\s*.*?\((\d+)\s+max\)', status, re.M)
        expected_capacity = {'coop':4, 'realism':4, 'survival':4, 'versus':8, 'scavenge':8, 'teamversus':8, 'teamscavenge':8}.get(mode)
        if not hostname or hostname.group(1) != name or not native_map or native_map.group(1) != game_map: return False
        if expected_capacity and (not players or int(players.group(1)) != expected_capacity): return False
        # This value is consumed only here, before the native-console redactor.
        actual = re.search(r'"sv_password"\s*=\s*"([^"\r\n]*)"', status)
        return bool(actual and actual.group(1) == join_password)


def private_ready(boot, settings, cancel, *, host, timeout=120, emit=print):
    deadline = time.monotonic() + timeout
    while not cancel.is_set() and time.monotonic() < deadline:
        if boot.initialized.is_set():
            authenticated = settings.get('RCON_PASSWORD', '')
            try:
                mode = settings.get('CUSTOM_GAMEMODE') or settings.get('GAMEMODE', 'coop')
                verified = not authenticated or rcon_verified(host, int(settings['SERVER_PORT']), authenticated,
                    settings.get('HOSTNAME', 'Source dedicated server'), settings['SRCDS_MAP'], settings['SERVER_PASSWORD'], mode, cancel)
                if verified and boot.initialized.is_set() and not cancel.is_set():
                    emit(READY, flush=True)
                    return
            except (OSError, ValueError, UnicodeError): pass
        cancel.wait(0.25)


class ObservedOutput:
    def __init__(self, original, boot):
        self.original, self.boot = original, boot
        self.buffer = self
    def write(self, data):
        if isinstance(data, bytes):
            self.boot.feed(data)
            return self.original.buffer.write(data)
        return self.original.write(data)
    def flush(self): self.original.flush()
    def __getattr__(self, key): return getattr(self.original, key)


def run_ready(run_native, root, argv, environment, credentials, settings):
    cancel = threading.Event()
    output = sys.stdout
    host = local_query_address()
    private = settings.get('SRCDS_APPID') == '222860' and bool(settings.get('SERVER_PASSWORD'))
    if private:
        from steam_template import Redactor
        game_map = Redactor(credentials).feed(settings['SRCDS_MAP'].encode(), final=True).decode()
        boot = PrivateBoot(game_map)
        sys.stdout = ObservedOutput(output, boot)
        observer = threading.Thread(target=private_ready, args=(boot, settings, cancel), kwargs={'host':host}, daemon=True)
    else:
        observer = threading.Thread(target=query_ready, args=(int(settings['SERVER_PORT']), settings.get('HOSTNAME', 'Source dedicated server'), settings['SRCDS_MAP'], bool(settings.get('SERVER_PASSWORD', '')), cancel), kwargs={'host':host}, daemon=True)
    try:
        observer.start()
        return run_native(root, argv, environment, 'quit', credentials, terminal_input=True)
    finally:
        cancel.set()
        if observer.ident is not None: observer.join(timeout=1)
        sys.stdout = output
