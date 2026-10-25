#!/usr/bin/env python3
"""MIT. Verified dedicated tModLoader runtime selection; no shell interpolation."""
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess

from terraria_release_install import check_elf, check_runtime, confined, digest


def managed_assembly(path):
    if not path.is_file(): return False
    with path.open('rb') as source: return source.read(2) == b'MZ'


def verify_sdl_alias(root):
    parent = confined(root, 'Libraries/Native/Linux')
    library = confined(root, 'Libraries/Native/Linux/libSDL2-2.0.so.0')
    alias = parent / 'libSDL2.so'
    if alias.is_symlink():
        if os.readlink(alias) != 'libSDL2-2.0.so.0': raise ValueError('SDL compatibility alias has an unsafe target; restore the fixed relative publisher-library alias')
    elif not alias.is_file() or digest(alias) != digest(library):
        raise ValueError('SDL compatibility alias is missing or changed; restore the fixed publisher-library alias before starting')


def inspect_payload(content, release):
    """Derive the family from the actual publisher payload, never the tag alone."""
    if release['version'].startswith('0.11.'):
        for name in ('tModLoaderServer.exe', 'mscorlib.dll', 'System.dll', 'FNA.dll'):
            path = confined(content, name)
            if not managed_assembly(path):
                raise ValueError('Legacy dedicated Mono assembly is missing: ' + name)
        for name in ('monoconfig', 'monomachineconfig', 'lib64/libSDL2-2.0.so.0'):
            if not confined(content, name).is_file(): raise ValueError('Legacy dedicated dependency is missing: ' + name)
        binary = confined(content, 'tModLoaderServer.bin.x86_64')
        check_elf(binary, 'x64')
        check_elf(confined(content, 'lib64/libSDL2-2.0.so.0'), 'x64')
        release.update(runtime_family='mono-kickstart', runtime_major=None, terraria_version='1.3.5.3')
    else:
        assembly = confined(content, 'tModLoader.dll')
        if not managed_assembly(assembly): raise ValueError('tModLoader managed assembly is missing')
        config = confined(content, 'tModLoader.runtimeconfig.json')
        if config.stat().st_size > 1024**2: raise ValueError('Publisher runtime configuration exceeds limit')
        raw = json.loads(config.read_text()).get('runtimeOptions', {})
        major = { 'net6.0': 6, 'net8.0': 8 }.get(raw.get('tfm'))
        if major is None: raise ValueError('Unsupported publisher tModLoader framework; supported families are net6 and net8')
        framework = check_runtime(config, major)
        if major == 6:
            patch = int(framework['framework_version'].split('.')[2])
            if patch > 36 or (not framework['apply_patches'] or framework['roll_forward'] == 'Disable') and patch != 36:
                raise ValueError('Publisher framework constraints cannot use isolated .NET6.0.36')
        deps_path = confined(content, 'tModLoader.deps.json')
        if deps_path.stat().st_size > 16 * 1024**2: raise ValueError('Publisher dependency inventory exceeds limit')
        deps = json.loads(deps_path.read_text())
        bases = [name[11:] for name in deps.get('libraries', {}) if name.startswith('tModLoader/')]
        if len(bases) != 1 or not re.fullmatch(r'1\.4\.[34]\.\d+', bases[0]): raise ValueError('Unsupported or ambiguous publisher Terraria branch')
        check_elf(confined(content, 'Libraries/Native/Linux/libSDL2-2.0.so.0'), 'x64')
        release.update(runtime_family='dotnet', runtime_major=major, runtime_framework=framework, terraria_version=bases[0])
    return content


def compatibility_preflight(root, release, env=None):
    """Check enabled mod metadata; preserve unselected worlds and disabled mods."""
    env = env or {}
    enabled = confined(root, 'mods/enabled.json')
    if enabled.is_file():
        if enabled.stat().st_size > 1024**2: raise ValueError('Enabled mod inventory exceeds limit')
        names = json.loads(enabled.read_text())
        if not isinstance(names, list) or len(names) > 10000 or any(not isinstance(name, str) or not re.fullmatch('[A-Za-z0-9_]{1,128}', name) for name in names): raise ValueError('Enabled mod inventory is invalid')
        selected = tuple(map(int, release['version'].split('.')))[:2]
        for name in names:
            path = confined(root, 'mods/' + name + '.tmod')
            if not path.is_file(): continue  # Publisher reports a missing selected mod.
            with path.open('rb') as source:
                if source.read(4) != b'TMOD': raise ValueError('Enabled mod has an invalid TMOD header: ' + name)
                # BinaryReader.ReadString uses a 7-bit encoded UTF8 byte length.
                length = 0
                for shift in range(0, 35, 7):
                    byte = source.read(1)
                    if not byte: raise ValueError('Truncated enabled mod version: ' + name)
                    length |= (byte[0] & 127) << shift
                    if byte[0] < 128: break
                else: raise ValueError('Invalid enabled mod version length: ' + name)
                if not 1 <= length <= 64: raise ValueError('Invalid enabled mod version length: ' + name)
                version = source.read(length).decode('utf8')
            if not re.fullmatch(r'\d+(?:\.\d+){1,3}', version): raise ValueError('Invalid enabled mod tModLoader version: ' + name)
            built = tuple(map(int, version.split('.')))[:2]
            cross_legacy = built == (0, 11) and selected[0] >= 2022 or selected == (0, 11) and built[0] >= 2022
            if cross_legacy or built > selected:
                raise ValueError('Enabled mod ' + name + ' targets incompatible/newer tModLoader ' + version + '; select matching release/mods or a separate server. Files were preserved')
    # World parsing/migration remains the publisher's responsibility. A prior
    # receipt cannot prove an arbitrary selected world's format. The publisher
    # explicitly rejects future worlds; never erase one or substitute another.


