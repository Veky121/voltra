"""Receipt-verified native dispatch; image/library acceptance remains external."""
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
import struct


def executable(root):
    root = Path(root).absolute()
    if platform.system() != 'Linux' or platform.machine().lower() not in ('aarch64', 'arm64'):
        raise ValueError('Native runtime requires Linux ARM64')
    if root.resolve() != root:
        raise ValueError('Unsafe root')
    receipt = json.loads((root/'.voltra/factorio-installed.json').read_text())
    if receipt.get('payload_architecture') != 'linux-arm64':
        raise ValueError('Native receipt required')
    names = [n for n in receipt['files'] if n.startswith('bin/') and n.endswith('/factorio')]
    if len(names) != 1 or len(names[0].split('/')) != 3 or '..' in names[0].split('/'):
        raise ValueError('Unique confined executable required')
    binary = root/names[0]
    if binary.resolve() != binary:
        raise ValueError('Symlink executable refused')
    body = binary.read_bytes()
    row = receipt['files'][names[0]]
    if len(body) != row['size'] or hashlib.sha256(body).hexdigest() != row['sha256']:
        raise ValueError('Executable differs from verified installation')
    if len(body) < 20 or body[:6] != b'\x7fELF\x02\x01' or int.from_bytes(body[18:20], 'little') != 183:
        raise ValueError('ELF64 ARM64 required')
    return binary



def native_ready(root):
    """Validate interpreter presence, then retain the unapproved image boundary."""
    if os.environ.get('VOLTRA_FACTORIO_NATIVE_ARM64') != '1':
        raise ValueError('Explicit native opt-in required')
    binary = executable(root)
    receipt = json.loads((Path(root)/'.voltra/factorio-installed.json').read_text())
    if receipt.get('version') == '2.0.77' or not receipt.get('version'):
        raise ValueError('Explicit compatible native version required')
    body = binary.read_bytes()
    if len(body) < 64:
        raise ValueError('Truncated ELF header')
    offset = struct.unpack_from('<Q', body, 32)[0]
    size, count = struct.unpack_from('<HH', body, 54)
    if size != 56 or not count or offset + size * count > len(body):
        raise ValueError('Invalid ELF program headers')
    interpreters = []
    for index in range(count):
        position = offset + index * size
        if struct.unpack_from('<I', body, position)[0] == 3:
            start = struct.unpack_from('<Q', body, position + 8)[0]
            length = struct.unpack_from('<Q', body, position + 32)[0]
            raw = body[start:start+length]
            if len(raw) != length or not raw.endswith(b'\0') or b'\0' in raw[:-1]:
                raise ValueError('Invalid ELF interpreter')
            interpreters.append(raw[:-1].decode('ascii'))
    if len(interpreters) != 1 or not interpreters[0].startswith('/'):
        raise ValueError('Unique absolute ELF interpreter required')
    if not os.access(interpreters[0], os.X_OK):
        raise ValueError('ELF interpreter missing from runtime image')
    # Interpreter existence and architecture do not prove NEEDED libraries,
    # symbol versions, CPU requirements or supervisor compatibility.
    raise ValueError('Native image/ABI proof absent; candidate remains nondeployable')

if __name__ == '__main__':
    try:
        if os.environ.get('VOLTRA_FACTORIO_NATIVE_ARM64') != '1':
            raise ValueError('Explicit native opt-in required')
        binary = native_ready(Path.cwd())
        args = sys.argv[1:]
        if args[:1] == ['--']:
            args = args[1:]
        os.execv(str(binary), [str(binary), *args])
    except (ValueError, KeyError, OSError, struct.error):
        sys.exit('Native Factorio dispatch refused; verify receipt, architecture and runtime libraries.')
