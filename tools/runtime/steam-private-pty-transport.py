#!/usr/bin/env python3
"""MIT. Experimental SteamCMD password-prompt worker, not integrated/enabled."""
import errno
import fcntl
import os
from pathlib import Path
import pty
import re
import select
import selectors
import signal
import stat
import subprocess
import tempfile
import termios
import time


class PromptError(RuntimeError):
    pass


def literal(value):
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise PromptError('Invalid private literal length')
    try:
        encoded = value.encode('utf-8', 'strict')
    except UnicodeError:
        raise PromptError('Invalid private literal encoding') from None
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise PromptError('Private literals cannot contain controls')
    return encoded


def stop(child):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(child.pid, sig)
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=.5)
        except subprocess.TimeoutExpired:
            continue
        # A surviving descendant may still hold the terminal after shell exit.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        return
    child.wait(timeout=2)


def run(executable, username, *, parent, password=None, guard=None,
        abort_at_password=False, timeout=30, cancel=None):
    """No output is exposed, including before a password has been sent.

    Native probe mode stops BEFORE writing any byte. This username-only CLI is
    exclusively a public fixture dialect, not a production credential API.
    Real integration needs the username command in an inherited private script.
    """
    if not re.fullmatch(r'[A-Za-z0-9_]{1,64}', username or ''):
        raise PromptError('Experimental username dialect unavailable')
    password_bytes = literal(password) if password is not None else None
    guard_bytes = literal(guard) if guard is not None else None
    if not abort_at_password and password_bytes is None:
        raise PromptError('Private password missing')
    if not 0 < timeout <= 300:
        raise PromptError('Invalid prompt timeout')
    executable = Path(executable).resolve(strict=True)
    metadata = executable.parent.stat()
    if metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) & 0o077:
        raise PromptError('Program copy must be owned and private')
    parent = Path(parent)
    if parent.is_symlink() or not parent.is_dir():
        raise PromptError('Invalid private parent')
    master, slave = pty.openpty()
    os.set_blocking(master, False)
    attributes = termios.tcgetattr(slave)
    attributes[0] &= ~(termios.IXON | termios.ICRNL | termios.INLCR | termios.IGNCR)
    attributes[1] &= ~termios.OPOST
    attributes[3] &= ~(termios.ECHO | termios.ECHONL | termios.ICANON | termios.IEXTEN)
    attributes[6][termios.VMIN] = 1
    attributes[6][termios.VTIME] = 0
    termios.tcsetattr(slave, termios.TCSANOW, attributes)
    selector = selectors.DefaultSelector()
    child = None
    state = 'password'
    sent = []
    pending = b''
    count = 0
    def setup():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)
        os.umask(0o077)
    try:
        with tempfile.TemporaryDirectory(prefix='steam-private-pty-', dir=parent) as temporary:
            os.chmod(temporary, 0o700)
            try:
                child = subprocess.Popen([str(executable), '+login', username, '+quit'],
                    cwd=temporary, env={'HOME': temporary, 'USER': 'container',
                        'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8'},
                    stdin=slave, stdout=slave, stderr=slave, close_fds=True, preexec_fn=setup)
                os.close(slave)
                slave = -1
                selector.register(master, selectors.EVENT_READ)
                deadline = time.monotonic() + timeout
                while True:
                    if (cancel and cancel()) or time.monotonic() >= deadline:
                        raise PromptError('Private prompt canceled or timed out')
                    for _, _ in selector.select(.05):
                        try:
                            chunk = os.read(master, 65536)
                        except OSError as error:
                            if error.errno == errno.EAGAIN:
                                continue
                            if error.errno == errno.EIO:
                                chunk = b''
                            else:
                                raise
                        if not chunk:
                            result = child.wait(timeout=1)
                            return {'exit_code': result, 'sent_fields': sent,
                                    'password_prompt_observed': 'password' in sent}
                        count += len(chunk)
                        if count > 2 * 1024**2:
                            raise PromptError('Private prompt output limit exceeded')
                        pending = (pending + chunk)[-8192:]
                        # Prompt matching is ASCII and bounded. ANSI escapes do
                        # not permit partial prompt/secret output to escape.
                        clean = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', pending)
                        line = clean.rsplit(b'\n', 1)[-1].strip(b'\r ')
                        password_prompt = line.lower() == b'password:'
                        guard_prompt = line.lower() in (b'steam guard code:', b'enter steam guard code:')
                        if password_prompt:
                            if state != 'password':
                                raise PromptError('Unexpected repeated private prompt')
                            if abort_at_password:
                                return {'exit_code': None, 'sent_fields': [],
                                        'password_prompt_observed': True, 'aborted_before_secret': True}
                            value, field = password_bytes, 'password'
                            state = 'guard'
                        elif guard_prompt:
                            if state != 'guard' or guard_bytes is None:
                                raise PromptError('Unexpected private verification prompt')
                            value, field = guard_bytes, 'guard'
                            state = 'done'
                        else:
                            continue
                        # Child should not re-enable echo; fail instead of
                        # sending a secret if the terminal no longer has it off.
                        current = termios.tcgetattr(master)
                        if current[3] & (termios.ECHO | termios.ECHONL):
                            raise PromptError('Private terminal echo unexpectedly enabled')
                        payload = value + b'\n'
                        offset = 0
                        while offset < len(payload):
                            if (cancel and cancel()) or time.monotonic() >= deadline:
                                raise PromptError('Private prompt canceled or timed out')
                            if not select.select([], [master], [], .05)[1]:
                                continue
                            try:
                                offset += os.write(master, payload[offset:])
                            except BlockingIOError:
                                continue
                        sent.append(field)
                        pending = b''
            finally:
                if child is not None:
                    stop(child)
    except (PromptError, KeyboardInterrupt):
        raise
    except Exception:
        raise PromptError('Private prompt transport failed') from None
    finally:
        if slave >= 0:
            os.close(slave)
        os.close(master)
        selector.close()


def beta_password_transport(*args, **kwargs):
    # An account password prompt is not evidence for app_update -betapassword.
    # Keep this separate capability closed before process/disk/network effects.
    raise PromptError('Private beta password prompt transport is not proved')
