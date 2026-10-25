"""Bounded fresh native log relay. Caller retains process/signal/exit ownership."""
import codecs
import importlib.util
import os
import select
from pathlib import Path, PurePosixPath
import stat
import sys
import threading
import time


class _Sink:
    """Nonblocking owned spool pipe; never mutate caller open-file flags."""
    def __init__(self, stream):
        self.spool = None
        if stat.S_ISFIFO(os.fstat(stream.fileno()).st_mode):
            self.fd = os.dup(stream.fileno())
            try:
                self.spool = os.pipe2(os.O_NONBLOCK | os.O_CLOEXEC)
            except BaseException:
                os.close(self.fd)
                raise
        else:
            # Independent append description for regular files/TTYs when DAC
            # permits reopening. Never change flags on an inherited descriptor.
            self.fd = os.open('/proc/self/fd/%d' % stream.fileno(),
                              os.O_WRONLY | os.O_NONBLOCK | os.O_APPEND | os.O_CLOEXEC)

    def write(self, data, deadline):
        data = memoryview(data)
        queued = 0
        while data or queued:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('output deadline')
            try:
                if self.spool is not None:
                    if not queued:
                        queued = os.write(self.spool[1], data)
                        data = data[queued:]
                    count = os.splice(self.spool[0], self.fd, queued, flags=os.SPLICE_F_NONBLOCK)
                    queued -= count
                else:
                    count = os.write(self.fd, data)
                    data = data[count:]
                if count <= 0:
                    raise OSError('output unavailable')
            except BlockingIOError:
                select.select([], [self.fd], [], remaining)
            except InterruptedError:
                continue

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
        if self.spool is not None:
            for fd in self.spool:
                os.close(fd)
            self.spool = None


