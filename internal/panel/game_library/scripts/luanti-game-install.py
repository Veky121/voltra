# SPDX-License-Identifier: MIT
"""Install a ContentDB game once, with staged extraction and a release receipt."""
import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

ENGINE = (5, 17, 0)


def identifier(value, field):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value):
        raise ValueError('Invalid ' + field)
    return value


def request(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in ('content.luanti.org', 'cdn.content.luanti.org'):
        raise ValueError('ContentDB returned an unsupported download address')
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Voltra-Luanti-Setup/1'}), timeout=30)


def get_json(url):
    for attempt in range(3):
        try:
            with request(url) as response:
                return json.load(response)
        except (OSError, ValueError):
            if attempt == 2:
                raise ValueError('ContentDB metadata could not be read; existing games were retained') from None
            time.sleep(attempt + 1)


def version(bound):
    if bound is None:
        return None
    match = re.fullmatch(r'(\d+)\.(\d+)(?:\.(\d+))?(?:-dev)?', str(bound.get('name', '')))
    if not match:
        raise ValueError('ContentDB returned an unsupported engine version bound')
    return tuple(int(p or 0) for p in match.groups())


def compatible(release):
    low, high = version(release.get('min_minetest_version')), version(release.get('max_minetest_version'))
    return (low is None or low <= ENGINE) and (high is None or ENGINE <= high)


def select_release(author, name, requested, fetch=get_json):
    base = 'https://content.luanti.org/api/packages/' + author + '/' + name + '/'
    package = fetch(base)
    if package.get('type', '').lower() != 'game':
        raise ValueError('The selected ContentDB package is not a game')
    if requested:
        release = fetch(base + 'releases/' + str(requested) + '/')
        if release.get('id') != requested:
            raise ValueError('ContentDB returned a different game release')
        if not compatible(release):
            raise ValueError('The selected game release does not support Luanti 5.17.0')
    else:
        releases = fetch(base + 'releases/')
        if not isinstance(releases, list):
            raise ValueError('ContentDB returned invalid release metadata')
        matches = [r for r in releases if compatible(r)]
        if not matches:
            raise ValueError('No compatible game release exists for Luanti 5.17.0')
        release = max(matches, key=lambda r: int(r['id']))
    if not isinstance(release.get('id'), int) or release['id'] <= 0:
        raise ValueError('ContentDB returned an invalid release identifier')
    return release


def extract_game(archive, destination):
    """Reject links, traversal and ambiguous roots before writing any game files."""
    destination = Path(destination)
    with zipfile.ZipFile(archive) as zipped:
        members = zipped.infolist()
        paths = []
        for member in members:
            name = member.filename
            path = PurePosixPath(name)
            if not name or '\\' in name or path.is_absolute() or '..' in path.parts or ':' in name or '\x00' in name:
                raise ValueError('Unsafe path in ContentDB game archive')
            mode = member.external_attr >> 16
            if mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError('Links and special files are not accepted in game archives')
            paths.append(path)
        roots = [p.parent for p in paths if p.name == 'game.conf']
        if len(roots) != 1:
            raise ValueError('Game archive must contain exactly one game.conf')
        root = roots[0]
        selected = [(m, p.relative_to(root)) for m, p in zip(members, paths) if p.is_relative_to(root)]
        total = sum(m.file_size for m, _ in selected)
        if total + 32 * 1024 * 1024 > shutil.disk_usage(destination.parent).free:
            raise ValueError('Insufficient free space to extract the game')
        written = set()
        for member, relative in selected:
            if relative == PurePosixPath('.'):
                continue
            key = str(relative)
            if key in written:
                raise ValueError('Duplicate path in game archive')
            written.add(key)
            target = destination.joinpath(*relative.parts)
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with zipped.open(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
    if not (destination / 'game.conf').is_file():
        raise ValueError('No game configuration was extracted')


def install(root, env, fetch=get_json, open_url=request):
    root = Path(root)
    game = identifier(env.get('DEFAULT_GAME', ''), 'DEFAULT_GAME')
    destination = root / '.minetest/games' / game
    if destination.exists():
        if not (destination / 'game.conf').is_file():
            raise ValueError('Existing game directory has no game.conf; repair or select another game ID')
        print('Existing game retained, including operator modifications.', flush=True)
        return False
    if env.get('COMMUNITY_DOWNLOAD') == '0':
        destination.parent.mkdir(parents=True, exist_ok=True)
        print('Manual game mode: upload the selected game, including game.conf, before starting.', flush=True)
        return False
    if env.get('COMMUNITY_DOWNLOAD') != '1':
        raise ValueError('COMMUNITY_DOWNLOAD must be 0 or 1')
    author = identifier(env.get('COMMUNITY_GAME_AUTOR', ''), 'COMMUNITY_GAME_AUTOR')
    name = identifier(env.get('COMMUNITY_GAME_NAME', ''), 'COMMUNITY_GAME_NAME')
    raw_release = env.get('COMMUNITY_GAME_RELEASE', '0')
    if not re.fullmatch(r'[0-9]{1,12}', raw_release):
        raise ValueError('Invalid COMMUNITY_GAME_RELEASE')
    release = select_release(author, name, int(raw_release), fetch)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.luanti-game-', dir=destination.parent) as temporary:
        stage = Path(temporary)
        archive = stage / 'game.zip'
        digest = hashlib.sha256()
        count = 0
        try:
            with open_url(release['url']) as response, archive.open('wb') as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
                    digest.update(chunk)
                    count += len(chunk)
        except OSError:
            raise ValueError('Game download failed; existing games were retained') from None
        if release.get('size') and count != int(release['size']):
            raise ValueError('Incomplete game download')
        if author.lower() in ('luanti', 'minetest') and name == 'minetest_game' and release['id'] == 38214:
            if digest.hexdigest() != '5b364f6b0cf31ec336319492e14106d932eb86b65a91ded99f4b25f4876519dc':
                raise ValueError('The reviewed Minetest Game archive checksum does not match')
        extracted = stage / 'game'
        extract_game(archive, extracted)
        receipt = {'author': author, 'name': name, 'release': release['id'], 'commit': release.get('commit'),
                   'archive_sha256': digest.hexdigest(), 'archive_bytes': count, 'engine': '5.17.0'}
        (extracted / '.voltra-contentdb.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
        os.rename(extracted, destination)
    print('ContentDB game installed. Reinstall preserves this game and all worlds.', flush=True)
    return True


if __name__ == '__main__':
    try:
        install('/mnt/server', os.environ)
    except (ValueError, OSError, zipfile.BadZipFile, KeyError, TypeError):
        print('Luanti game installation failed. Check package, release, game ID and available storage. Existing worlds and games were retained.', flush=True)
        raise SystemExit(1)
