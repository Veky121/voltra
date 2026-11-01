#!/usr/bin/env python3
"""Astroneer native TCP control; no process launch, PTY, or signal supervision."""
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import secrets
import socket
import threading
import time

SECTION = '/Script/Astro.AstroServerSettings'
READY = '[INFO] Astroneer native server ready (authenticated RCON, advancing native clock, owned UDP)'
ALIASES = {'status': 'DSServerStatistics', 'players': 'DSListPlayers',
           'saves': 'DSListGames', 'save': 'DSSaveGame'}
ALLOWED = frozenset(ALIASES.values())


def native_json(line):
    def pairs(rows):
        value = {}
        for key, item in rows:
            if key in value: raise ValueError('Duplicate native response key')
            value[key] = item
        return value
    return json.loads(line, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite native response')))


def scalar(content, key):
    section = ''; found = []; sections = 0
    for line in content.splitlines():
        header = re.fullmatch(r'\s*\[([^]]+)\]\s*', line)
        if header:
            section = header[1].casefold()
            if section == SECTION.casefold(): sections += 1
            continue
        if section == SECTION.casefold() and not line.lstrip().startswith((';', '#')) and '=' in line:
            name, value = line.split('=', 1)
            if name.strip().casefold() == key.casefold(): found.append(value.strip())
    if len(found) > 1 or sections > 1: raise ValueError('Ambiguous Astroneer native control field')
    return found[0] if found else None


def owner_guid(content, seed):
    """Pure admission of the effective operator scalar, retaining original spelling."""
    value = scalar(content, 'OwnerGuid')
    if value is None: value = seed
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,20}', value):
        raise ValueError('Original owner GUID required')
    return value


def plan(content, allocated, published):
    """Pure native-file authority plan; private port must not be published/allocated."""
    address = scalar(content, 'PublicIP')
    advertised = ipaddress.IPv4Address(address) if address else None
    if advertised is None or not advertised.is_global or advertised.is_multicast:
        raise ValueError('Set the server native PublicIP to the operator advertised public address')
    excluded = set(allocated) | set(published)
    existing = scalar(content, 'ConsolePort')
    if existing is not None and existing not in ('', '0'):
        if not re.fullmatch(r'[0-9]{1,5}', existing): raise ValueError('Invalid native ConsolePort')
        port = int(existing)
        if not 1024 <= port <= 65535 or port in excluded: raise ValueError('ConsolePort must be private and unpublished')
    else:
        port = next((p for p in range(39000, 40000) if p not in excluded), None)
        if port is None: raise ValueError('No private native console port available')
    password = scalar(content, 'ConsolePassword')
    if not password: password = secrets.token_hex(24)
    if not 16 <= len(password) <= 128 or any(ord(c) < 33 or ord(c) > 126 for c in password):
        raise ValueError('Native ConsolePassword needs 16-128 printable non-space characters')
    return {'ConsolePort': str(port), 'ConsolePassword': password}


def valid_stats(value):
    if not isinstance(value, dict) or not isinstance(value.get('build'), str) or not re.fullmatch(r'[0-9]+(?:\.[0-9]+){1,4}', value['build']): return False
    for key in ('secondsInGame', 'averageFPS', 'maxInGamePlayers', 'playersInGame'):
        number = value.get(key)
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or number < 0: return False
    return 1 <= value['maxInGamePlayers'] <= 64 and value['playersInGame'] <= value['maxInGamePlayers']


def valid_players(value):
    return isinstance(value, dict) and isinstance(value.get('playerInfo'), list) and len(value['playerInfo']) <= 10000 and all(isinstance(p, dict) for p in value['playerInfo'])


