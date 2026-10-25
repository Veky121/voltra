"""MIT. Staged isolated acceptance functions; importing this file never launches anything.

No downloader, container controller, admission override or production gate changes.
The caller must separately obtain approval and supply an owned installed payload.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import struct
import subprocess
import threading
import time
import zipfile

HERE = Path(__file__).resolve().parent
PINS = json.loads((HERE / 'fixture-pins.json').read_text())
MAX_INPUT = 4 * 1024 * 1024  # Aggregate upstream API request ceiling, framing included.


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


prepare = module('star_private_prepare', HERE.parent / 'prepare.py')


def digest(body):
    return hashlib.sha256(body).hexdigest()


def confined(root, relative):
    root = Path(root)
    path = root / relative
    if not root.is_absolute() or not path.is_relative_to(root) or '..' in Path(relative).parts:
        raise ValueError('Unconfined fixture path')
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('Fixture symlink rejected')
    return path


def checked(body, pin):
    if len(body) != pin['bytes'] or digest(body) != pin['sha256']:
        raise ValueError('Immutable fixture pin mismatch')
    return body


def amd64(body):
    if len(body) < 64 or body[:2] != b'MZ':
        raise ValueError('Missing Windows payload')
    offset = struct.unpack_from('<I', body, 60)[0]
    if offset + 26 > len(body) or body[offset:offset+4] != b'PE\0\0' or struct.unpack_from('<H', body, offset+4)[0] != 0x8664 or struct.unpack_from('<H', body, offset+24)[0] != 0x20b:
        raise ValueError('Expected AMD64 PE32+ payload')


def environment(root):
    # Allowlist, never inherit original passwords, credentials, LD_PRELOAD,
    # WINETRICKS, WINEPATH or host Wine overrides. No Microsoft license opt-in.
    root = str(root)
    return {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            'HOME': root, 'WINEPREFIX': root + '/.voltra/star-acceptance/prefix',
            'WINEARCH': 'win64', 'WINEDEBUG': '-all', 'WINEDLLOVERRIDES':
            'mscoree,mshtml=;dwmapi=n,b', 'LANG': 'C.UTF-8'}


def acquisition_plan(root):
    """Pure shared Steam argv generation; never downloads or accepts a license."""
    template = module('star_fixture_acquisition', HERE.parents[3] / 'internal/panel/game_library/scripts/steam-template.py')
    return template.arguments(Path(root), PINS['app_id'], {'STEAM_USER': 'anonymous', 'WINDOWS_INSTALL': '1'},
                              validate=True, platform='windows')


def launch_plan(root, port, image):
    if image != PINS['wine_image']:
        raise ValueError('Unreviewed Wine image')
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError('Invalid allocated native port')
    binary = confined(root, PINS['binary'])
    amd64(binary.read_bytes())
    # Exact existing canonical Star argv; no remote UE admin endpoint enabled.
    return {'argv': ['/usr/bin/xvfb-run', '-a', '/usr/bin/wine', str(binary),
                     '-Log', '-Port=' + str(port), '-RCWebControlDisable', '-RCWebInterfaceDisable'],
            'environment': environment(root), 'cwd': str(root),
            'binary_sha256': digest(binary.read_bytes()), 'native_verified': False,
            'requires_docker_init': True, 'requires_stock_entrypoint_bypass': True}


def assets(cache):
    """Validate every byte before publication; select no bundled example mods."""
    result = {}
    for archive_pin in PINS['archives']:
        body = checked((Path(cache) / archive_pin['sha256']).read_bytes(), archive_pin)
        with zipfile.ZipFile(__import__('io').BytesIO(body)) as archive:
            if archive.testzip() or sum(i.file_size for i in archive.infolist()) > 64*1024**2:
                raise ValueError('Invalid loader archive')
            for output, member in archive_pin['members'].items():
                result[output] = archive.read(member)
    for name, pin in PINS['files'].items():
        checked(result[name], pin)
    result['ue4ss/Mods/VoltraPasswordBootstrap/Scripts/main.lua'] = checked((HERE.parent / 'main.lua').read_bytes(), PINS['lua'])
    # Dedicated mod enable file avoids enabling unrelated bundled mods.
    result['ue4ss/Mods/VoltraPasswordBootstrap/enabled.txt'] = b''
    return result


def install_assets(root, content):
    """Only a fresh isolated payload. Never overwrite operator loader/mod files."""
    base = confined(root, str(Path(PINS['binary']).parent))
    targets = [(confined(base, name), body) for name, body in content.items()]
    if (base/'ue4ss').exists():
        raise ValueError('Existing loader directory requires separate review')
    if any(path.exists() for path, _ in targets):
        raise ValueError('Existing loader/mod asset requires separate review')
    for path, body in targets:
        parent = base
        for component in path.parent.relative_to(base).parts:
            parent = parent/component
            if not parent.exists(): parent.mkdir(mode=0o700)
            if not parent.is_dir() or parent.is_symlink():
                raise ValueError('Invalid owned asset directory')
        with path.open('xb') as stream:
            os.chmod(path, 0o600)
            stream.write(body)
    return base / 'ue4ss/Mods/VoltraPasswordBootstrap'


def protected_input(fd, timeout=10, cancelled=None):
    """Read one EOF-terminated protected request with a host monotonic deadline.

    Caller owns the read FD exclusively during this operation. Its descriptor
    remains open and its original status flags are restored on every path.
    """
    if os.name != 'posix':
        raise ValueError('Protected input requires the Linux node boundary')
    if type(timeout) not in (int, float) or not 0 < timeout <= 10:
        raise ValueError('Invalid protected input deadline')
    import fcntl
    import select
    info = os.fstat(fd)
    if not stat.S_ISFIFO(info.st_mode) and not (os.name == 'posix' and stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o600):
        raise ValueError('Protected FD required')
    copy = os.dup(fd)
    flags = fcntl.fcntl(copy, fcntl.F_GETFL)
    body = bytearray()
    deadline = time.monotonic() + timeout
    try:
        fcntl.fcntl(copy, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        while True:
            if cancelled is not None and cancelled.is_set():
                raise ValueError('Protected input cancelled')
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError('Protected input deadline exceeded')
            if stat.S_ISFIFO(info.st_mode):
                readable, _, _ = select.select([copy], [], [], min(remaining, .05))
                if not readable: continue
            try: part = os.read(copy, min(65536, MAX_INPUT + 1 - len(body)))
            except BlockingIOError: continue
            if not part: break
            body.extend(part)
            if len(body) > MAX_INPUT:
                raise ValueError('Aggregate API request ceiling exceeded')
        validate_input(body)
    except BaseException:
        body[:] = b'\0' * len(body)
        raise
    finally:
        try: fcntl.fcntl(copy, fcntl.F_SETFL, flags)
        finally: os.close(copy)
    return body


def validate_input(body):
    if len(body) > MAX_INPUT:
        raise ValueError('Aggregate API request ceiling exceeded')
    prepare.validate(body)


def redact(body, packet):
    # Use the shared streaming secret redactor; credentials never enter child env.
    shared = HERE.parents[3] / 'internal/panel/game_library/scripts/steam-template.py'
    template = module('star_fixture_steam_template', shared)
    offset, values = 6, []
    for _ in range(2):
        length = struct.unpack_from('<I', packet, offset)[0]; offset += 4
        if length != 0xffffffff:
            values.append(bytes(packet[offset:offset+length]).decode('utf-8')); offset += length
    return template.Redactor(values).feed(body, final=True)


def supervise(argv, cwd, env, timeout, limit=32*1024**2, stop_after=None):
    """Bounded child/process-group lifetime. Output remains private until redacted.

    This low-level seam is exercised only with harmless Python children offline.
    It does not infer readiness or retry a failed child.
    """
    if not 0 < timeout <= 180 or not 0 < limit <= 32*1024**2:
        raise ValueError('Invalid lifecycle bound')
    if stop_after is not None and (os.name != 'posix' or not 0 < stop_after < timeout):
        raise ValueError('Invalid private graceful stop deadline')
    options = {'start_new_session': True} if os.name == 'posix' else {'creationflags': subprocess.CREATE_NO_WINDOW}
    child = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **options)
    output, exceeded, license_prompt, dependency_failure = bytearray(), threading.Event(), threading.Event(), threading.Event()
    def collect():
        while True:
            part = child.stdout.read1(4096)
            if not part: break
            lowered = (bytes(output[-128:]) + part).lower()
            if b'accept the eula' in lowered or b'accept the license agreement' in lowered:
                license_prompt.set()
            if b'c0000135' in lowered or b'import_dll' in lowered or b'failed to load' in lowered:
                dependency_failure.set()
            if len(output) + len(part) > limit:
                exceeded.set()
            else: output.extend(part)
    reader = threading.Thread(target=collect, daemon=True); reader.start()
    deadline = time.monotonic() + timeout
    reason, stopped = None, False
    try:
        while child.poll() is None:
            if license_prompt.is_set() or dependency_failure.is_set() or exceeded.is_set() or time.monotonic() >= deadline:
                reason = 'runtime_license_prompt' if license_prompt.is_set() else 'missing_native_dependency' if dependency_failure.is_set() else 'output_limit' if exceeded.is_set() else 'timeout'
                break
            if stop_after is not None and not stopped and time.monotonic() >= deadline-timeout+stop_after:
                try: os.killpg(child.pid, signal.SIGINT)
                except ProcessLookupError: pass
                stopped = True
            time.sleep(0.02)
    finally:
        # Kill the owned group even if the leader exited but descendants retain
        # the pipe. No host/global process-name killing.
        if os.name == 'posix':
            try: os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError: pass
        elif child.poll() is None: child.kill()
        child.wait(timeout=3); reader.join(timeout=3); child.stdout.close()
    if reader.is_alive(): raise ValueError('Child pipe cleanup incomplete')
    if exceeded.is_set(): reason = 'output_limit'
    return {'raw_exit': child.returncode, 'failure': reason, 'output': bytes(output), 'graceful_stop_requested':stopped}


def run_once(mod_directory, packet, argv, cwd, env, timeout=180, stop_after=None):
    """Future approved invocation only. One durable attempt marker; no replay."""
    validate_input(packet)
    if any(key in env for key in ('ADMIN_PASSWORD', 'PLAYER_PASSWORD', 'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'WINETRICKS_RUN', 'ACCEPT_WINDOWS_RUNTIME_LICENSES')):
        raise ValueError('Secret or installer environment rejected')
    prepare.private_directory(mod_directory)
    marker = Path(mod_directory) / 'acceptance-attempted'
    descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.close(descriptor)
    request = Path(mod_directory) / 'request.bin'
    staged = False
    try:
        prepare.stage(mod_directory, packet)
        staged = True
        result = supervise(argv, cwd, env, timeout, stop_after=stop_after)
        lower = result['output'].lower()
        if b'c0000135' in lower or b'import_dll' in lower or b'failed to load' in lower:
            result['failure'] = result['failure'] or 'missing_native_dependency'
        elif result['raw_exit'] != 0:
            result['failure'] = result['failure'] or 'native_nonzero_exit'
        result['output'] = redact(result['output'], packet)
        result['native_encrypted_files_verified'] = False
        return result
    finally:
        if staged: request.unlink(missing_ok=True)
        if isinstance(packet, bytearray): packet[:] = b'\0' * len(packet)


if __name__ == '__main__':
    raise SystemExit('Staged library only: native execution requires separate root approval')
