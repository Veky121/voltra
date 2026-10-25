#!/usr/bin/env python3
"""MIT. TShock 5 legacy .NET6 isolation; TShock6 keeps the default .NET9 image."""
import hashlib
import ctypes
import ctypes.util
import io
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import urllib.request
from terraria_release_install import confined, safe_name, check_elf, check_bundled_runtime, check_runtime, sync_directory

VERSION = '6.0.36'
EOL = '2024-11-12'
RUNTIME_PINS = {
    'x64': 'afb6018fcabec468ccd7ae2f1131d8c9de7f4de7645b8f0c223efbbdbfdc515fb0642a399ebfe372c02044416c4cae463c9c802cd156b9da4181efff0e33ee94',
    'arm64': 'aa9a35f181204199ac6c44863c4773f8967b25adce218e23ce2822b40b26c38edc1e4e2ff323dabb81ae049bc187f14d209ef1365e68970fd6c32af21f0a1d44',
}


def runtime_path(root, arch):
    if arch not in RUNTIME_PINS: raise ValueError('Unsupported private .NET6 architecture')
    return confined(root, '.voltra/tshock-runtime/' + VERSION + '/' + arch)


def sha512(path):
    value = hashlib.sha512()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''): value.update(block)
    return value.hexdigest()


def runtime_members(archive):
    seen, total, records = set(), 0, []
    for member in archive.getmembers():
        if member.name in ('.', './') and member.isdir(): continue
        name = member.name[2:] if member.name.startswith('./') else member.name
        relative = safe_name(name).as_posix()
        if relative.casefold() in seen or not (member.isfile() or member.isdir()): raise ValueError('Unsafe Microsoft runtime archive entry')
        seen.add(relative.casefold()); total += member.size
        if total > 256 * 1024**2 or len(seen) > 4096: raise ValueError('Microsoft runtime exceeds extraction budget')
        records.append((member, relative))
    return records


def runtime_archive(root, arch, opener=urllib.request.urlopen):
    expected = RUNTIME_PINS.get(arch)
    if expected is None: raise ValueError('Unsupported Microsoft runtime architecture')
    cache = confined(root, '.voltra/tshock-runtime/cache'); cache.mkdir(parents=True, exist_ok=True)
    archive = confined(root, '.voltra/tshock-runtime/cache/' + expected)
    if not archive.exists():
        url = 'https://builds.dotnet.microsoft.com/dotnet/Runtime/' + VERSION + '/dotnet-runtime-' + VERSION + '-linux-' + arch + '.tar.gz'
        # Fixed HTTPS endpoint, no caller URLs or inherited authorization headers.
        with tempfile.NamedTemporaryFile(prefix='download-', dir=cache, delete=False) as out:
            temporary = Path(out.name)
            try:
                with opener(url, timeout=120) as source:
                    total = 0
                    for block in iter(lambda: source.read(1048576), b''):
                        total += len(block)
                        if total > 64 * 1024**2: raise ValueError('Microsoft runtime download exceeds budget')
                        out.write(block)
                out.flush(); os.fsync(out.fileno())
            except BaseException:
                temporary.unlink(missing_ok=True); raise
        if sha512(temporary) != expected:
            temporary.unlink(); raise ValueError('Microsoft .NET6 publisher SHA512 mismatch')
        os.replace(temporary, archive); sync_directory(cache)
    if not archive.is_file() or archive.stat().st_size > 64 * 1024**2 or sha512(archive) != expected: raise ValueError('Private .NET6 cache failed publisher SHA512 validation')
    return archive