def owned_udp(launch_pid, port, native_binary, proc=Path('/proc')):
    """Wine reparents the native process: bind ownership to namespace/UID/path/time."""
    try:
        namespace = os.readlink(proc/str(launch_pid)/'ns/pid')
        network = os.readlink(proc/str(launch_pid)/'ns/net')
        if namespace != os.readlink(proc/'self/ns/pid') or network != os.readlink(proc/'self/ns/net'): return False
        launch = (proc/str(launch_pid)/'stat').read_text().split(') ', 1)[1].split()
        launched = int(launch[19])
        uid = os.geteuid()
        def effective_uid(process):
            row = next(line for line in (process/'status').read_text().splitlines() if line.startswith('Uid:'))
            return int(row.split()[2])
        if effective_uid(proc/str(launch_pid)) != uid: return False
        binary = Path(native_binary).resolve()
        root = binary.parents[3]
        runtime = root/'.voltra/proton/GE-Proton11-9/files'
        allowed = {(runtime/relative).resolve() for relative in ('bin/wine64-preloader','bin/wine-preloader','bin/wine64','bin/wine','lib/wine/x86_64-unix/wine64','lib/wine/x86_64-unix/wine','lib/wine/i386-unix/wine64-preloader') if (runtime/relative).is_file()}
        if not allowed or not binary.is_file(): return False
    except (OSError, ValueError, IndexError, StopIteration): return False
    inodes = set(); matched = 0
    for process in proc.iterdir():
        if not process.name.isdigit(): continue
        try:
            if os.readlink(process/'ns/pid') != namespace or os.readlink(process/'ns/net') != network: continue
            if effective_uid(process) != uid: continue
            fields = (process/'stat').read_text().split(') ', 1)[1].split()
            if int(fields[19]) < launched: continue
            if Path(os.readlink(process/'exe')).resolve() not in allowed: continue
            arguments = (process/'cmdline').read_bytes().decode('utf-8', errors='strict').split('\0')
            paths = []
            for arg in arguments:
                value = arg.replace('\\', '/').lower()
                if value.startswith('z:'): value = value[2:]
                paths.append(value)
            if not paths or paths[0] != binary.as_posix().lower(): continue
            matched += 1
            for fd in (process/'fd').iterdir():
                try:
                    link = os.readlink(fd)
                    if re.fullmatch(r'socket:\[[0-9]+\]', link): inodes.add(link[8:-1])
                except OSError: pass
        except (OSError, ValueError, IndexError, StopIteration, UnicodeError): continue
    if matched != 1: return False
    for table in ('udp', 'udp6'):
        try:
            for line in (proc/'net'/table).read_text().splitlines()[1:]:
                fields = line.split()
                if len(fields) > 9 and int(fields[1].rsplit(':', 1)[1], 16) == port and fields[9] in inodes: return True
        except OSError: pass
    return False


