#!/usr/bin/env python3
"""MIT. Source-only integration bridge; secrets arrive over an inherited FD.

Not called by the production adapter. This stages only an independently owned
UE4SS Lua mod and one-shot private request, never native encrypted password files.
"""
import os
from pathlib import Path
import stat
import struct
import sys

MAX_VALUE = 4 * 1024 * 1024
MAXIMUM = 14 + MAX_VALUE * 2


def packet(admin=None, player=None):
    result = bytearray(b'VSPB1\n')
    if admin is None and player is None:
        raise ValueError('No requested native password operation')
    for value in (admin, player):
        if value is None:
            result += struct.pack('<I', 0xffffffff)
            continue
        if not isinstance(value, str) or '\x00' in value:
            raise ValueError('Invalid password text')
        body = value.encode('utf-8', errors='strict')
        if len(body) > MAX_VALUE:
            raise ValueError('Password exceeds byte limit')
        result += struct.pack('<I', len(body)) + body
    return result


def validate(body):
    if len(body) > MAXIMUM or body[:6] != b'VSPB1\n':
        raise ValueError('Invalid protected request')
    offset, values = 6, []
    for _ in range(2):
        if offset + 4 > len(body):
            raise ValueError('Invalid protected request')
        size = struct.unpack_from('<I', body, offset)[0]
        offset += 4
        if size == 0xffffffff:
            values.append(None)
            continue
        if size > MAX_VALUE or offset + size > len(body):
            raise ValueError('Invalid protected request')
        values.append(bytes(body[offset:offset + size]).decode('utf-8', errors='strict'))
        offset += size
    if offset != len(body) or packet(*values) != body:
        raise ValueError('Invalid protected request')


def private_directory(path):
    # Linux ownership/mode are checked by the host before Wine opens any file.
    # Windows ACL equivalence is not assumed; production staging fails closed there.
    if os.name != 'posix':
        raise ValueError('Private staging requires the Linux node ownership boundary')
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Private directory cannot be a symlink')
    info = path.stat(follow_symlinks=False)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError('Private directory must be owned by the game UID with mode 0700')
    return path


def stage(mod_directory, body):
    validate(body)
    directory = private_directory(mod_directory)
    # The caller must create the confined mod directory under an approved game
    # root. Check every ancestor: a symlink must never redirect the private input.
    if any(parent.is_symlink() for parent in (directory, *directory.parents)):
        raise ValueError('Symlink in private input path')
    target = directory / 'request.bin'
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as file:
            file.write(body)
            file.flush()
            os.fsync(file.fileno())
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return {'request_staged': True, 'native_generation_verified': False}


def main():
    if len(sys.argv) != 2:
        raise ValueError('Expected the approved private mod directory only; input is FD 0')
    # No original password is accepted in argv/environment. The future caller
    # constructs packet(original admin/player operation) in memory over this FD.
    info = os.fstat(sys.stdin.fileno())
    if not stat.S_ISFIFO(info.st_mode):
        if not (os.name == 'posix' and stat.S_ISREG(info.st_mode) and
                info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o600):
            raise ValueError('Input must be an inherited pipe or owned mode-0600 FD')
    body = bytearray(sys.stdin.buffer.read(MAXIMUM + 1))
    try:
        stage(sys.argv[1], body)
    finally:
        body[:] = b'\x00' * len(body)


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        # Fixed message only: do not emit exception payloads containing secrets.
        print('Star password bootstrap staging failed', file=sys.stderr)
        sys.exit(1)