def verify_runtime(root, arch, archive=None):
    archive = archive or runtime_archive(root, arch)
    if sha512(archive) != RUNTIME_PINS[arch]: raise ValueError('Unverified Microsoft runtime archive')
    target = runtime_path(root, arch)
    files = 0
    expected_files, expected_directories = set(), set()
    # Derive expected hashes from the independently verified publisher archive,
    # never from a caller-editable receipt/manifest naming arbitrary programs.
    with tarfile.open(archive, 'r:gz') as source:
        for member, name in runtime_members(source):
            path = confined(target, name)
            parts = safe_name(name).parts
            for depth in range(1, len(parts)): expected_directories.add('/'.join(parts[:depth]))
            if member.isdir():
                expected_directories.add(name)
                if not path.is_dir(): raise ValueError('Private .NET6 runtime directory missing')
                continue
            expected_files.add(name)
            expected = hashlib.sha256(source.extractfile(member).read()).hexdigest()
            if not path.is_file():
                raise ValueError('Private .NET6 runtime file missing')
            if path.stat().st_size != member.size: raise ValueError('Private .NET6 runtime was modified')
            with path.open('rb') as stream: actual = hashlib.file_digest(stream, 'sha256').hexdigest()
            if actual != expected or stat.S_IMODE(path.stat().st_mode) != (0o755 if member.mode & 0o111 else 0o644):
                raise ValueError('Private .NET6 runtime was modified')
            files += 1
    # hostfxr discovery can select a higher version placed alongside the pinned
    # host. Verify a closed-world tree, including implicit parent directories,
    # rather than merely checking that every expected publisher file exists.
    actual_files, actual_directories = set(), set()
    for directory, children, names in os.walk(target, followlinks=False):
        parent = Path(directory)
        for name in children:
            path = parent / name
            if path.is_symlink() or not path.is_dir(): raise ValueError('Unexpected or linked private .NET6 runtime directory')
            actual_directories.add(path.relative_to(target).as_posix())
        for name in names:
            path = parent / name
            if path.is_symlink() or not path.is_file(): raise ValueError('Unexpected or linked private .NET6 runtime file')
            actual_files.add(path.relative_to(target).as_posix())
    if actual_files != expected_files or actual_directories != expected_directories:
        raise ValueError('Private .NET6 runtime contains unexpected files or directories')
    check_elf(confined(target, 'dotnet'), arch)
    check_elf(confined(target, 'host/fxr/' + VERSION + '/libhostfxr.so'), arch)
    check_elf(confined(target, 'shared/Microsoft.NETCore.App/' + VERSION + '/libcoreclr.so'), arch)
    return {'major': 6, 'version': VERSION, 'architecture': arch, 'publisher_sha512': RUNTIME_PINS[arch], 'files_verified': files, 'upstream_supported': False, 'support_ended': EOL}