class Transport:
    """One serialized persistent authenticated socket shared by polling and input."""
    def __init__(self, port, password, game_port, interval=3, timeout=3, native_binary=None):
        if not 1024 <= port <= 65535 or port == game_port: raise ValueError('Private console port required')
        self.port, self.password, self.game_port = port, password, game_port
        self.native_binary = Path(native_binary) if native_binary is not None else Path.cwd()/'Astro/Binaries/Win64/AstroServer-Win64-Shipping.exe'
        self.interval, self.timeout = interval, timeout
        self.lock = threading.Lock(); self.finished = threading.Event()
        self.socket = None; self.pending = b''; self.thread = None; self.previous = None
        self.ready = False; self.stopping = False; self.emit = lambda _: None

    def disconnect(self):
        if self.socket:
            try: self.socket.close()
            except OSError: pass
        self.socket = None; self.pending = b''

    def connect(self):
        if self.socket is None:
            self.socket = socket.create_connection(('127.0.0.1', self.port), self.timeout)
            self.socket.settimeout(self.timeout)
            self.socket.sendall((self.password+'\n').encode('utf-8'))

    def request(self, command, response=True):
        # Caller holds the one transport lock. No arbitrary command arguments.
        if command not in ALLOWED | {'DSServerShutdown'}: raise ValueError('Unsupported Astroneer console command')
        try:
            self.connect(); self.socket.sendall((command+'\n').encode('ascii'))
        except (BrokenPipeError, ConnectionResetError):
            # Commands are limited to idempotent reads/save/shutdown; never replay arbitrary input.
            self.disconnect(); self.connect(); self.socket.sendall((command+'\n').encode('ascii'))
        if not response: return None
        deadline = time.monotonic()+self.timeout
        while time.monotonic() < deadline:
            if b'\n' in self.pending:
                line, self.pending = self.pending.split(b'\n', 1)
                if not line.strip(): continue
                value = native_json(line)
                if not isinstance(value, dict): raise ValueError('Invalid native response')
                if 'status' in value and 'playerInfo' not in value and 'secondsInGame' not in value:
                    if value['status'] is False: raise ValueError('Native console refused request')
                    continue
                return value
            block = self.socket.recv(8192)
            if not block: raise ConnectionError('Native console closed')
            self.pending += block
            if len(self.pending) > 65536: raise ValueError('Native response limit')
        raise TimeoutError('Native response deadline')

    def sample(self):
        with self.lock:
            try:
                statistics = self.request('DSServerStatistics')
                players = self.request('DSListPlayers')
                if not valid_stats(statistics) or not valid_players(players): raise ValueError('Invalid native statistics/player response')
            except Exception:
                self.disconnect(); self.previous = None; raise
        current = statistics['secondsInGame']
        if not self.ready and self.previous is not None and current > self.previous and owned_udp(self.child.pid, self.game_port, self.native_binary):
            self.ready = True; self.emit(READY)
        self.previous = current
        return statistics

    def start(self, child, emit):
        self.child, self.emit = child, emit
        def poll():
            failed = False
            while not self.finished.is_set() and child.poll() is None:
                if self.stopping: break
                try:
                    stats = self.sample()
                    if failed: emit('[INFO] Astroneer native control connection restored')
                    failed = False
                except Exception:
                    if self.ready and not failed: emit('[WARN] Astroneer native control unavailable; readiness is not reconfirmed')
                    failed = True
                self.finished.wait(self.interval)
        self.thread = threading.Thread(target=poll, daemon=True); self.thread.start()

    def command(self, line):
        if line == 'help':
            self.emit('[INFO] Astroneer console: status, players, saves, save, stop'); return
        command = ALIASES.get(line, line)
        if command not in ALLOWED: self.emit('[WARN] Unsupported Astroneer console command; use help'); return
        with self.lock:
            try:
                value = self.request(command, response=command != 'DSSaveGame')
                if command == 'DSSaveGame':
                    self.emit('[INFO] Astroneer native save requested; disk completion is not yet confirmed'); return
                if command == 'DSServerStatistics':
                    if not valid_stats(value): raise ValueError('Invalid statistics')
                    safe = {k: value[k] for k in ('build', 'secondsInGame', 'playersInGame', 'maxInGamePlayers', 'averageFPS')}
                elif command == 'DSListPlayers':
                    if not valid_players(value): raise ValueError('Invalid players')
                    safe = {'knownPlayers': len(value['playerInfo']), 'inGame': sum(p.get('inGame') is True for p in value['playerInfo'])}
                else:
                    if not isinstance(value.get('gameList'), list): raise ValueError('Invalid native save list')
                    safe = {'saveCount': len(value['gameList'])}
                self.emit('[INFO] Astroneer '+command+' '+json.dumps(safe, allow_nan=False, separators=(',', ':')))
            except Exception:
                self.disconnect(); self.emit('[ERROR] Astroneer native command failed; no success was inferred')

    def stop(self):
        self.stopping = True
        with self.lock:
            try:
                self.request('DSSaveGame', response=False)
                value = self.request('DSServerStatistics')
                if not valid_stats(value): raise ValueError('No genuine native query response after save request')
                self.emit('[INFO] Astroneer native save requested and subsequent native statistics replied; disk completion unconfirmed')
            except Exception:
                self.disconnect(); self.emit('[WARN] Astroneer native save processing unconfirmed; no save success inferred')
            try:
                self.request('DSServerShutdown', response=False)
                self.emit('[INFO] Astroneer native shutdown requested; awaiting actual process exit')
            except Exception:
                self.disconnect(); self.emit('[ERROR] Astroneer native shutdown request failed; shared supervisor will retain exit/signal semantics')

    def close(self):
        self.finished.set()
        if self.thread: self.thread.join(timeout=self.timeout+1)
        with self.lock: self.disconnect()

