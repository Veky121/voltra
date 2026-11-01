#!/usr/bin/env python3
"""SIT-only adapter. Existing native configuration is authoritative."""
import importlib.util
import os
from pathlib import Path
import platform
import re
import sys


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


legacy = load('legacy_coop_servers', 'legacy_coop_servers.py')


def elf(path):
    with path.open('rb') as stream:
        header = stream.read(20)
    if len(header) != 20 or header[:6] != b'\x7fELF\x02\x01' or int.from_bytes(header[18:20], 'little') != 62:
        raise ValueError('SIT requires Linux x86-64 ELF; ARM64/native Windows acceptance is unsupported')


def configuration(root, env):
    path = legacy.confined(root, 'Aki_Data/Server/configs/http.json')
    if path.exists():
        data = legacy.read_json(path)
        if type(data.get('port')) is not int or data['port'] != int(legacy.primary(env)):
            raise ValueError('Native HTTP port must match allocation; edit the operator HTTP file explicitly')
        if not isinstance(data.get('ip'), str) or not data['ip']:
            raise ValueError('Native HTTP bind address is required')
    # No reserialization: BOM, arrays, secrets and unknown bytes remain native-owned.


def preflight(root, env):
    legacy.acknowledged(env)
    legacy.primary(env)
    if platform.system() != 'Linux' or platform.machine().lower() not in ('x86_64', 'amd64'):
        raise ValueError('SIT adapter requires Linux amd64 runtime/image; ARM64 needs separately verified emulation')
    name = legacy.text(env.get('SIT_NAME', 'SITCoop.tar.gz'), 128)
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', name) or name in ('.', '..'):
        raise ValueError('SIT archive name must be a basename')
    configuration(root, env)
    binary = legacy.confined(root, 'Aki.Server.exe')
    if binary.exists():
        elf(binary)
        receipt = legacy.confined(root, '.voltra/legacy-sit/release.json')
        if not receipt.is_file() or legacy.read_json(receipt).get('binary_sha256') != legacy.release.sha256(binary):
            raise ValueError('Preserve operator executable: reviewed matching installation receipt required for replacement')


def install(root, env):
    root = Path(root).resolve()
    preflight(root, env)
    identity = legacy.sit_identity(env)  # metadata/checksum refusal before installer state
    local = env.get('SIT_ARCHIVE_PATH', '')
    if local:
        archive = legacy.confined(root, local)
        if not archive.is_file() or legacy.release.sha256(archive) != identity['sha256'] or (identity.get('bytes') and archive.stat().st_size != identity['bytes']):
            raise ValueError('Operator archive size/checksum mismatch')
    original_extract = legacy.release.extract
    original_identity = legacy.sit_identity
    def extract(archive, ready, prefix):
        original_extract(archive, ready, prefix)
        elf(legacy.confined(ready.resolve(), 'Aki.Server.exe'))
        configuration(ready.resolve(), env)
    try:
        legacy.release.extract = extract
        legacy.sit_identity = lambda _: identity
        legacy.install(root, 'sit', env)
    finally:
        legacy.release.extract = original_extract
        legacy.sit_identity = original_identity


def launch(root, env):
    root = Path(root).resolve()
    legacy.acknowledged(env)
    if platform.system() != 'Linux' or platform.machine().lower() not in ('x86_64', 'amd64'):
        raise ValueError('SIT launch requires Linux amd64; no implicit emulation')
    configuration(root, env)
    if not legacy.confined(root, 'Aki_Data/Server/configs/http.json').is_file():
        raise ValueError('Matching native HTTP configuration required')
    elf(legacy.confined(root, 'Aki.Server.exe'))
    child = legacy.clean_environment(env)
    child['HOME'] = str(root)
    return legacy.console.run(root, [str(root / 'Aki.Server.exe')], child, '^C',
                              credentials=(env.get('GITHUB_OAUTH_TOKEN', ''),), stop_signal=legacy.signal.SIGINT)


if __name__ == '__main__':
    if sys.argv[1:] == ['install']: install(Path.cwd(), dict(os.environ))
    elif sys.argv[1:] == ['run']: sys.exit(launch(Path.cwd(), dict(os.environ)))
    else: raise ValueError('Expected install or run')
