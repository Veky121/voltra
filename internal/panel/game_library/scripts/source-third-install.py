#!/usr/bin/env python3
"""MIT. Scoped CS2/Sven/legacy TF2C acquisition; no substitution of games."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
import urllib.request
import urllib.parse
import source_install
from source_next_install import apply_payload

RECIPES = {'cs2': (730, 'game/csgo', 'game/bin/linuxsteamrt64/cs2'),
           'sven': (276060, 'svencoop', 'svends_run'),
           'tf2classic': (244310, 'tf2classic', 'srcds_run')}
HOSTS = ('wiki.tf2classic.com', 'wiki.tf2classified.com')


def selection(env):
    kind = env.get('VOLTRA_SOURCE_THIRD', '')
    if kind not in RECIPES: raise ValueError('Choose a reviewed Source profile')
    app, game, executable = RECIPES[kind]
    if env.get('SRCDS_APPID', str(app)) != str(app): raise ValueError('Application does not match profile')
    if kind == 'tf2classic' and env.get('SRCDS_GAME', game) != game: raise ValueError('Legacy TF2C game directory must match')
    if env.get('WINDOWS_INSTALL', '0') != '0': raise ValueError('These reviewed profiles require native Linux packages')
    if kind == 'tf2classic' and env.get('SRCDS_BETAID', 'previous2021') != 'previous2021':
        raise ValueError('Legacy TF2C requires its original previous2021 SDK branch')
    return kind, app, game, executable


def publisher_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in HOSTS or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Legacy TF2C assets must use their official HTTPS publisher')
    if not re.fullmatch(r'/kachemak/(?:versions\.json|tf2classic-[0-9]+(?:\.[0-9]+){1,3}\.tar\.zst)', parsed.path):
        raise ValueError('Unreviewed legacy TF2C publisher path')
    return url


class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        publisher_url(url)
        return super().redirect_request(request, fp, code, message, headers, url)


def asset_version(env):
    version = env.get('GAMEVERSION', 'latest')
    if version != 'latest' and not re.fullmatch(r'[0-9]+(?:\.[0-9]+){1,3}', version): raise ValueError('Choose latest or a numeric legacy TF2C version')
    if version == 'latest':
        with urllib.request.build_opener(Redirect()).open(publisher_url('https://wiki.tf2classic.com/kachemak/versions.json'), timeout=30) as response:
            data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024: raise ValueError('Legacy TF2C version index exceeds limit')
        versions = json.loads(data).get('versions', {})
        if not isinstance(versions, dict) or not versions or len(versions) > 1000 or any(not re.fullmatch(r'[0-9]{1,12}', k) for k in versions):
            raise ValueError('Invalid legacy TF2C version index')
        filename = versions[max(versions, key=int)]['file']
    else: filename = 'tf2classic-' + version + '.tar.zst'
    return publisher_url('https://wiki.tf2classic.com/kachemak/' + filename)


def unpack(archive, destination):
    # Python 3.14 zstd is not assumed. Debian's signed zstd package supplies the
    # decompressor; stream tar members with strict bounds instead of tar -xf.
    import subprocess
    process = subprocess.Popen(['/usr/bin/zstd', '-dc', '--', str(archive)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    seen = set(); total = 0
    try:
        with tarfile.open(fileobj=process.stdout, mode='r|') as incoming:
            for member in incoming:
                path = PurePosixPath(member.name)
                if not path.parts or path.parts[0] != 'tf2classic' or path.is_absolute() or '..' in path.parts or '\\' in member.name or member.name in seen or not (member.isfile() or member.isdir()):
                    raise ValueError('Unsafe legacy TF2C archive entry')
                seen.add(member.name); total += member.size
                if len(seen) > 60000 or total > 16 * 1024**3: raise ValueError('Legacy TF2C archive exceeds expansion limit')
                target = destination.joinpath(*path.parts)
                if member.isdir(): target.mkdir(parents=True, exist_ok=True); continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with incoming.extractfile(member) as source, target.open('xb') as output: shutil.copyfileobj(source, output)
                target.chmod(member.mode & 0o755)
        if process.wait(timeout=30) != 0: raise ValueError('Legacy TF2C archive decompression failed')
    finally:
        if process.stdout: process.stdout.close()
        if process.poll() is None: process.terminate(); process.wait(timeout=10)
    if not (destination / 'tf2classic/bin/server.so').is_file(): raise ValueError('Legacy TF2C native server payload missing')


def install(root, env, validate=True):
    root = Path(root).resolve(); kind, app, game, executable = selection(env)
    # Scoped module process only; do not change shared helper source/defaults.
    source_install.GAME_DIRECTORIES = {**source_install.GAME_DIRECTORIES, app: game}
    if kind != 'tf2classic': return source_install.update(root, app, env=env, validate=validate, required=(executable,))
    # Credential preflight must precede any archive/network side effect.
    from steam_template import arguments
    arguments(root, app, env, validate)
    url = asset_version(env)
    state = root / '.voltra/source-third'
    source_install.confined(root, state); state.mkdir(parents=True, exist_ok=True)
    receipt = state / 'tf2classic.json'; source_install.confined(root, receipt)
    previous = json.loads(receipt.read_text()) if receipt.exists() else {}
    with tempfile.TemporaryDirectory(prefix='tf2c-', dir=state) as temporary:
        stage = Path(temporary); archive = stage / 'legacy.tar.zst'; total = 0; digest = hashlib.sha256()
        with urllib.request.build_opener(Redirect()).open(url, timeout=120) as incoming, archive.open('xb') as output:
            while True:
                block = incoming.read(1048576)
                if not block: break
                total += len(block)
                if total > 8 * 1024**3: raise ValueError('Legacy TF2C download exceeds limit')
                digest.update(block); output.write(block)
        expected = env.get('TF2C_SHA256', '')
        if expected and (not re.fullmatch(r'[a-f0-9]{64}', expected) or digest.hexdigest() != expected): raise ValueError('Legacy TF2C expected checksum mismatch')
        ready = stage / 'ready'; ready.mkdir(); unpack(archive, ready)
        source_install.update(root, app, env=env, validate=validate, required=(executable,))
        files, preserved = apply_payload(root, game, ready / game, previous)
        for folder, pairs in [(root / 'bin', [(name + '.so', name + '_srv.so') for name in ('vphysics', 'studiorender', 'soundemittersystem', 'shaderapiempty', 'scenefilecache', 'replay', 'materialsystem')]), (root / game / 'bin', [('server_srv.so', 'server.so')])]:
            for name, target in pairs:
                path = folder / name; native = folder / target
                source_install.confined(root, path); source_install.confined(root, native)
                if not path.exists() and not path.is_symlink() and native.is_file(): path.symlink_to(target)
        from source_runtime import private_write
        private_write(receipt, json.dumps({'url': url, 'computed_sha256': digest.hexdigest(), 'expected_checksum_checked': bool(expected), 'bytes': total, 'files': files, 'preserved_operator_files': preserved, 'identity_provenance': 'Computed official publisher download digest; not an independent publisher checksum'}, indent=2))


if __name__ == '__main__': install(Path.cwd(), dict(os.environ))