def plan(root, env, run=subprocess.run, machine=platform.machine()):
    root = Path(root).resolve()
    if machine not in ('x86_64', 'amd64'): raise ValueError('These verified tModLoader releases require Linux x64')
    if confined(root, '.voltra/terraria-release/transaction.json').exists(): raise ValueError('Recover the interrupted release before starting tModLoader')
    path = confined(root, '.voltra/terraria-release/release.json')
    if not path.is_file() or path.stat().st_size > 16 * 1024**2: raise ValueError('Committed tModLoader release receipt is missing')
    receipt = json.loads(path.read_text())
    if receipt.get('kind') != 'tmodloader' or receipt.get('arch') != 'x64': raise ValueError('Committed tModLoader recipe/architecture mismatch')
    files = receipt.get('files', {})
    if not files: raise ValueError('Committed publisher file inventory is missing')
    for name, identity in files.items():
        file = confined(root, name)
        if not file.is_file() or digest(file) != identity.get('sha256'): raise ValueError('Publisher runtime changed after publication: ' + name)
    observed = dict(receipt); inspect_payload(root, observed)
    for key in ('runtime_family', 'runtime_major', 'terraria_version'):
        if receipt.get(key) != observed[key]: raise ValueError('Committed runtime identity differs from publisher files')
    required = ('tModLoaderServer.bin.x86_64', 'tModLoaderServer.exe', 'mscorlib.dll', 'System.dll', 'FNA.dll', 'monoconfig', 'monomachineconfig', 'lib64/libSDL2-2.0.so.0') if observed['runtime_family'] == 'mono-kickstart' else ('tModLoader.dll', 'tModLoader.runtimeconfig.json', 'tModLoader.deps.json', 'Libraries/Native/Linux/libSDL2-2.0.so.0')
    if any(name not in files for name in required): raise ValueError('Publisher runtime dependency ownership is missing')
    compatibility_preflight(root, observed, env)
    child = dict(env)
    for key in tuple(child):
        if key.startswith(('DOTNET_', 'MONO_')) or key in ('LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH'): child.pop(key)
    common = ['-config', 'serverconfig.txt', '-savedirectory', '/home/container/saves', '-tmlsavedirectory', '/home/container/saves', '-modpath', '/home/container/mods']
    language = str(env.get('LANGUAGE', '1'))
    if not re.fullmatch('[1-9]', language): raise ValueError('Choose a supported Terraria language from1 to9')
    common += ['-lang', language]
    if observed['runtime_family'] == 'mono-kickstart':
        child['MONO_IOMAP'] = 'all'
        args = [str(confined(root, 'tModLoaderServer.bin.x86_64')), *common]
    else:
        verify_sdl_alias(root)
        framework = observed['runtime_framework']; major = observed['runtime_major']
        strict = not framework['apply_patches'] or framework['roll_forward'] == 'Disable'
        child.update(DOTNET_MULTILEVEL_LOOKUP='0', DOTNET_EnableDiagnostics='0', DOTNET_ROLL_FORWARD='Disable' if strict else 'LatestPatch')
        child['LD_LIBRARY_PATH'] = str(confined(root, 'Libraries/Native/Linux'))
        if major == 6:
            from tshock_runtime import verify_runtime, runtime_path, check_dynamic_dependencies
            verify_runtime(root, 'x64'); check_dynamic_dependencies()
            private = runtime_path(root, 'x64'); host = str(private / 'dotnet')
            child['DOTNET_ROOT'] = str(private); child['DOTNET_ROOT_X64'] = str(private)
        else:
            host = shutil.which('dotnet', path=env.get('PATH'))
            if not host: raise ValueError('The selected image does not contain .NET8')
        result = run([host, '--list-runtimes'], capture_output=True, text=True, timeout=10, env=child)
        version = re.escape(framework['framework_version']) if strict else str(major) + r'\.0\.\d+'
        if result.returncode or not re.search(r'^Microsoft\.NETCore\.App ' + version + r' \[', result.stdout, re.M): raise ValueError('Required publisher framework family/patch is unavailable')
        args = [host, str(confined(root, 'tModLoader.dll')), '-server', *common]
    return args, child, {'family': observed['runtime_family'], 'major': observed['runtime_major'], 'version': receipt['version'], 'terraria_version': observed['terraria_version']}


if __name__ == '__main__':
    argv, environment, identity = plan(Path.cwd(), os.environ)
    if identity['major'] == 6: print('This legacy release uses .NET6.0.36, whose upstream support ended2024-11-12.', flush=True)
    os.execve(argv[0], argv, environment)
