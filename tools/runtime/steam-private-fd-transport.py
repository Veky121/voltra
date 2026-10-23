#!/usr/bin/env python3
"""MIT. Experimental Linux SteamCMD memfd runner. NOT a credential capability.

The Steam command-language codec remains unproved for quotes. This module does
not construct login/app_update commands, enable private APIs, or return output.
Only the explicit public-parser probe may observe captured output in memory.
"""
import fcntl
from contextlib import ExitStack
import os
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import tempfile
import time


class TransportError(RuntimeError):
    pass


def validate_literal(value, maximum=1024):
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise TransportError('Invalid Steam literal length')
    try:
        value.encode('utf-8', errors='strict')
    except UnicodeError:
        raise TransportError('Invalid Steam literal encoding') from None
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise TransportError('Steam literals cannot contain control characters')
    return value


def experimental_token(value):
    """Preserve supported tokens; refuse unsupported quotes without substitution.

    This deliberately cannot enable the requested full credential range. A
    caller must not silently reject/alter an existing accepted secret to use it.
    """
    validate_literal(value)
    if '"' in value:
        raise TransportError('Steam quote fidelity is not proved')
    return '"' + value + '"'


def _terminate(child):
    # The launcher and native child share our new session, never the host group.
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        child.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait(timeout=2)
    # Reap remaining grandchildren even if the immediate shell already exited.
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def run_script(executable, script, *, parent, timeout=30, cancel=None,
               public_probe_observer=None, output_limit=2 * 1024**2):
    """Run an inherited sealed anonymous file, in disposable private HOME/cwd.

    No caller environment is inherited. No output, script or exception payload
    is persisted or returned. Public observer is TEST ONLY; never pass it when
    processing private credentials. Timeout/cancellation kill the whole group.
    Linux /proc access is required. Same-UID/root process inspection remains an
    OS boundary; a private transport cannot defend against a hostile host UID.
    """
    if not hasattr(os, 'memfd_create') or not Path('/proc/self/fd').is_dir():
        raise TransportError('Linux anonymous file transport unavailable')
    if not isinstance(script, bytes) or len(script) > 64 * 1024:
        raise TransportError('Invalid Steam script')
    if not 0 < timeout <= 300 or not 1 <= output_limit <= 4 * 1024**2:
        raise TransportError('Invalid transport limits')
    executable = Path(executable).resolve(strict=True)
    metadata = executable.parent.stat()
    if metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) & 0o077:
        # SteamCMD writes logs/config relative to its own launcher directory,
        # even when HOME/cwd are private. Never use a shared/public executable.
        raise TransportError('Steam program copy must be in an owned private directory')
    parent = Path(parent)
    if parent.is_symlink() or not parent.is_dir():
        raise TransportError('Invalid private transport parent')
    fd = os.memfd_create('voltra-steam-script', os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
    child = None
    selector = selectors.DefaultSelector()
    output = bytearray()
    try:
        os.write(fd, script)
        os.lseek(fd, 0, os.SEEK_SET)
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW |
                    fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL)
        with tempfile.TemporaryDirectory(prefix='steam-private-', dir=parent) as temporary, ExitStack() as processes:
            os.chmod(temporary, 0o700)
            environment = {'HOME': temporary, 'USER': 'container',
                           'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8'}
            # Dedicated transport worker only: preexec_fn must not be used from
            # a threaded service. Integration must invoke this helper process.
            child = subprocess.Popen([str(executable), '+runscript', '/proc/self/fd/' + str(fd)],
                cwd=temporary, env=environment, pass_fds=(fd,), stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
                preexec_fn=lambda: os.umask(0o077))
            processes.callback(child.stdout.close)
            processes.callback(_terminate, child)
            os.close(fd)
            fd = -1
            selector.register(child.stdout, selectors.EVENT_READ)
            deadline = time.monotonic() + timeout
            while selector.get_map():
                if (cancel is not None and cancel()) or time.monotonic() >= deadline:
                    raise TransportError('Steam transport canceled or timed out')
                for key, _ in selector.select(timeout=0.05):
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    if len(output) + len(chunk) > output_limit:
                        raise TransportError('Steam transport output limit exceeded')
                    output.extend(chunk)
            result = child.wait(timeout=max(0.01, deadline - time.monotonic()))
            if public_probe_observer is not None:
                public_probe_observer(bytes(output), temporary)
            return {'exit_code': result, 'output_bytes': len(output)}
    except (TransportError, KeyboardInterrupt):
        raise
    except Exception:
        raise TransportError('Steam transport failed') from None
    finally:
        if fd >= 0:
            os.close(fd)
        selector.close()
        output[:] = b'\x00' * len(output)
