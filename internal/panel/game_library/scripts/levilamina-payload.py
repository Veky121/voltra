"""Offline import of an operator-prepared lip server workspace. No acquisition."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import struct
import sys


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree(root):
    if not root.is_dir() or root.is_symlink():
        raise ValueError('Expected real workspace directory')
    result = {}
    for p in root.rglob('*'):
        if p.is_symlink() or not (p.is_dir() or p.is_file()):
            raise ValueError('Links and special files are unsupported')
        if p.is_file():
            result[p.relative_to(root).as_posix()] = p
    return result


def pe(path):
    data = path.read_bytes()
    if len(data) < 64 or data[:2] != b'MZ':
        raise ValueError('Missing Windows PE executable')
    offset = struct.unpack_from('<I', data, 60)[0]
    if offset + 6 > len(data) or data[offset:offset+4] != b'PE\0\0' or struct.unpack_from('<H', data, offset+4)[0] != 0x8664:
        raise ValueError('Expected x64 PE executable')


def protected(name):
    p = Path(name)
    return (p.parts[0] in ('worlds', 'mods', 'behavior_packs', 'resource_packs', 'config', 'logs')
            or p.suffix.lower() in ('.json', '.jsonc', '.properties', '.ini', '.cfg', '.toml', '.yaml', '.yml')
            or name == 'lip-install.txt' or (p.parts[0] == 'plugins' and p.parts[1:2] != ('LeviLamina',)))


def consent():
    if os.environ.get('BEDROCK_TERMS_ACCEPTED') != 'true':
        raise ValueError('Explicit Minecraft EULA and Usage Guidelines acceptance required')
    if platform.machine().lower() not in ('amd64', 'x86_64'):
        raise ValueError('Only x64 Wine is proposed; no ARM compatibility claim')


def install(root, source, inventory):
    consent()
    tree(root)
    tree(source)
    root, source = root.resolve(), source.resolve()
    if root.is_relative_to(source) or source.is_relative_to(root):
        raise ValueError('Payload must be outside the installation')
    files, existing = tree(source), tree(root)
    # Inventory is an operator-provided integrity record, not publisher attestation.
    manifest = json.loads(inventory.read_text(encoding='utf-8'))
    if manifest != {n: digest(p) for n, p in files.items()}:
        raise ValueError('Complete payload SHA256 inventory mismatch')
    for name in ('bedrock_server_mod.exe', 'bedrock_server.exe'):
        if name not in files:
            raise ValueError('Prepared lip workspace missing ' + name)
        pe(files[name])
    if not any(n.startswith('plugins/LeviLamina/') and n.lower().endswith('.dll') for n in files):
        raise ValueError('Prepared workspace missing LeviLamina DLL')
    plan = []
    for name, src in files.items():
        if name.split('/')[0] == '.voltra':
            raise ValueError('Payload may not replace Voltra helpers')
        dst = root / name
        if name in existing:
            if protected(name):
                continue
            if digest(src) != digest(dst):
                raise ValueError('Managed conflict requires separate migration: ' + name)
            continue
        if dst.exists() or any(p.exists() and not p.is_dir() for p in dst.parents if p != root):
            raise ValueError('Destination file/directory conflict')
        plan.append((src, dst))
    # All refusals above precede writes. I/O failure is not crash-atomic publication.
    for src, dst in plan:
        dst.parent.mkdir(parents=True, exist_ok=True)
        with dst.open('xb') as out, src.open('rb') as inp:
            shutil.copyfileobj(inp, out)
    return {'copied': len(plan), 'native_verified': False}


def run(root):
    consent()
    tree(root)
    pe(root / 'bedrock_server_mod.exe')
    wine = shutil.which('wine')
    if not wine:
        raise ValueError('Operator-provisioned x64 Wine and VC++ runtime required')
    os.chdir(root)
    os.execv(wine, [wine, 'bedrock_server_mod.exe'])


if __name__ == '__main__':
    if sys.argv[1] == 'install':
        print(json.dumps(install(Path.cwd(), Path(os.environ['LEVI_PAYLOAD_DIR']), Path(os.environ['LEVI_PAYLOAD_SHA256_FILE']))))
    elif sys.argv[1] == 'run':
        run(Path.cwd())
    else:
        raise ValueError('Expected install or run')