def _redactor():
    module = sys.modules.get('steam_template')
    if module is None:
        path = Path(__file__).with_name('steam-template.py')
        if not path.exists():
            path = path.with_name('steam_template.py')
        spec = importlib.util.spec_from_file_location('steam_template', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module.Redactor


class _Stream:
    def __init__(self, identity, position, prefix, credentials):
        self.identity, self.position, self.prefix = identity, position, prefix
        self.decoder = None
        self.head = b''
        self.redactor = None
        self.credentials = credentials
        self.baseline = position > 0
        self.mtime = None
        self.saved_decoder = None
        self.saved_pending = b''
        self.codec = None
        self.has_input = False

    @property
    def active(self):
        return self.redactor is not None

    @staticmethod
    def encoding(prefix):
        if prefix.startswith(b'\xff\xfe'):
            return 'utf-16-le'
        if prefix.startswith(b'\xfe\xff'):
            return 'utf-16-be'
        return 'utf-8-sig'

    def feed(self, data, final=False):
        self.has_input = True
        if self.redactor is None:
            self.redactor = _redactor()(self.credentials)
            self.redactor.pending = self.saved_pending
            self.saved_pending = b''
        if self.decoder is None and self.saved_decoder is not None:
            self.decoder = codecs.getincrementaldecoder(self.codec)(errors='strict')
            self.decoder.setstate(self.saved_decoder)
            self.saved_decoder = None
        if self.decoder is None and self.baseline:
            self.codec = self.encoding(self.prefix)
            self.decoder = codecs.getincrementaldecoder(self.codec)(errors='strict')
        if self.decoder is None:
            self.head += data
            if len(self.head) < 3 and not final:
                return b''
            encoding = self.encoding(self.head)
            self.codec = encoding
            self.decoder = codecs.getincrementaldecoder(encoding)(errors='strict')
            data, self.head = self.head, b''
            if encoding.startswith('utf-16') and data[:2] in (b'\xff\xfe', b'\xfe\xff'):
                data = data[2:]
        text = self.decoder.decode(data, final=final)
        return self.redactor.feed(text.encode('utf-8'), final=final)

    def quiesce(self):
        # Emit only bytes proven not to be a credential prefix. Keep any partial
        # credential/Unicode state across later appends without a live decoder.
        pending = self.redactor.pending
        keep = 0
        for secret in self.redactor.values:
            # KMP prefix/suffix overlap, linear even for long credentials.
            tail = pending[-(len(secret) - 1):] if len(secret) > 1 else b''
            sequence = list(secret) + [-1] + list(tail)
            table = [0] * len(sequence)
            for index in range(1, len(sequence)):
                size = table[index - 1]
                while size and sequence[index] != sequence[size]:
                    size = table[size - 1]
                if sequence[index] == sequence[size]:
                    size += 1
                table[index] = size
            keep = max(keep, table[-1])
        cut = len(pending) - keep
        previous = -1
        while cut != previous:
            previous = cut
            for secret in self.redactor.values:
                position = pending.find(secret)
                while 0 <= position < cut:
                    if position + len(secret) > cut:
                        cut = position
                        break
                    position = pending.find(secret, position + 1)
        output, self.saved_pending = pending[:cut], pending[cut:]
        for secret in self.redactor.values:
            output = output.replace(secret, b'[redacted]')
        if self.decoder is not None:
            self.saved_decoder = self.decoder.getstate()
        self.decoder = None
        self.redactor = None
        return output


class NativeLogRelay:
    MAX_FILES = 4096
    MAX_ENTRIES = 4096
    MAX_NAMES = 4096
    MAX_ACTIVE = 16
    FILE_READ = 64 * 1024
    POLL_READ = 256 * 1024
    INTERVAL = .05
    WRITE_TIMEOUT = .25
    FINISH_TIMEOUT = 2.0

    def __init__(self, root, relative_directory='Logs_DS', prefix='PlayerLog_', suffix='.log', credentials=()):
        self.root, self.relative_directory = root, relative_directory
        self.prefix, self.suffix, self.credentials = prefix, suffix, tuple(credentials)
        self.root_fd = None
        self.states = {}
        self.identities = {}
        self.names = set()
        self.done = threading.Event()
        self.thread = None
        self.failed = False
        self.finished = False
        self.turn = 0
        self.sink = None
        self.finish_deadline = None

    def _error(self):
        if not self.failed:
            self.failed = True
            try:
                sink = _Sink(sys.stderr)
                try:
                    sink.write(b'Native log relay unavailable.\n', time.monotonic() + .05)
                finally:
                    sink.close()
            except Exception:
                pass

    def _directory(self):
        fd = os.dup(self.root_fd)
        try:
            for part in self.parts:
                next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                os.close(fd)
                fd = next_fd
            return fd
        except BaseException:
            os.close(fd)
            raise

    def _scan(self, fd):
        names = []
        with os.scandir(fd) as entries:
            for count, entry in enumerate(entries, 1):
                if count > self.MAX_ENTRIES:
                    raise ValueError('scan limit')
                if entry.name.startswith(self.prefix) and entry.name.endswith(self.suffix):
                    try:
                        info = entry.stat(follow_symlinks=False)
                    except FileNotFoundError:
                        continue
                    if not stat.S_ISREG(info.st_mode):
                        raise ValueError('nonregular file')
                    names.append((entry.name, info))
                    if len(names) > self.MAX_FILES:
                        raise ValueError('file limit')
        return sorted(names, key=lambda item: item[0])

    def _emit(self, data):
        if data:
            deadline = time.monotonic() + self.WRITE_TIMEOUT
            if self.finish_deadline is not None:
                deadline = min(deadline, self.finish_deadline)
            self.sink.write(data, deadline)

    def _poll(self, baseline=False):
        if self.failed:
            return
        try:
            directory = self._directory()
        except FileNotFoundError:
            return
        try:
            names = self._scan(directory)
            if names:
                shift = self.turn % len(names)
                names = names[shift:] + names[:shift]
                self.turn += 1
            budget = self.POLL_READ
            for name, scanned in names:
                if name not in self.names:
                    if len(self.names) >= self.MAX_NAMES:
                        raise ValueError('name limit')
                    self.names.add(name)
                state = self.states.get(name)
                if not baseline and state is not None and state.identity == (scanned.st_dev, scanned.st_ino) and state.position == scanned.st_size and state.mtime == scanned.st_mtime_ns:
                    continue
                try:
                    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory)
                except FileNotFoundError:
                    continue
                try:
                    info = os.fstat(fd)
                    if not stat.S_ISREG(info.st_mode):
                        raise ValueError('nonregular file')
                    identity = (info.st_dev, info.st_ino)
                    prefix = os.pread(fd, 64, 0)
                    # A baseline inode renamed to another eligible filename is
                    # still historical. Preserve its EOF cursor across rotation.
                    state = self.identities.get(identity)
                    changed = state and (info.st_size < state.position or not prefix.startswith(state.prefix))
                    if baseline or state is None or changed:
                        if state is not None and state.has_input:
                            self._emit(state.feed(b'', final=True))
                        state = _Stream(identity, info.st_size if baseline else 0, prefix, self.credentials)
                        if identity not in self.identities and len(self.identities) >= self.MAX_NAMES:
                            raise ValueError('identity limit')
                        self.identities[identity] = state
                    self.states[name] = state
                    # Compare only the previously observed prefix, never emit it.
                    state.prefix = prefix
                    state.mtime = info.st_mtime_ns
                    if baseline or budget <= 0:
                        continue
                    if state.position >= info.st_size:
                        continue
                    if not state.active and sum(item.active for item in self.identities.values()) >= self.MAX_ACTIVE:
                        raise ValueError('active stream limit')
                    os.lseek(fd, state.position, os.SEEK_SET)
                    data = os.read(fd, min(self.FILE_READ, budget))
                    budget -= len(data)
                    state.position += len(data)
                    self._emit(state.feed(data))
                    if state.position >= info.st_size:
                        self._emit(state.quiesce())
                finally:
                    os.close(fd)
        finally:
            os.close(directory)

    def start(self):
        if self.thread is not None or self.root_fd is not None or self.finished or self.failed:
            return self
        try:
            raw = self.relative_directory
            if not isinstance(raw, str) or not raw or '\\' in raw or ':' in raw or raw.startswith('/') or any(p in ('', '.', '..') for p in raw.split('/')):
                raise ValueError('relative directory required')
            self.parts = PurePosixPath(raw).parts
            if len(self.parts) > 16 or not self.prefix or not self.suffix or any(c in self.prefix + self.suffix for c in '/\\\x00'):
                raise ValueError('invalid filename pattern')
            self.root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            self.sink = _Sink(sys.stdout)
            self._poll(baseline=True)
            self.thread = threading.Thread(target=self._run, name='native-log-relay', daemon=True)
            self.thread.start()
        except Exception:
            self._error()
            self._close()
        return self

    def _run(self):
        try:
            while not self.done.wait(self.INTERVAL):
                self._poll()
            self._poll()
            if not self.failed:
                for state in self.identities.values():
                    if state.has_input:
                        self._emit(state.feed(b'', final=True))
        except Exception:
            self._error()
        finally:
            self._close()

    def _close(self):
        if self.root_fd is not None:
            os.close(self.root_fd)
            self.root_fd = None
        if self.sink is not None:
            self.sink.close()
            self.sink = None

    def finish(self):
        if self.finished:
            return not self.failed
        self.finished = True
        self.finish_deadline = time.monotonic() + self.FINISH_TIMEOUT / 2
        self.done.set()
        if self.thread is not None and self.thread.ident is not None:
            self.thread.join(timeout=self.FINISH_TIMEOUT)
            if self.thread.is_alive():
                # Worker owns its descriptors; never close them underneath it.
                self._error()
        else:
            self._close()
        return not self.failed
