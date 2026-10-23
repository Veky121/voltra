"""MIT. Official archive publication and explicit private-Steam prerequisite gates."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
import steam_template
from virtual_worlds_runtime import boolean, confined, publish

BASE = 'https://nwn.beamdog.net/downloads/'


def releases():
    return json.loads(Path(__file__).with_name('virtual_worlds_releases.json').read_text())


def prepare_nss(root, library=Path('/usr/lib/x86_64-linux-gnu/libnss_wrapper.so'),
                copyright=Path('/usr/share/doc/libnss-wrapper/copyright')):
    pin = releases()['nss']
    package = subprocess.run(['/usr/bin/dpkg-query', '-W', '-f=${Package} ${Version}\n', 'libnss-wrapper'],
                             env={'PATH': os.defpath, 'LANG': 'C', 'LC_ALL': 'C'}, capture_output=True,
                             text=True, check=True, timeout=10).stdout
    if package != 'libnss-wrapper ' + pin['version'] + '\n':
        raise ValueError('NSS wrapper package differs from the reviewed version')
    pending = []
    for source, name, expected, mode in (
            (library, 'libnss_wrapper.so', pin['sha256'], 0o755),
            (copyright, 'copyright', pin['copyright_sha256'], 0o644)):
        if not source.is_file() or source.is_symlink() or source.stat().st_size > 1024 * 1024:
            raise ValueError('NSS dependency is missing or outside its bounded regular-file contract')
        data = source.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('NSS dependency failed its pinned SHA256')
        relative = '.voltra/virtual-worlds/nss/' + name
        target = confined(root, relative)
        if target.exists():
            if target.read_bytes() != data:
                raise ValueError('Existing private NSS dependency is operator-modified; preserve it for explicit review')
        else:
            pending.append((relative, data, mode))
    for relative, data, mode in pending:
        publish(root, relative, data, mode)
    for name, data in (
            ('package.txt', package.encode()),
            ('sha256.txt', (pin['sha256'] + '  .voltra/virtual-worlds/nss/libnss_wrapper.so\n').encode())):
        relative = '.voltra/virtual-worlds/nss/' + name
        target = confined(root, relative)
        if not target.exists() or target.read_bytes() != data:
            publish(root, relative, data, 0o644)


def fetch(url, limit=4 * 1024 * 1024):
    if not url.startswith(('https://nwn.beamdog.net/', 'https://github.com/', 'https://raw.githubusercontent.com/')):
        raise ValueError('Unreviewed publisher URL')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Voltra-server-setup/1'}), timeout=60) as response:
        if not response.geturl().startswith('https://'):
            raise ValueError('Publisher redirected away from HTTPS')
        value = response.read(limit + 1)
    if len(value) > limit:
        raise ValueError('Publisher response exceeds bounded size')
    return value


def select_nwn(version, index=None):
    if version in ('', 'latest'):
        index = fetch(BASE).decode('utf-8') if index is None else index
        versions = set(re.findall(r'href="nwnee-dedicated-([0-9]+(?:\.[0-9]+)*(?:-[0-9]+)?)\.zip"', index))
        if not versions:
            raise ValueError('Publisher index contains no dedicated-server versions')
        version = max(versions, key=lambda value: tuple(map(int, re.split(r'[.-]', value))))
    if not re.fullmatch(r'[0-9]{4}(?:\.[0-9]{1,4})*(?:-[0-9]{1,4})?', version):
        raise ValueError('Invalid official NWN version')
    filename = 'nwnee-dedicated-' + version + '.zip'
    pinned = releases()['nwn']
    if version == pinned['version']:
        digest = pinned['sha256']
    else:
        checksum = fetch(BASE + filename + '.sha256sum', 1024).decode('ascii').strip()
        match = re.fullmatch(r'([a-fA-F0-9]{64})\s+\*?' + re.escape(filename), checksum)
        if not match:
            raise ValueError('Publisher checksum does not match the selected archive')
        digest = match.group(1).lower()
    return {'version': version, 'url': BASE + filename, 'sha256': digest}


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def archive_members(archive):
    selected = []
    seen = set()
    expanded = 0
    for member in archive.infolist():
        parts = PurePosixPath(member.filename).parts
        if (not parts or member.filename.startswith('/') or '\\' in member.filename or
                any(p in ('.', '..') for p in parts) or ':' in member.filename or
                stat.S_ISLNK(member.external_attr >> 16)):
            raise ValueError('Unsafe dedicated-server archive member')
        if member.filename in seen:
            raise ValueError('Duplicate dedicated-server archive member')
        seen.add(member.filename)
        if member.is_dir():
            continue
        if not (member.filename == 'databuild.txt' or member.filename == 'bin/linux-x86/nwserver-linux' or parts[0] in ('data', 'lang')):
            continue
        expanded += member.file_size
        if member.file_size > 64 * 1024 * 1024 or expanded > 512 * 1024 * 1024 or len(selected) >= 4096:
            raise ValueError('Dedicated-server archive expansion exceeds bounded size')
        selected.append(member)
    if not any(m.filename == 'bin/linux-x86/nwserver-linux' for m in selected):
        raise ValueError('Publisher archive lacks the Linux server executable')
    return selected


def publish_archive(root, archive_path, release):
    """Touch only receipt-owned program files. Never replace user data/modules."""
    receipt_path = confined(root, '.voltra/virtual-worlds/nwn-release.json')
    if receipt_path.exists() and receipt_path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('Native release receipt exceeds bounded size')
    old_receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
    previous = old_receipt.get('files', {})
    if not isinstance(previous, dict):
        raise ValueError('Native release receipt has invalid file metadata')
    changed = []
    with zipfile.ZipFile(archive_path) as archive, tempfile.TemporaryDirectory(prefix='voltra-nwn-rollback-') as temporary:
        selected = archive_members(archive)
        hashes = {}
        for member in selected:
            destination = confined(root, member.filename)
            with archive.open(member) as source:
                expected = hashlib.file_digest(source, 'sha256').hexdigest()
            hashes[member.filename] = expected
            if destination.exists():
                actual = digest(destination)
                if actual == expected:
                    continue
                if previous.get(member.filename) != actual:
                    raise ValueError('A program destination is operator-modified or unmanaged; back it up and resolve the collision before reinstalling')
                backup = Path(temporary) / str(len(changed))
                shutil.copyfile(destination, backup)
                changed.append((member, backup, destination.stat()))
            else:
                changed.append((member, None, None))
        installed = []
        try:
            for member, backup, metadata in changed:
                reserved = {}
                def writer(output):
                    shutil.copyfileobj(source, output)
                    reserved['inode'] = os.fstat(output.fileno())
                with archive.open(member) as source:
                    try:
                        steam_template._publish(root, member.filename, writer,
                                                default_mode=0o755 if member.filename.startswith('bin/') else 0o644)
                    except BaseException:
                        # A publisher may fail its final checks after rename.
                        # Include that destination only when it is our exact
                        # exclusive temporary inode, never an unrelated file.
                        destination = confined(root, member.filename)
                        current = destination.stat() if destination.exists() else None
                        inode = reserved.get('inode')
                        if inode and current and (current.st_dev, current.st_ino) == (inode.st_dev, inode.st_ino):
                            installed.append((member, backup, metadata, current))
                        raise
                installed.append((member, backup, metadata, confined(root, member.filename).stat()))
            receipt = {**release, 'files': hashes, 'source': 'Beamdog official dedicated-server archive', 'native_verified': False}
            publish(root, '.voltra/virtual-worlds/nwn-release.json', (json.dumps(receipt, indent=2) + '\n').encode())
            return receipt
        except BaseException:
            for member, backup, metadata, installed_metadata in reversed(installed):
                destination = confined(root, member.filename)
                current = destination.stat() if destination.exists() else None
                if current and (current.st_dev, current.st_ino) != (installed_metadata.st_dev, installed_metadata.st_ino):
                    raise ValueError('Publication rollback destination changed; preserve it for operator review')
                if backup is None:
                    if current:
                        destination.unlink()
                else:
                    with backup.open('rb') as source:
                        steam_template._publish(root, member.filename, lambda output: shutil.copyfileobj(source, output))
                    os.chmod(destination, stat.S_IMODE(metadata.st_mode))
                    if os.geteuid() == 0:
                        os.chown(destination, metadata.st_uid, metadata.st_gid)
            raise


def install_mods(root, game):
    package = releases()['mods'][game]
    base = '' if game == 'neos' else 'Headless/'
    loader = None
    pending = []
    for asset in package['assets']:
        if game == 'neos':
            relative = 'nml_libs/0Harmony.dll' if asset['name'] == '0Harmony.dll' else asset['name']
        else:
            relative = base + ('rml_libs/0Harmony.dll' if asset['name'] == '0Harmony.dll' else 'Libraries/' + asset['name'])
        target = confined(root, relative)
        if target.exists() and digest(target) != asset['sha256']:
            raise ValueError('Existing mod loader differs from the pinned release; preserve it and resolve the selected version explicitly')
        if not target.exists():
            data = fetch(asset['url'], 8 * 1024 * 1024)
            if len(data) != asset['size'] or hashlib.sha256(data).hexdigest() != asset['sha256']:
                raise ValueError('Mod-loader artifact failed its pinned digest')
            pending.append((relative, data))
        if asset['name'] != '0Harmony.dll':
            loader = target
    for license in package['licenses']:
        relative = '.voltra/virtual-worlds/licenses/' + license['name']
        target = confined(root, relative)
        if target.exists() and digest(target) != license['sha256']:
            raise ValueError('Existing mod-loader license differs from the pinned source')
        if not target.exists():
            data = fetch(license['url'], 65536)
            if len(data) != license['size'] or hashlib.sha256(data).hexdigest() != license['sha256']:
                raise ValueError('Mod-loader license failed its pinned digest')
            pending.append((relative, data))
    # Resolve and validate all assets before writing the first one.
    for relative, data in pending:
        publish(root, relative, data, 0o644)
    return loader


def install(root, game, env):
    root = root.resolve()
    if game in ('neos', 'resonite'):
        app, branch = ('740250', 'headless-client') if game == 'neos' else ('2519830', 'headless')
        if env.get('SRCDS_APPID', app) != app or env.get('SRCDS_BETAID', branch) != branch:
            raise ValueError('This recipe requires its original entitled headless app and branch')
        # This path deliberately performs no bootstrap, config write, mod download
        # or Steam process. The current project has no verified private transport.
        raise ValueError('Entitled headless Steam branch requires private credentials and a beta access code. Private Steam transport is not enabled. Legally acquire the payload separately and select AUTO_UPDATE=0 to run it.')
    if game != 'nwn':
        raise ValueError('Unknown virtual-world recipe')
    prepare_nss(root)
    release = select_nwn(env.get('NWN_VERSION', 'latest'))
    with tempfile.TemporaryDirectory(prefix='voltra-nwn-') as temporary:
        archive_path = Path(temporary) / 'server.zip'
        with urllib.request.urlopen(release['url'], timeout=60) as response, archive_path.open('wb') as output:
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > 128 * 1024 * 1024:
                    raise ValueError('Dedicated-server download exceeds 128 MiB')
                output.write(chunk)
        if digest(archive_path) != release['sha256']:
            raise ValueError('Official dedicated-server archive failed SHA256 verification')
        return publish_archive(root, archive_path, release)


if __name__ == '__main__':
    try:
        install(Path.cwd(), sys.argv[1], dict(os.environ))
    except Exception:
        print('Virtual-world install failed. Private headless Steam installs require unsupported credential transport; NWN requires a valid publisher archive and unmodified managed destinations.', file=sys.stderr)
        sys.exit(1)
