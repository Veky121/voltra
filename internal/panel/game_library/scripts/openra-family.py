#!/usr/bin/env python3
"""MIT. Publisher AppImages, shared staged publication and native OpenRA server."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


release = load('release', 'native-release.py')
publisher = load('publisher', 'small-native-install.py')
MODS = {'ra': 'Red-Alert', 'cnc': 'Tiberian-Dawn', 'd2k': 'Dune-2000'}
PINNED = {
    'ra': ('3cb71c7428188c8526dd8916993fc16fa17ba5f28a35968a8267f3db9f2186fe', 44026360, '8b20afa42a991cedd3f2bf33b6876f4010748f04'),
    'cnc': ('b3d202d1bf701be5989c41c256d19bd2b1788694df01e343ade865cf1190706b', 55323128, 'bc0ce4990971e788f75a3fe1431ab71ce05d645d'),
    'd2k': ('7585986bf0cd488debaec3fadf853c1901003eff945dbad5de95b0b6bd781a67', 47892984, 'ec2d5cc23572fc0e6f07668393e335a6038aa74d'),
}


def get(url, maximum=4*1024**2):
    if not url.startswith('https://'):
        raise ValueError('Publisher downloads require HTTPS')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Voltra-native-installer'}), timeout=120) as response:
        if not response.url.startswith('https://'):
            raise ValueError('Publisher redirected outside HTTPS')
        data = response.read(maximum+1)
    if len(data) > maximum:
        raise ValueError('Publisher response exceeds size limit')
    return data


def selected(version, mod):
    if mod not in MODS:
        raise ValueError('Unsupported bundled OpenRA mod')
    if version in ('latest', 'playtest'):
        version = json.loads(get('https://www.openra.net/versions.json'))['release' if version == 'latest' else 'playtest']
    if not re.fullmatch(r'(release|playtest)-[0-9]{8}', version):
        raise ValueError('Choose latest, playtest or a publisher release/playtest date tag')
    name = 'OpenRA-'+MODS[mod]+'-x86_64.AppImage'
    url = 'https://github.com/OpenRA/OpenRA/releases/download/'+version+'/'+name
    if version == 'release-20250330':
        digest, size, sha1 = PINNED[mod]
        return {'version': version, 'url': url, 'sha256': digest, 'bytes': size, 'sha1': sha1,
                'identity': 'Publisher zsync SHA1 verified; recorded pinned SHA256. Release API has no independent SHA256'}
    metadata = json.loads(get('https://api.github.com/repos/OpenRA/OpenRA/releases/tags/'+version))
    asset = next((a for a in metadata['assets'] if a['name'] == name), None)
    if not asset:
        raise ValueError('Publisher release has no requested Linux x64 AppImage')
    digest = asset.get('digest') or ''
    result = {'version': version, 'url': asset['browser_download_url'], 'bytes': asset['size']}
    if re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        result.update(sha256=digest[7:], identity='Publisher GitHub asset SHA256')
    else:
        zsync = get(url+'.zsync').split(b'\n\n', 1)[0]
        match = re.search(rb'^SHA-1: ([0-9a-f]{40})\r?$', zsync, re.MULTILINE)
        if not match:
            raise ValueError('Publisher asset has neither SHA256 nor zsync SHA1 identity')
        result.update(sha1=match[1].decode(), identity='Publisher zsync SHA1 plus recorded SHA256')
    return result


def install(root, env, mod):
    if os.uname().machine not in ('x86_64', 'amd64'):
        raise ValueError('Publisher AppImage requires Linux x64')
    migrate_support(root)
    asset = selected(env.get('VERSION', 'release-20250330'), mod)
    state = root/'.voltra/openra'
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.install-', dir=state) as temporary:
        stage = Path(temporary)
        archive = stage/'engine.AppImage'
        if 'sha256' in asset:
            release.download(asset, archive)
            if 'sha1' in asset:
                with archive.open('rb') as source:
                    if hashlib.file_digest(source, 'sha1').hexdigest() != asset['sha1']:
                        raise ValueError('Publisher zsync checksum mismatch')
        else:
            data = get(asset['url'], 256*1024**2)
            if len(data) != asset['bytes'] or hashlib.sha1(data).hexdigest() != asset['sha1']:
                raise ValueError('Publisher zsync checksum or asset size mismatch')
            archive.write_bytes(data)
            asset['sha256'] = hashlib.sha256(data).hexdigest()
        archive.chmod(0o755)
        subprocess.run([str(archive), '--appimage-extract'], cwd=stage, check=True, stdout=subprocess.DEVNULL)
        source = stage/'squashfs-root/usr/lib/openra'
        if not (source/'OpenRA.Server').is_file() or not (source/'mods'/mod/'mod.yaml').is_file():
            raise ValueError('Publisher AppImage server or bundled mod missing')
        # Official AppImages are trusted executable archives, but never publish
        # an extracted symlink that points outside their own staged tree.
        extracted = stage/'squashfs-root'
        for entry in source.rglob('*'):
            if entry.is_symlink() and not entry.resolve().is_relative_to(extracted.resolve()):
                raise ValueError('Publisher AppImage link escapes staged tree')
        ready = stage/'ready'
        shutil.copytree(source, ready, symlinks=False)
        publisher.publish(root, ready, root/'openra', {'game': 'openra', 'version': asset['version'], 'mod': mod, 'archive': asset}, 'OpenRA.Server')


def migrate_support(root):
    """Copy original upstream support data without replacing current files."""
    for relative in ('squashfs-root/usr/lib/openra/Support', '.config/openra', '.openra'):
        source = root/relative
        if not source.exists() and not source.is_symlink():
            continue
        if source.is_symlink() or not source.resolve().is_relative_to(root.resolve()):
            raise ValueError('Original support directory escapes server volume')
        for entry in [source, *source.rglob('*')]:
            if entry.is_symlink():
                raise ValueError('Original support data contains a symlink')
            destination = root/'OpenRAData'/entry.relative_to(source)
            if destination.is_symlink() or not destination.resolve().is_relative_to(root.resolve()):
                raise ValueError('Support migration target escapes server volume')
            if entry.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
            elif entry.is_file() and not destination.exists():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(entry, destination)
                metadata=entry.stat()
                os.chown(destination, metadata.st_uid, metadata.st_gid)
        # Upstream uses exactly one preferred support directory.
        break


def text(value, maximum=255):
    if len(value.encode()) > maximum or any(c in value for c in '\r\n\x00'):
        raise ValueError('Native text exceeds byte limit or contains control characters')
    return value


def arguments(root, env, mod):
    if mod not in MODS:
        raise ValueError('Unsupported bundled OpenRA mod')
    port = int(env['SERVER_PORT'])
    if not 1 <= port <= 65535:
        raise ValueError('Invalid allocated port')
    support = root/'OpenRAData'
    support.mkdir(parents=True, exist_ok=True)
    if support.is_symlink() or not support.resolve().is_relative_to(root.resolve()):
        raise ValueError('Support directory escapes server volume')
    argv = [str(root/'openra/OpenRA.Server'), 'Game.Mod='+mod, 'Engine.SupportDir='+str(support),
            'Server.Name='+text(env.get('SERVER_NAME', 'OpenRA Server')),
            'Server.ListenPort='+str(port), 'Server.Password='+text(env.get('PASSWORD', '')),
            'Server.DiscoverNatDevices=False']
    for variable, field, default in [('PUBLIC','AdvertiseOnline','false'), ('SINGLEPLAYER','EnableSingleplayer','false'),
                                     ('AUTH','RequireAuthentication','false'), ('GEOIP','EnableGeoIP','false'),
                                     ('ANONYMOUS','ShareAnonymizedIPs','true'), ('RECORD_REPLAYS','RecordReplays','true')]:
        value = env.get(variable, default)
        if value not in ('true', 'false'):
            raise ValueError('Native boolean must be true or false')
        argv.append('Server.'+field+'='+value)
    if env.get('SERVER_MAP', ''):
        value = env['SERVER_MAP']
        if not re.fullmatch(r'[0-9a-f]{40}', value):
            raise ValueError('Map must be the native SHA1 map UID')
        argv.append('Server.Map='+value)
    return argv


if __name__ == '__main__':
    root = Path.cwd().resolve()
    mod = sys.argv[1]
    if len(sys.argv) > 2 and sys.argv[2] == 'install':
        install(root, os.environ, mod)
    else:
        argv = arguments(root, os.environ, mod)
        os.chdir(root/'openra')
        os.execv(argv[0], argv)
