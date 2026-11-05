"""Mohist-only installation adapter. Shared family implementation stays authoritative."""
import json
import os
from pathlib import Path
import platform
import re
import zipfile


def _install(root, env):
    import java_fork_install as fork
    # Refuse before resolution, acquisition, or installer filesystem writes.
    if env.get('EULA_ACCEPTED') != 'true':
        raise ValueError('Accept the Minecraft EULA explicitly before installing')
    existing = env.get('USE_EXISTING_JAR', 'false')
    if existing not in ('true', 'false'):
        raise ValueError('USE_EXISTING_JAR must be true or false')
    if existing == 'false':
        if platform.machine().lower() not in ('amd64', 'x86_64'):
            raise ValueError('Mohist acquisition is reviewed for amd64 only; ARM64 native compatibility is unverified')
        if env.get('PROJECT', 'mohist') not in ('mohist', 'banner'):
            raise ValueError('Choose original Mohist or Banner project')
        if not re.fullmatch(r'1\.[0-9]{1,2}(?:\.[0-9]{1,2})?', env.get('MC_VERSION', '1.20.1')):
            raise ValueError('Choose an exact Minecraft version')
        checksum = env.get('DOWNLOAD_SHA256', '')
        if checksum and not re.fullmatch('[0-9a-fA-F]{64}', checksum):
            raise ValueError('Download SHA256 must contain 64 hex digits')

    original_check, original_resolve = fork.jar_check, fork.resolve
    selected = {}

    def resolve(kind, values):
        result = original_resolve(kind, values)
        selected.update(result)
        return result

    def check(path, runnable=True):
        original_check(path, runnable)
        with zipfile.ZipFile(path) as archive:
            # CRC validation includes every member, not just the manifest.
            if archive.testzip() is not None:
                raise ValueError('Mohist JAR failed ZIP CRC validation')
            manifest = archive.read('META-INF/MANIFEST.MF').decode('utf-8').replace('\r\n', '\n').replace('\n ', '')
            main = re.search(r'^Main-Class:\s*(\S+)', manifest, re.M)
            name = main[1].replace('.', '/') + '.class'
            with archive.open(name) as stream:
                header = stream.read(8)
            if len(header) != 8 or header[:4] != b'\xca\xfe\xba\xbe':
                raise ValueError('Mohist launcher has an invalid Java class header')
            required = int.from_bytes(header[6:8], 'big') - 44
            # Existing uploads do not resolve a publisher runtime and remain operator-owned.
            if selected and required > selected['java']:
                raise ValueError(f'Launcher requires Java {required}; selected installer plan uses Java {selected["java"]}. Supply a matching artifact/runtime')

    fork.resolve, fork.jar_check = resolve, check
    try:
        return fork.install('mohist', Path(root), env)
    finally:
        fork.resolve, fork.jar_check = original_resolve, original_check



def consent_existing(root, env):
    from pathlib import Path
    path = Path(root) / 'eula.txt'
    if path.is_symlink():
        raise ValueError('Refusing symlink EULA file')
    value = env.get('EULA_ACCEPTED')
    if value == 'true':
        return
    if value is not None:
        raise ValueError('Minecraft EULA consent is revoked or invalid')
    if path.is_file():
        lines = path.read_text(encoding='utf-8-sig').splitlines()
        choices = [line.split('=', 1)[1].strip().lower() for line in lines
                   if line.strip() and not line.lstrip().startswith(('#', '!'))
                   and line.split('=', 1)[0].strip() == 'eula' and '=' in line]
        if choices and choices[-1] == 'true':
            return
    raise ValueError('Explicit Minecraft EULA consent required')


def install(root, env):
    from pathlib import Path
    consent_existing(root, env)
    result = _install(root, {**env, 'EULA_ACCEPTED': 'true'})
    path = Path(root) / 'eula.txt'
    # Exclusive creation preserves operator bytes, including explicit false.
    if not path.exists():
        with path.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write('eula=true\n')
    return result

if __name__ == '__main__':
    print(json.dumps(install('/mnt/server', os.environ)))
