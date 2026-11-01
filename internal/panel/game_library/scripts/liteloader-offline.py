"""Offline LiteLoader payload publisher (caller must enforce stopped state). Never acquires or runs code.

Manifest hashes authenticate operator-selected bytes only, not publisher provenance.
Only the documented 2.15.0/1.20.11.01 pair is admitted in this proposal.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import tempfile

MANAGED = ('bedrock_server.exe', 'bedrock_server_mod.exe', 'LiteLoader.dll')
SEED = 'server.properties'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plain(path):
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError('Expected ordinary file: ' + path.name)
    return path


def install(root, payload, env):
    # Complete preflight precedes any destination writes. Caller owns stopped-state
    # enforcement; this adapter does not infer process state from missing locks.
    if env.get('BEDROCK_TERMS_ACCEPTED') != 'true':
        raise ValueError('Explicit Minecraft EULA and Usage Guidelines consent required')
    if platform.machine().lower() not in ('amd64', 'x86_64'):
        raise ValueError('Unsupported architecture: Windows x64 payload; ARM64 not accepted')
    if (env.get('LL_VERSION'), env.get('BDS_VERSION')) != ('2.15.0', '1.20.11.01'):
        raise ValueError('Select documented historical pair LL 2.15.0 / BDS 1.20.11.01; latest is ambiguous')
    root, payload = Path(root).absolute(), Path(payload).absolute()
    for directory in (root, payload):
        if not directory.is_dir() or any(p.is_symlink() for p in (directory, *directory.parents)):
            raise ValueError('Ordinary existing directories required')
    if root == payload or root in payload.parents or payload in root.parents:
        raise ValueError('Payload must be separate from server workspace')
    manifest = json.loads(plain(payload / 'manifest.json').read_text(encoding='utf-8'))
    if not isinstance(manifest, dict):
        raise ValueError('Expected adapter-local manifest object')
    if manifest.get('loader') != '2.15.0' or manifest.get('bds') != '1.20.11.01' or manifest.get('platform') != 'win-x64':
        raise ValueError('Payload identity does not match selected historical pair')
    if not isinstance(manifest, dict) or set(manifest) != {'loader', 'bds', 'platform', 'sha256'}:
        raise ValueError('Expected adapter-local manifest object with exact identity/hash fields')
    hashes = manifest.get('sha256')
    if not isinstance(hashes, dict) or set(hashes) != set((*MANAGED, SEED)):
        raise ValueError('Manifest must identify exactly the managed binaries and default properties')
    for name in hashes:
        source, destination = plain(payload / name), plain(root / name)
        if not re.fullmatch('[a-f0-9]{64}', str(hashes[name])) or not source.is_file() or digest(source) != hashes[name]:
            raise ValueError('Payload hash mismatch: ' + name)
    # Stage every byte before replacing anything. No wildcard deletion or copying
    # of plugins/worlds/config. Seed defaults exclusively when missing.
    with tempfile.TemporaryDirectory(prefix='.liteloader-update-', dir=root) as temporary:
        stage = Path(temporary)
        for name in hashes:
            shutil.copyfile(payload / name, stage / name)
            if digest(stage / name) != hashes[name]:
                raise ValueError('Payload changed during staging: ' + name)
        backups = {}
        published = []
        seeded = False
        try:
            for name in MANAGED:
                target = root / name
                backups[name] = target.read_bytes() if target.exists() else None
                os.replace(stage / name, target)
                published.append(name)
            if not (root / SEED).exists():
                with (root / SEED).open('xb') as out:
                    seeded = True
                    out.write((stage / SEED).read_bytes())
        except Exception:
            if seeded:
                (root / SEED).unlink()
            for name in reversed(published):
                if backups[name] is None:
                    (root / name).unlink()
                else:
                    (root / name).write_bytes(backups[name])
            raise
    return {'result': 'offline payload published', 'native_ready': False,
            'loader': '2.15.0', 'bds': '1.20.11.01', 'seeded_properties': seeded,
            'integrity': 'operator manifest, not independently verified publisher hashes'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--payload', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.root, args.payload, os.environ)))
    except (ValueError, OSError, json.JSONDecodeError) as error:
        parser.exit(1, str(error) + '\n')