def ensure_runtime(root, arch, opener=urllib.request.urlopen):
    archive = runtime_archive(root, arch, opener)
    target = runtime_path(root, arch)
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='stage-', dir=target.parent) as temporary:
            ready = Path(temporary) / 'runtime'; ready.mkdir()
            with tarfile.open(archive, 'r:gz') as source:
                for member, name in runtime_members(source):
                    path = ready / name
                    if member.isdir(): path.mkdir(parents=True, exist_ok=True); continue
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with source.extractfile(member) as inp, path.open('xb') as out:
                        shutil.copyfileobj(inp, out); out.flush(); os.fsync(out.fileno())
                    path.chmod(0o755 if member.mode & 0o111 else 0o644)
            check_elf(ready / 'dotnet', arch); check_elf(ready / 'host/fxr' / VERSION / 'libhostfxr.so', arch)
            check_elf(ready / 'shared/Microsoft.NETCore.App' / VERSION / 'libcoreclr.so', arch)
            for directory in sorted((p for p in ready.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True): sync_directory(directory)
            sync_directory(ready); os.replace(ready, target); sync_directory(target.parent)
    return verify_runtime(root, arch, archive)


def plan(root, env, run=subprocess.run, machine=platform.machine()):
    root = Path(root).resolve(); path = confined(root, '.voltra/terraria-release/release.json')
    if not path.is_file() or path.stat().st_size > 16 * 1024**2: raise ValueError('Committed TShock release receipt is missing')
    if confined(root, '.voltra/terraria-release/transaction.json').exists(): raise ValueError('Recover the interrupted release before starting TShock')
    receipt = json.loads(path.read_text()); version = receipt.get('version', '')
    if receipt.get('kind') != 'tshock' or not re.fullmatch(r'[56]\.\d+\.\d+', version): raise ValueError('Unsupported committed TShock runtime family')
    major = 6 if version.startswith('5.') else 9
    arch = {'x86_64': 'x64', 'amd64': 'x64', 'aarch64': 'arm64'}.get(machine)
    if arch is None or receipt.get('arch') != arch: raise ValueError('Committed TShock architecture does not match this node')
    binary = confined(root, 'TShock.Server'); expected = receipt.get('files', {}).get('TShock.Server', {}).get('sha256')
    if not isinstance(expected, str) or not re.fullmatch('[0-9a-f]{64}', expected): raise ValueError('TShock program ownership receipt is missing')
    with binary.open('rb') as source: actual = hashlib.file_digest(source, 'sha256').hexdigest()
    if actual != expected: raise ValueError('TShock program changed after verified publication')
    check_elf(binary, arch)
    config = confined(root, 'TShock.Server.runtimeconfig.json')
    if config.exists(): framework = check_runtime(config, major)
    else: framework = check_bundled_runtime(binary, major)
    if major == 6:
        patch = int(framework['framework_version'].split('.')[2])
        if patch > 36 or (not framework['apply_patches'] or framework['roll_forward'] == 'Disable') and patch != 36:
            raise ValueError('Publisher framework policy cannot use isolated .NET6.0.36 without changing its constraints')
    child = dict(env)
    for key in ('DOTNET_ROOT', 'DOTNET_ROOT_X64', 'DOTNET_ROOT_ARM64', 'DOTNET_ROLL_FORWARD', 'DOTNET_ROLL_FORWARD_TO_PRERELEASE', 'DOTNET_ADDITIONAL_DEPS', 'DOTNET_SHARED_STORE', 'DOTNET_STARTUP_HOOKS', 'LD_PRELOAD', 'LD_AUDIT'):
        child.pop(key, None)
    child['DOTNET_MULTILEVEL_LOOKUP'] = '0'
    child['DOTNET_EnableDiagnostics'] = '0'
    # The app's framework reference is6.0.0/9.0.0. Allow servicing patches only,
    # never a different minor/major; Disable would incorrectly reject6.0.36.
    strict_patch = not framework['apply_patches'] or framework['roll_forward'] == 'Disable'
    child['DOTNET_ROLL_FORWARD'] = 'Disable' if strict_patch else 'LatestPatch'
    if major == 6:
        verify_runtime(root, arch)
        private = runtime_path(root, arch)
        child['DOTNET_ROOT'] = str(private); child['DOTNET_ROOT_' + ('X64' if arch == 'x64' else 'ARM64')] = str(private)
        # Use only the fixed verified runtime host and trusted platform ldd;
        # no execution of an unverified publisher apphost as a probe.
        for library in (private / 'dotnet', private / 'host/fxr' / VERSION / 'libhostfxr.so', private / 'shared/Microsoft.NETCore.App' / VERSION / 'libcoreclr.so'):
            result = run(['ldd', str(library)], capture_output=True, text=True, timeout=10)
            if result.returncode or 'not found' in result.stdout + result.stderr: raise ValueError('The current image lacks a native dependency required by legacy .NET6')
        check_dynamic_dependencies()
        result = run([str(private / 'dotnet'), '--list-runtimes'], capture_output=True, text=True, timeout=10, env=child)
    else:
        result = run(['dotnet', '--list-runtimes'], capture_output=True, text=True, timeout=10, env=child)
    expected_framework = re.escape(framework['framework_version']) if strict_patch else str(major) + r'\.0\.\d+'
    if result.returncode or not re.search(r'^Microsoft\.NETCore\.App ' + expected_framework + r' \[', result.stdout, re.M): raise ValueError('The required exact .NET runtime family or publisher-constrained patch is unavailable')
    port = str(env.get('SERVER_PORT', ''))
    if not re.fullmatch('[1-9][0-9]{0,4}', port) or int(port) > 65535: raise ValueError('Choose a valid allocated TShock game port')
    args = [str(binary), '-config', 'serverconfig.txt', '-configpath', '/home/container/tshock', '-logpath', '/home/container/logs', '-worldselectpath', '/home/container/saves/Worlds', '-ip', '0.0.0.0', '-port', port, '-noupnp']
    return args, child, {'major': major, 'version': version, 'legacy_unsupported': major == 6}


def check_dynamic_dependencies():
    for name in ('ssl', 'crypto', 'icuuc', 'icui18n', 'gssapi_krb5', 'z'):
        library = ctypes.util.find_library(name)
        if library is None: raise ValueError('The current image lacks a native dependency required by legacy .NET6: ' + name)
        try: ctypes.CDLL(library)
        except OSError: raise ValueError('Legacy .NET6 native dependency could not be loaded: ' + name) from None


if __name__ == '__main__':
    args, environment, identity = plan(Path.cwd(), os.environ)
    if identity['legacy_unsupported']: print('Legacy TShock5 uses isolated .NET6; upstream support ended2024-11-12. This is compatibility support, not the recommended default.', flush=True)
    os.execve(args[0], args, environment)
