#!/usr/bin/env python3
"""MIT. Exact official Terraria-family releases with explicit assurance records."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import tarfile
import tempfile
import urllib.parse
import urllib.request
import zipfile
import uuid

PINS = {
    ('vanilla', '1.4.5.8', 'x64'): ('https://terraria.org/api/download/pc-dedicated-server/terraria-server-1458.zip', 'f513a4ac9789d34af766291ae217c9cd7d9472e13782a0e2b17512f70d7a8334'),
    ('tshock', '6.2.1', 'x64'): ('https://github.com/Pryaxis/TShock/releases/download/v6.2.1/TShock-6.2.1-for-Terraria-1.4.5.8-linux-x64-Release.zip', 'deb9189acbdbd2ee0f0a06fffe15358033859a4ba842b22f79a84bda68600105'),
    ('tshock', '6.2.1', 'arm64'): ('https://github.com/Pryaxis/TShock/releases/download/v6.2.1/TShock-6.2.1-for-Terraria-1.4.5.8-linux-arm64-Release.zip', 'bc97babbff40e4291757b000486a82f9bbc2a0bc1360ec2a4213a84b1b772b98'),
    ('legacy', '4.5.18', 'x64'): ('https://github.com/Pryaxis/TShock/releases/download/v4.5.18/TShock4.5.18_Terraria1.4.3.6.zip', '9b42687d0aee173c0de041db359679a6437ada67fbc170a37f92a7216f7b726c'),
    ('tmodloader', '2026.08.3.0', 'x64'): ('https://github.com/tModLoader/tModLoader/releases/download/v2026.08.3.0/tModLoader.zip', '61e865f3702b12ce4a26c5a90b9de99a12c65ffc228455eb3390ce54af1eab15'),
}
PROTECTED = {'saves', 'worlds', 'mods', 'tshock', 'logs', '.voltra', 'serverconfig.txt', 'config.json', 'tmodloaderserver'}
MAX_ARCHIVE = 512 * 1024**2
MAX_UNPACKED = 4 * 1024**3


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1048576), b''): value.update(block)
    return value.hexdigest()


def checksum(value):
    if value and not re.fullmatch('[0-9a-f]{64}', value): raise ValueError('Expected SHA256 must be 64 lowercase hexadecimal characters')
    return value or None


def official(url, metadata=False):
    parsed = urllib.parse.urlsplit(url)
    allowed = {'api.github.com', 'terraria.org', 'www.terraria.org'} if metadata else {'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'terraria.org', 'www.terraria.org'}
    if parsed.scheme != 'https' or parsed.hostname not in allowed or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('Release URL is outside the official HTTPS publisher interface')
    return url


class OfficialRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        official(newurl, req.host == 'api.github.com')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def metadata(url):
    official(url, True)
    request = urllib.request.Request(url, headers={'User-Agent': 'Voltra-Terraria-release', 'Accept': 'application/vnd.github+json'})
    with urllib.request.build_opener(OfficialRedirects()).open(request, timeout=30) as source:
        data = source.read(2 * 1024**2 + 1)
    if len(data) > 2 * 1024**2: raise ValueError('Publisher metadata exceeds limit')
    return json.loads(data)


def resolve(kind, version, arch, expected='', read_metadata=metadata):
    expected = checksum(expected)
    if kind not in ('vanilla', 'tshock', 'legacy', 'tmodloader'): raise ValueError('Unknown Terraria recipe')
    if arch not in ('x64', 'arm64') or arch != 'x64' and kind != 'tshock': raise ValueError('Selected recipe does not support this architecture')
    if version == 'vlatest': raise ValueError('Use latest or an exact numeric release tag')
    version = version.removeprefix('v')
    if kind == 'vanilla' and re.fullmatch(r'1\d{3,5}', version): version = '.'.join(version[:3]) + '.' + version[3:]
    if version != 'latest' and not re.fullmatch(r'\d+(?:\.\d+){1,3}', version): raise ValueError('Invalid exact release version')
    if kind == 'tmodloader' and version.startswith('0.') and not version.startswith('0.11.'):
        raise ValueError('Unsupported legacy tModLoader family; select an exact 0.11 dedicated release or a supported modern release')
    pin = PINS.get((kind, version, arch))
    if pin:
        if expected and expected != pin[1]: raise ValueError('Operator checksum conflicts with reviewed publisher pin')
        result = {'kind': kind, 'version': version, 'arch': arch, 'url': pin[0], 'expected_sha256': pin[1], 'assurance': 'reviewed-checksum'}
        if kind == 'tshock': result['runtime_major'] = 9
        return result
    if kind == 'vanilla':
        if version == 'latest':
            names = read_metadata('https://terraria.org/api/get/dedicated-servers-names')
            if not isinstance(names, list) or not names or not isinstance(names[0], str) or not re.fullmatch(r'terraria-server-1\d{3,5}\.zip', names[0]):
                raise ValueError('Publisher latest Terraria archive identity is invalid')
            compact = names[0][16:-4]
            version = '.'.join(compact[:3]) + '.' + compact[3:]
            return resolve(kind, version, arch, expected, read_metadata)
        if not re.fullmatch(r'1\.[0-9]\.[0-9]\.[0-9]{1,3}', version): raise ValueError('Unsupported Terraria archive version layout')
        url = 'https://terraria.org/api/download/pc-dedicated-server/terraria-server-' + version.replace('.', '') + '.zip'
        return {'kind': kind, 'version': version, 'arch': arch, 'url': url, 'expected_sha256': expected, 'assurance': 'operator-checksum' if expected else 'publisher-HTTPS'}
    repo = 'tModLoader/tModLoader' if kind == 'tmodloader' else 'Pryaxis/TShock'
    endpoint = 'latest' if version == 'latest' else 'tags/v' + version
    release = read_metadata('https://api.github.com/repos/' + repo + '/releases/' + endpoint)
    tag = release.get('tag_name', '')
    if release.get('draft') or release.get('prerelease') or not re.fullmatch(r'v\d+(?:\.\d+){1,3}', tag) or version != 'latest' and tag != 'v' + version:
        raise ValueError('Publisher release is not the exact requested stable tag')
    version = tag[1:]
    if kind == 'tshock' and not version.startswith(('5.', '6.')) or kind == 'legacy' and not version.startswith('4.'):
        raise ValueError('Selected TShock release requires another runtime family/recipe')
    candidates = []
    for asset in release.get('assets', []):
        name = asset.get('name', '')
        if kind == 'tmodloader': matches = name == ('tModLoader.Linux.v' + version + '.zip' if version.startswith('0.11.') else 'tModLoader.zip')
        elif kind == 'legacy': matches = bool(re.fullmatch('TShock' + re.escape(version) + r'_Terraria1\.[0-9.]+\.zip', name))
        else:
            publisher_arch = r'(?:x64|amd64)' if arch == 'x64' else 'arm64'
            matches = bool(re.fullmatch('TShock-' + re.escape(version) + r'-for-Terraria-1\.[0-9.]+-linux-' + publisher_arch + r'-Release\.zip', name))
        if matches: candidates.append(asset)
    if len(candidates) != 1: raise ValueError('Exact release has no unique compatible publisher archive')
    asset = candidates[0]
    prefix = 'https://github.com/' + repo + '/releases/download/' + tag + '/'
    url = official(asset.get('browser_download_url', ''))
    if url != prefix + asset['name']: raise ValueError('Publisher asset URL/tag/name mismatch')
    published = asset.get('digest')
    if published is not None and not re.fullmatch(r'sha256:[0-9a-f]{64}', published): raise ValueError('Invalid publisher checksum')
    published = published[7:] if published else None
    if expected and published and expected != published: raise ValueError('Operator and publisher checksums disagree')
    size = asset.get('size')
    if not isinstance(size, int) or isinstance(size, bool) or not 0 < size <= MAX_ARCHIVE: raise ValueError('Invalid publisher archive size')
    result = {'kind': kind, 'version': version, 'arch': arch, 'url': url, 'bytes': size, 'expected_sha256': published or expected,
              'assurance': 'publisher-checksum' if published else 'operator-checksum' if expected else 'publisher-HTTPS'}
    if kind == 'tshock': result['runtime_major'] = 6 if version.startswith('5.') else 9
    return result


def acquire(release, destination, cache):
    official(release['url'])
    expected = release['expected_sha256']
    cache.mkdir(parents=True, exist_ok=True)
    if cache.is_symlink(): raise ValueError('Release cache must not be a symlink')
    cached = cache / expected if expected else None
    if cached and cached.exists():
        if cached.is_symlink() or not cached.is_file() or digest(cached) != expected: raise ValueError('Release cache integrity failed')
        shutil.copyfile(cached, destination)
    else:
        request = urllib.request.Request(release['url'], headers={'User-Agent': 'Voltra-Terraria-release'})
        with urllib.request.build_opener(OfficialRedirects()).open(request, timeout=120) as source, destination.open('xb') as output:
            total = 0
            for block in iter(lambda: source.read(1048576), b''):
                total += len(block)
                if total > MAX_ARCHIVE: raise ValueError('Archive exceeds download limit')
                output.write(block)
    if release.get('bytes') and destination.stat().st_size != release['bytes']: raise ValueError('Publisher archive size mismatch')
    observed = digest(destination)
    if expected and observed != expected: raise ValueError('Publisher archive checksum mismatch')
    if expected and not cached.exists():
        shutil.copyfile(destination, cached)
    # Without an independent hash, do not treat a prior local cache as publisher
    # authentication for a new request. The observation remains in the receipt.
    return observed


def safe_name(name):
    if not name or name.startswith('/') or '\\' in name or ':' in name or any(ord(c) < 32 for c in name): raise ValueError('Unsafe archive name')
    parts = name.rstrip('/').split('/')
    if any(p in ('', '.', '..') for p in parts): raise ValueError('Unsafe archive traversal')
    return PurePosixPath(*parts)


def unpack(archive, target, tar=False):
    seen, total, entries = set(), 0, []
    source = tarfile.open(archive, 'r:*') if tar else zipfile.ZipFile(archive)
    with source:
        members = source.getmembers() if tar else source.infolist()
        for member in members:
            name = member.name if tar else member.filename
            relative = safe_name(name)
            key = relative.as_posix().casefold()
            directory = member.isdir() if tar else member.is_dir()
            mode = member.mode if tar else member.external_attr >> 16
            if key in seen or (not (member.isdir() or member.isfile()) if tar else stat.S_IFMT(mode) not in (0, stat.S_IFDIR, stat.S_IFREG)):
                raise ValueError('Archive duplicate/link/special file unsupported')
            seen.add(key)
            size = member.size if tar else member.file_size
            total += size
            if len(seen) > 100000 or total > MAX_UNPACKED: raise ValueError('Archive exceeds unpacked budget')
            entries.append((member, relative, directory, mode))
        # Validate all names and types before writing any member.
        for member, relative, directory, mode in entries:
            destination = target.joinpath(*relative.parts)
            if directory: destination.mkdir(parents=True, exist_ok=True); continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with (source.extractfile(member) if tar else source.open(member)) as inp, destination.open('xb') as output:
                shutil.copyfileobj(inp, output)
            destination.chmod(0o755 if mode & 0o111 else 0o644)


def payload(release, extracted, work):
    kind = release['kind']
    if kind == 'vanilla':
        content = extracted / release['version'].replace('.', '') / 'Linux'
        binary = content / 'TerrariaServer.bin.x86_64'
        check_elf(binary, 'x64')
        binary.chmod(0o755)
    elif kind == 'tshock':
        packages = list(extracted.glob('TShock-*.tar'))
        if len(packages) != 1: raise ValueError('TShock archive requires one native release package')
        content = work / 'content'; content.mkdir(); unpack(packages[0], content, tar=True)
        if not (content / 'TShock.Server').is_file(): raise ValueError('TShock Linux launcher is missing')
        check_elf(content / 'TShock.Server', release['arch'])
        config = content / 'TShock.Server.runtimeconfig.json'
        major = 6 if release['version'].startswith('5.') else 9
        if release.get('runtime_major', major) != major: raise ValueError('Publisher release runtime expectation mismatch')
        if config.is_file(): identity = check_runtime(config, major)
        else: identity = check_bundled_runtime(content / 'TShock.Server', major)
        release['runtime_major'] = major
        release['runtime_framework'] = identity
        if major == 6:
            reference_patch = int(identity['framework_version'].split('.')[2])
            if reference_patch > 36 or (not identity['apply_patches'] or identity['roll_forward'] == 'Disable') and reference_patch != 36:
                raise ValueError('Publisher disables compatible servicing patches or requires a newer .NET6 patch than isolated6.0.36')
        (content / 'TShock.Server').chmod(0o755)
    elif kind == 'legacy':
        content = extracted
        binary = content / 'TerrariaServer.exe'
        if not binary.is_file() or binary.read_bytes()[:2] != b'MZ': raise ValueError('Legacy TShock requires the Mono Terraria launcher')
    else:
        content = extracted
        from tmodloader_runtime import inspect_payload
        inspect_payload(content, release)
        if release['runtime_family'] == 'mono-kickstart': (content / 'tModLoaderServer.bin.x86_64').chmod(0o755)
    return content


def check_elf(binary, arch):
    if not binary.is_file(): raise ValueError('Publisher Linux executable is missing')
    with binary.open('rb') as source: header = source.read(20)
    machine = 62 if arch == 'x64' else 183
    if len(header) != 20 or header[:6] != b'\x7fELF\x02\x01' or int.from_bytes(header[18:20], 'little') != machine:
        raise ValueError('Publisher executable architecture does not match the selected Linux platform')


def check_bundled_runtime(binary, major):
    # Framework-dependent single-file apphosts carry their actual runtimeconfig
    # JSON in the bundle. Require one complete config rather than infer from tag.
    if binary.stat().st_size > MAX_ARCHIVE: raise ValueError('Publisher launcher exceeds inspection budget')
    data = binary.read_bytes()
    starts = list(re.finditer(rb'\{\s*"runtimeOptions"\s*:', data))
    if len(starts) != 1: raise ValueError('Single-file publisher runtime identity is ambiguous or missing')
    try: value, _ = json.JSONDecoder().raw_decode(data[starts[0].start():starts[0].start()+65536].decode('utf-8', errors='ignore'))
    except (ValueError, UnicodeError): raise ValueError('Invalid bundled runtime identity') from None
    return runtime_identity(value['runtimeOptions'], major)


def check_runtime(config, major):
    if not config.is_file() or config.stat().st_size > 65536: raise ValueError('Publisher runtime identity is missing')
    value = json.loads(config.read_text())['runtimeOptions']
    return runtime_identity(value, major)


def runtime_identity(value, major):
    framework = value.get('framework', {})
    if framework.get('name') != 'Microsoft.NETCore.App' or not re.fullmatch(str(major) + r'\.0\.\d+', framework.get('version', '')) or value.get('tfm') != 'net' + str(major) + '.0':
        raise ValueError('Selected release requires another .NET runtime family')
    apply_patches = value.get('applyPatches', framework.get('applyPatches', True))
    roll_forward = value.get('rollForward', framework.get('rollForward', 'LatestPatch'))
    if not isinstance(apply_patches, bool) or roll_forward not in ('Disable','LatestPatch','Minor','LatestMinor','Major','LatestMajor'):
        raise ValueError('Unsupported publisher framework servicing policy')
    return {'major': major, 'tfm': value['tfm'], 'framework': framework['name'], 'framework_version': framework['version'], 'apply_patches': apply_patches, 'roll_forward': roll_forward}


def confined(root, relative):
    path = root
    for part in safe_name(relative).parts:
        path = path / part
        if path.is_symlink(): raise ValueError('Publication path contains a symlink')
    return path


def sync_directory(path):
    if os.name != 'posix': return
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def durable_json(path, value):
    temporary = path.with_name(path.name + '.new')
    if temporary.is_symlink(): raise ValueError('Unsafe transaction temporary path')
    with temporary.open('w') as out:
        json.dump(value, out); out.flush(); os.fsync(out.fileno())
    os.replace(temporary, path); sync_directory(path.parent)


def copy_identity(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    if hasattr(os, 'chown'):
        identity = source.stat(); os.chown(destination, identity.st_uid, identity.st_gid)
    with destination.open('rb') as stream:
        if os.name == 'posix': os.fsync(stream.fileno())
    sync_directory(destination.parent)


def recover(root, state):
    journal = confined(root, '.voltra/terraria-release/transaction.json')
    if not journal.exists(): return
    if journal.stat().st_size > 32 * 1024**2: raise ValueError('Invalid transaction journal')
    transaction = json.loads(journal.read_text())
    if not re.fullmatch(r'rollback-[0-9a-f]{32}', transaction.get('backup', '')): raise ValueError('Invalid transaction backup')
    backup = confined(root, '.voltra/terraria-release/' + transaction['backup'])
    # Preflight every backup before restoring anything. Preserve backup copies
    # until all restoration succeeds so a second recovery can safely retry.
    for record in transaction['records']:
        confined(root, record['path'])
        if record['old_sha256']:
            saved = confined(backup, record['path'])
            if not saved.is_file() or digest(saved) != record['old_sha256']: raise ValueError('Recovery backup failed integrity validation')
    for record in reversed(transaction['records']):
        destination = confined(root, record['path'])
        if record['old_sha256']:
            temporary = destination.with_name(destination.name + '.voltra-recover')
            if temporary.is_symlink(): raise ValueError('Unsafe recovery temporary file')
            copy_identity(backup / record['path'], temporary); os.replace(temporary, destination)
        elif destination.exists(): destination.unlink()
        if destination.parent.exists(): sync_directory(destination.parent)
    for name in reversed(transaction.get('directories', [])):
        directory = confined(root, name)
        if directory.is_dir() and not any(directory.iterdir()): directory.rmdir()
    journal.unlink(); sync_directory(state); shutil.rmtree(backup)


def adopt_pinned(root, content, release, archive_sha256):
    pin = PINS.get((release['kind'], release['version'], release['arch']))
    if pin is None or archive_sha256 != pin[1]: raise ValueError('Migration requires the exact independently verified pinned archive')
    files = {}
    for source in content.rglob('*'):
        name = source.relative_to(content).as_posix()
        if name.split('/')[0].casefold() in PROTECTED or source.is_dir(): continue
        destination = confined(root, name)
        if destination.exists():
            if source.is_symlink() or not destination.is_file() or digest(destination) != digest(source): raise ValueError('Pinned migration refuses operator-modified runtime: ' + name)
            files[name] = {'sha256': digest(source), 'mode': stat.S_IMODE(destination.stat().st_mode)}
    return {'kind': release['kind'], 'files': files, 'adopted_from_reviewed_archive': archive_sha256}


def publish(root, content, release, archive_sha256, state, before_replace=lambda name: None, baseline=None):
    recover(root, state)
    receipt = state / 'release.json'
    if receipt.is_symlink(): raise ValueError('Unsafe release receipt')
    old = json.loads(receipt.read_text()) if receipt.is_file() else baseline or {}
    if old and old.get('kind') != release['kind']: raise ValueError('Existing release belongs to another recipe')
    files = {}
    for source in content.rglob('*'):
        name = source.relative_to(content).as_posix()
        if name.split('/')[0].casefold() in PROTECTED or source.is_dir(): continue
        if source.is_symlink() or not source.is_file(): raise ValueError('Unsafe staged payload type')
        destination = confined(root, name)
        if destination.exists() and (not destination.is_file() or old.get('files', {}).get(name, {}).get('sha256') != digest(destination)):
            raise ValueError('Unowned or operator-modified runtime file conflicts: ' + name)
        if destination.exists():
            identity = destination.stat()
            source.chmod(stat.S_IMODE(identity.st_mode))
            if hasattr(os, 'chown'): os.chown(source, identity.st_uid, identity.st_gid)
        files[name] = {'sha256': digest(source), 'mode': stat.S_IMODE(source.stat().st_mode)}
    if not files: raise ValueError('Empty release publication')
    obsolete = []
    for name, previous in old.get('files', {}).items():
        if name in files: continue
        destination = confined(root, name)
        if name.split('/')[0].casefold() in PROTECTED: raise ValueError('Old receipt conflicts with protected operator data')
        if destination.exists():
            if not destination.is_file() or digest(destination) != previous['sha256']: raise ValueError('Operator-modified obsolete runtime file conflicts: ' + name)
            obsolete.append(name)
    backup = state / ('rollback-' + uuid.uuid4().hex); backup.mkdir(mode=0o700)
    names = [*files, *obsolete, '.voltra/terraria-release/release.json']
    records, directories = [], set()
    for name in names:
        destination = confined(root, name)
        parent = destination.parent
        while parent != root and not parent.exists(): directories.add(parent.relative_to(root).as_posix()); parent = parent.parent
        old_digest = digest(destination) if destination.exists() else None
        if old_digest: copy_identity(destination, backup / name)
        records.append({'path': name, 'old_sha256': old_digest})
    durable_json(state / 'transaction.json', {'backup': backup.name, 'records': records, 'directories': sorted(directories, key=lambda name: len(PurePosixPath(name).parts))})
    try:
        for name in [*files, *obsolete]:
            destination = confined(root, name); destination.parent.mkdir(parents=True, exist_ok=True)
            before_replace(name)
            if name in files:
                with (content / name).open('rb') as stream:
                    if os.name == 'posix': os.fsync(stream.fileno())
                os.replace(content / name, destination)
            else: destination.unlink()
            sync_directory(destination.parent); before_replace('after:' + name)
        durable_json(receipt, {**release, 'archive_sha256': archive_sha256, 'files': files, 'adopted_from_reviewed_archive': old.get('adopted_from_reviewed_archive'), 'native_runtime_verified': False})
        before_replace('after:receipt')
        (state / 'transaction.json').unlink(); sync_directory(state)
        shutil.rmtree(backup)
    except BaseException:
        recover(root, state)
        raise


def initialize(root, kind, env):
    for name in ('saves/Worlds', 'mods') if kind == 'tmodloader' else ('saves/Worlds', 'tshock', 'logs') if kind in ('tshock', 'legacy') else ('saves/Worlds',):
        confined(root, name).mkdir(parents=True, exist_ok=True)
    config = confined(root, 'serverconfig.txt')
    if not config.exists():
        with config.open('x') as out:
            out.write('worldpath=/home/container/saves/Worlds\nworldname=world\nworld=/home/container/saves/Worlds/world.wld\nautocreate=1\ndifficulty=0\nport=7777\nmaxplayers=8\nupnp=0\n')
    if kind in ('tshock', 'legacy'):
        config = confined(root, 'tshock/config.json')
        if not config.exists():
            with config.open('x') as out: json.dump({'Settings': {'ServerName': env.get('SERVER_NAME', 'TShock server'), 'ServerPassword': env.get('SERVER_PASSWORD', ''), 'MaxSlots': int(env.get('MAX_PLAYERS', '8')), 'ServerPort': 7777, 'UseServerName': True, 'RestApiEnabled': False, 'AutoSave': True}}, out)
    if kind == 'tmodloader':
        enabled = confined(root, 'mods/enabled.json')
        if not enabled.exists(): enabled.write_text('[]\n')
        receipt = json.loads(confined(root, '.voltra/terraria-release/release.json').read_text())
        if receipt.get('runtime_family') == 'mono-kickstart': return
        native = confined(root, 'Libraries/Native/Linux')
        library = native / 'libSDL2-2.0.so.0'
        alias = native / 'libSDL2.so'
        # A fixed relative alias is needed by this family's native loader.
        if not library.is_file(): raise ValueError('tModLoader SDL native library is missing')
        if alias.is_symlink():
            if os.readlink(alias) != 'libSDL2-2.0.so.0': raise ValueError('Operator SDL alias conflicts with the loader')
        elif not alias.exists(): alias.symlink_to('libSDL2-2.0.so.0')


def preflight_operator_paths(root, kind, env):
    for name in ('saves/Worlds', 'mods', 'tshock', 'logs'):
        path = confined(root, name)
        if path.exists() and not path.is_dir(): raise ValueError('Operator data directory conflicts: ' + name)
    for name in ('serverconfig.txt', 'mods/enabled.json', 'tshock/config.json'):
        path = confined(root, name)
        if path.exists() and not path.is_file(): raise ValueError('Operator configuration path conflicts: ' + name)
    if kind in ('tshock', 'legacy') and not 1 <= int(env.get('MAX_PLAYERS', '8')) <= 255: raise ValueError('Invalid TShock player limit')
    if kind == 'tmodloader':
        parent = confined(root, 'Libraries/Native/Linux')
        alias = parent / 'libSDL2.so'
        if alias.is_symlink() and os.readlink(alias) != 'libSDL2-2.0.so.0': raise ValueError('Operator SDL alias conflicts with the loader')


def install(root, env, read_metadata=metadata, download=acquire, machine=platform.machine()):
    root = Path(root).resolve()
    state = confined(root, '.voltra/terraria-release'); state.mkdir(parents=True, exist_ok=True)
    lock_path = confined(root, '.voltra/terraria-release/install.lock')
    with lock_path.open('a+b') as lock:
        if os.name == 'posix':
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return _install(root, env, read_metadata, download, machine)


def _install(root, env, read_metadata, download, machine):
    root = Path(root).resolve()
    kind = env['VOLTRA_TERRARIA_KIND']
    key = 'TERRARIA_VERSION' if kind == 'vanilla' else 'VERSION' if kind == 'tmodloader' else 'TSHOCK_VERSION'
    arch = {'x86_64': 'x64', 'amd64': 'x64', 'aarch64': 'arm64'}.get(machine, '')
    release = resolve(kind, env[key], arch, env.get('RELEASE_SHA256', ''), read_metadata)
    state = confined(root, '.voltra/terraria-release'); state.mkdir(parents=True, exist_ok=True)
    recover(root, state)
    with tempfile.TemporaryDirectory(prefix='stage-', dir=state) as temporary:
        work = Path(temporary); archive = work / 'archive.zip'
        observed = download(release, archive, confined(root, '.voltra/public-cache'))
        extracted = work / 'unpacked'; extracted.mkdir(); unpack(archive, extracted)
        content = payload(release, extracted, work)
        # Validate operator data before publishing either the private framework
        # or the selected game release.
        preflight_operator_paths(root, kind, env)
        if kind == 'tmodloader':
            from tmodloader_runtime import compatibility_preflight
            compatibility_preflight(root, release, env)
        if kind == 'tshock' and release['runtime_major'] == 6:
            from tshock_runtime import ensure_runtime
            release['private_runtime'] = ensure_runtime(root, arch)
        if kind == 'tmodloader' and release['runtime_major'] == 6:
            from tshock_runtime import ensure_runtime
            release['private_runtime'] = ensure_runtime(root, arch)
        baseline = None
        runtime_name = {'vanilla': 'TerrariaServer.bin.x86_64', 'tshock': 'TShock.Server', 'legacy': 'TerrariaServer.exe', 'tmodloader': 'tModLoader.dll'}[kind]
        if kind == 'tmodloader' and release['runtime_family'] == 'mono-kickstart': runtime_name = 'tModLoaderServer.bin.x86_64'
        if not (state / 'release.json').exists() and confined(root, runtime_name).exists():
            pinned_version = next(version for (family, version, architecture) in PINS if family == kind and architecture == arch)
            if release['version'] == pinned_version:
                baseline = adopt_pinned(root, content, release, observed)
            else:
                pinned = resolve(kind, pinned_version, arch)
                migration = work / 'migration'; migration.mkdir()
                pinned_archive = migration / 'archive.zip'
                pinned_digest = download(pinned, pinned_archive, confined(root, '.voltra/public-cache'))
                unpacked = migration / 'unpacked'; unpacked.mkdir(); unpack(pinned_archive, unpacked)
                pinned_content = payload(pinned, unpacked, migration)
                baseline = adopt_pinned(root, pinned_content, pinned, pinned_digest)
        publish(root, content, release, observed, state, baseline=baseline)
        initialize(root, kind, env)
    print('Exact official release installed; assurance=' + release['assurance'] + '; native runtime remains unverified.', flush=True)
