#!/usr/bin/env python3
"""MIT. Source-only legacy server integration; operator rights/assets are prerequisites."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from steam_template import _publish


def helper(name):
    path = Path(__file__).with_name(name + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name.replace('-', '_')] = module
    spec.loader.exec_module(module)
    return module


release = helper('native-release')
console = helper('native-console')
PINS = json.loads(Path(__file__).with_name('legacy-coop-pins.json').read_text())


def confined(root, name):
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root): raise ValueError('Legacy server path leaves its volume')
    return path


def text(value, limit=4096):
    if not isinstance(value, str) or len(value) > limit or any(c in value for c in '\r\n\x00'): raise ValueError('Invalid legacy text control')
    return value


def primary(env):
    value = env.get('SERVER_PORT', '5119')
    if not re.fullmatch('[0-9]+', value) or not 1 <= int(value) <= 65535: raise ValueError('Invalid allocated primary port')
    if value not in env.get('VOLTRA_ALLOCATED_PORTS', value).split(','): raise ValueError('Primary port is not allocated')
    return value


def object_json(data):
    def pairs(values):
        obj = {}
        for key, value in values:
            if key in obj: raise ValueError('Duplicate native JSON key')
            obj[key] = value
        return obj
    def constant(_): raise ValueError('Non-finite native JSON')
    value = json.loads(data, object_pairs_hook=pairs, parse_constant=constant)
    if not isinstance(value, dict): raise ValueError('Native JSON must be an object')
    return value


def read_json(path):
    if path.stat().st_size > 8 * 1024**2: raise ValueError('Native configuration exceeds bounds')
    return object_json(path.read_bytes().decode('utf-8-sig'))


def write_json(root, name, data):
    body = (json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode()
    _publish(root, name, lambda output: output.write(body), 0o600)


def acknowledged(env):
    if env.get('ACKNOWLEDGE_LEGACY_PREREQUISITES', 'false') != 'true':
        raise ValueError('Review upstream legacy status, component licenses and lawful operator-owned asset prerequisites before setup')


def configure(root, game, env):
    port = primary(env)
    if game == 'league':
        content = confined(root, 'Content')
        settings = confined(root, 'Settings/GameInfo.json')
        if not content.is_dir() or not any(content.iterdir()) or not settings.is_file(): raise ValueError('Lawfully supplied Content and native Settings/GameInfo.json are required; no client/content mirror or sample accounts are installed')
        data = read_json(settings)
        if not isinstance(data.get('gameInfo'), dict) or not isinstance(data.get('players'), list): raise ValueError('Operator GameInfo requires native gameInfo and players; no accounts or session keys are invented')
        data['gameInfo']['CONTENT_PATH'] = str(content)
        write_json(root, 'Settings/GameInfo.json', data)
        server = confined(root, 'Settings/GameServerSettings.json')
        config = read_json(server) if server.exists() else {}
        config['autoStartClient'] = False
        write_json(root, 'Settings/GameServerSettings.json', config)
    elif game == 'sit':
        path = confined(root, 'Aki_Data/Server/configs/http.json')
        if not path.is_file(): raise ValueError('Matching lawful native Aki_Data HTTP configuration is required; no authentication server or accounts are fabricated')
        data = read_json(path)
        data.update(ip='0.0.0.0', port=int(port))
        write_json(root, 'Aki_Data/Server/configs/http.json', data)
    else: raise ValueError('Unknown reviewed legacy recipe')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Authenticated GitHub metadata redirects are not followed')


def github(repo, suffix, env):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo): raise ValueError('Invalid GitHub repository identity')
    if any(part in ('.', '..') for part in repo.split('/')): raise ValueError('Invalid GitHub repository identity')
    headers = {'User-Agent': 'Voltra-legacy-source', 'Accept': 'application/vnd.github+json'}
    token = text(env.get('GITHUB_OAUTH_TOKEN', ''), 4096)
    username = text(env.get('GITHUB_USER', ''), 256)
    if token:
        headers['Authorization'] = 'Basic ' + base64.b64encode((username + ':' + token).encode()).decode() if username else 'Bearer ' + token
    request = urllib.request.Request('https://api.github.com/repos/' + repo + '/' + suffix, headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
            data = response.read(4 * 1024**2 + 1)
        if len(data) > 4 * 1024**2: raise ValueError('GitHub metadata exceeds bounds')
        return json.loads(data)
    except (urllib.error.URLError, urllib.error.HTTPError):
        raise ValueError('Exact public GitHub release metadata unavailable; no fallback payload selected') from None


def sit_identity(env):
    repo = env.get('SIT_PACKAGE', 'stayintarkov/SIT.Aki-Server-Mod')
    version = text(env.get('SIT_VERSION', 'latest'), 160)
    if not re.fullmatch(r'[A-Za-z0-9_.+/-]+', version): raise ValueError('Invalid SIT version/tag/hash')
    if version == 'latest': metadata = github(repo, 'releases/latest', env)
    elif re.fullmatch('[a-fA-F0-9]{40}', version):
        candidates = github(repo, 'releases?per_page=100', env)
        if not isinstance(candidates, list): raise ValueError('GitHub release list is invalid')
        metadata = None
        for candidate in candidates[:20]:
            tag = candidate.get('tag_name', '')
            commit = github(repo, 'commits/' + urllib.parse.quote(tag, safe=''), env)
            if commit.get('sha', '').lower() == version.lower(): metadata = candidate; break
        if metadata is None: raise ValueError('No published Linux release for exact commit; source-only commits are not replaced with latest')
    else: metadata = github(repo, 'releases/tags/' + urllib.parse.quote(version, safe=''), env)
    if not isinstance(metadata, dict) or not metadata.get('tag_name'): raise ValueError('SIT release identity missing')
    assets = [asset for asset in metadata.get('assets', []) if re.fullmatch(r'[^/\\]*linux[^/\\]*\.tar\.gz', asset.get('name', ''), re.I)]
    if len(assets) != 1: raise ValueError('SIT requires exactly one unambiguous original Linux tar release')
    asset = assets[0]
    url = asset.get('browser_download_url', '')
    parsed = urllib.parse.urlsplit(url)
    prefix = '/' + repo + '/releases/download/'
    if parsed.scheme != 'https' or parsed.netloc != 'github.com' or not parsed.path.startswith(prefix) or parsed.query or parsed.fragment: raise ValueError('SIT asset must be an exact public maintainer GitHub release')
    if urllib.parse.unquote(parsed.path.rsplit('/', 1)[-1]) != asset['name']: raise ValueError('SIT release filename and public URL differ')
    digest = env.get('SIT_ARCHIVE_SHA256', '')
    publisher_digest = asset.get('digest') or ''
    if publisher_digest.startswith('sha256:'):
        if digest and digest != publisher_digest[7:]: raise ValueError('Explicit SIT checksum differs from maintainer release digest')
        digest = publisher_digest[7:]
    if not re.fullmatch('[a-f0-9]{64}', digest): raise ValueError('SIT exact release archive SHA256 is required; maintainer legacy asset has no digest and has not been acquired to pin it')
    return {'game': 'sit', 'repo': repo, 'version': metadata['tag_name'], 'asset': asset['name'], 'bytes': asset.get('size'), 'url': url, 'sha256': digest, 'publisher_digest': publisher_digest.startswith('sha256:'), 'prefix': None}


def publish_tree(root, stage, identity, binary):
    """Reuse shared secure publication, preserving unknown/modified operator files."""
    receipt_name = '.voltra/legacy-' + identity['game'] + '/release.json'
    receipt = confined(root, receipt_name)
    old = read_json(receipt) if receipt.exists() else {}
    files = {}
    for item in stage.rglob('*'):
        if item.is_symlink() or not item.resolve().is_relative_to(stage): raise ValueError('Publication links are unsupported')
        if item.is_file():
            name = item.relative_to(stage).as_posix()
            if name.startswith(('user/profiles/', 'user/cache/')): continue
            files[name] = release.sha256(item)
    if binary not in files: raise ValueError('Original native server executable is missing')
    changes = []
    state = confined(root, '.voltra/legacy-publication')
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='rollback-', dir=state) as temporary:
        backup = Path(temporary)
        try:
            for name, digest in files.items():
                source, destination = stage / name, confined(root, name)
                if destination.exists():
                    if not destination.is_file(): raise ValueError('Publication collides with operator directory')
                    current = release.sha256(destination)
                    if current == digest: continue
                    preserve = name.startswith(('Settings/', 'Content/', 'user/profiles/', 'user/cache/', 'user/configs/', 'Aki_Data/Server/configs/'))
                    preserve |= name.startswith('user/mods/') and ('/config/' in name or name.endswith('/config.json'))
                    preserve |= name != binary and current != old.get('files', {}).get(name)
                    if preserve: continue
                    saved = backup / name
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(destination, saved)
                    changes.append((name, saved, destination.stat()))
                else: changes.append((name, None, None))
                with source.open('rb') as stream: _publish(root, name, lambda output: shutil.copyfileobj(stream, output), source.stat().st_mode & 0o777)
            write_json(root, receipt_name, {**identity, 'files': files, 'binary_sha256': release.sha256(root / binary)})
        except BaseException:
            for name, saved, metadata in reversed(changes):
                destination = confined(root, name)
                if saved is not None:
                    with saved.open('rb') as source: _publish(root, name, lambda output: shutil.copyfileobj(source, output), metadata.st_mode & 0o777)
                elif destination.exists() and destination.is_file() and release.sha256(destination) == files[name]: destination.unlink()
            raise


def clean_environment(env):
    child = dict(env)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'GITHUB_USER', 'GITHUB_OAUTH_TOKEN'): child.pop(key, None)
    return child


def build_league(root, stage, env):
    source = stage / 'source'
    source.mkdir()
    child = clean_environment(dict(os.environ, **env))
    child.update(GIT_TERMINAL_PROMPT='0', GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1', GIT_ALLOW_PROTOCOL='https', DOTNET_CLI_TELEMETRY_OPTOUT='1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1')
    def command(argv, directory=source): subprocess.run(argv, cwd=directory, env=child, check=True, timeout=600)
    command(['git', 'init', '-q'])
    command(['git', 'remote', 'add', 'origin', 'https://github.com/LeagueSandbox/GameServer.git'])
    command(['git', 'fetch', '--depth=1', 'origin', PINS['league']['commit']])
    paths = ['GameServerConsole', 'GameServerCore', 'GameServerLib', 'GameMaths', 'QuadTree', 'GameServer.sln', 'lib', 'LICENSE', 'README.md']
    command(['git', 'checkout', PINS['league']['commit'], '--', *paths])
    packets = source / 'LeaguePackets'
    packets.mkdir()
    command(['git', 'init', '-q'], packets)
    command(['git', 'remote', 'add', 'origin', 'https://github.com/LeagueSandbox/LeaguePackets.git'], packets)
    command(['git', 'fetch', '--depth=1', 'origin', PINS['league']['packets_commit']], packets)
    command(['git', 'checkout', '--detach', PINS['league']['packets_commit']], packets)
    # Preserve original Debug/net6.0 output and source submodule pins, never fetch Content/client mirrors.
    command(['dotnet', 'build', '.', '--configuration', 'Debug'])
    output = source / 'GameServerConsole/bin/Debug/net6.0'
    if not (output / 'GameServerConsole').is_file(): raise ValueError('Original net6.0 source build did not produce GameServerConsole')
    ready = stage / 'ready'
    shutil.copytree(output, ready)
    # Native default example accounts/config are never installed; require the operator's own files.
    if (ready / 'Settings').exists(): shutil.rmtree(ready / 'Settings')
    notices = ready / '.voltra/league-licenses'
    notices.mkdir(parents=True)
    shutil.copy2(source / 'LICENSE', notices / 'GameServer-AGPL-3.0.txt')
    if not (packets / 'LICENSE').is_file(): raise ValueError('Pinned LeaguePackets component license is missing')
    shutil.copy2(packets / 'LICENSE', notices / 'LeaguePackets-Apache-2.0.txt')
    return ready


def install(root, game, env):
    root = Path(root).resolve()
    acknowledged(env)
    state = confined(root, '.voltra/legacy-installer')
    state.mkdir(parents=True, exist_ok=True)
    if game == 'league': configure(root, game, env)
    elif game != 'sit': raise ValueError('Unknown reviewed legacy game')
    with tempfile.TemporaryDirectory(prefix=game + '-', dir=state) as temporary:
        stage = Path(temporary)
        if game == 'league':
            ready = build_league(root, stage, env)
            identity = {'game': 'league', **PINS['league']}
            binary = 'GameServerConsole'
        else:
            name = text(env.get('SIT_NAME', 'SITCoop.tar.gz'), 128)
            if not re.fullmatch('[A-Za-z0-9_.-]{1,128}', name) or name in ('.', '..'): raise ValueError('SIT temporary asset filename must be a basename')
            identity = sit_identity(env)
            archive = stage / name
            local = env.get('SIT_ARCHIVE_PATH', '')
            if local:
                source = confined(root, local)
                if not source.is_file() or release.sha256(source) != identity['sha256'] or (identity.get('bytes') and source.stat().st_size != identity['bytes']): raise ValueError('Operator SIT archive checksum or release-size mismatch')
                shutil.copyfile(source, archive)
            else: release.download(identity, archive)
            ready = stage / 'ready'
            ready.mkdir()
            release.extract(archive, ready, None)
            binary = 'Aki.Server.exe'
            if not (ready / binary).is_file(): raise ValueError('Original Linux Aki.Server.exe payload required')
            with (ready / binary).open('rb') as stream:
                if stream.read(4) != b'\x7fELF': raise ValueError('Original Linux Aki.Server.exe ELF payload required; no Windows/client substitution')
            (ready / binary).chmod(0o755)
        publish_tree(root, ready, identity, binary)


def launch(root, game, env):
    root = Path(root).resolve()
    acknowledged(env)
    configure(root, game, env)
    binary = 'GameServerConsole' if game == 'league' else 'Aki.Server.exe'
    path = confined(root, binary)
    if not path.is_file(): raise ValueError('Original native server executable is not installed')
    argv = [str(path)] + (['--port', primary(env)] if game == 'league' else [])
    child = clean_environment(env)
    child['HOME'] = str(root)
    credentials = [env.get('GITHUB_OAUTH_TOKEN', '')]
    if game == 'league':
        data = read_json(root / 'Settings/GameInfo.json')
        credentials += [p.get('blowfishKey', '') for p in data.get('players', []) if isinstance(p, dict) and isinstance(p.get('blowfishKey', ''), str)]
    return console.run(root, argv, child, '^C', credentials=tuple(credentials), stop_signal=signal.SIGINT)


if __name__ == '__main__':
    action, game = sys.argv[1:3]
    if action == 'install': install(Path.cwd(), game, dict(os.environ))
    elif action == 'run': sys.exit(launch(Path.cwd(), game, dict(os.environ)))
    else: raise ValueError('Unknown reviewed legacy action')
