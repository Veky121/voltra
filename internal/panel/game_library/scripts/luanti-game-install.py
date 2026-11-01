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
REVIEWED_GAME_COMMIT = 'c42e4d0c0ff9d27ff7b9b308c3cfc14098dd3a0f'
REVIEWED_GAME_TREE = '4dd8393b03fdbfb1ea9dbc3189329a5d12b33a3ba6354f687a656fd7ecfe3832'
REVIEWED_GAME_GIT_URL = 'https://codeload.github.com/luanti-org/minetest_game/zip/' + REVIEWED_GAME_COMMIT


class MetadataUnavailable(ValueError):
    def __init__(self, detail, status=None):
        super().__init__(detail)
        self.status = status


def identifier(value, field):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value):
        raise ValueError('Invalid ' + field)
    return value


def request(url):
    parsed = urllib.parse.urlsplit(url)
    if url != REVIEWED_GAME_GIT_URL and (parsed.scheme != 'https' or parsed.hostname not in ('content.luanti.org', 'cdn.content.luanti.org')):
        raise ValueError('ContentDB returned an unsupported download address')
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Voltra-Luanti-Setup/1'}), timeout=30)


def get_json(url):
    status = None
    for attempt in range(3):
        try:
            with request(url) as response:
                return json.load(response)
        except (OSError, ValueError) as error:
            status = getattr(error, 'code', None)
            if attempt == 2:
                detail = ' (HTTP ' + str(status) + ')' if isinstance(status, int) else ''
                raise MetadataUnavailable('ContentDB metadata could not be read' + detail + '; existing games were retained', status) from None
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
            # ZipInfo normalizes backslashes on Windows; inspect original bytes
            # before accepting the archive's canonical POSIX path.
            name = member.orig_filename
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


def game_tree_digest(directory):
    """Pin game content independently of ZIP compression/root-folder metadata."""
    entries, total = [], 0
    for path in Path(directory).rglob('*'):
        if path.is_symlink():
            raise ValueError('Unexpected link in reviewed game tree')
        if not path.is_file():
            continue
        total += path.stat().st_size
        if total > 64 * 1024 * 1024:
            raise ValueError('Reviewed game tree exceeds its bounded size')
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        entries.append((path.relative_to(directory).as_posix().encode('utf-8'), digest.digest()))
    digest = hashlib.sha256()
    for name, value in sorted(entries):
        digest.update(name + b'\0' + value)
    return digest.hexdigest()


def install(root, env, fetch=get_json, open_url=request):
    root = Path(root)
    game = identifier(env.get('DEFAULT_GAME', ''), 'DEFAULT_GAME')
    destination = root / '.minetest/games' / game
    for target in (root / '.minetest', destination.parent, destination):
        if target.is_symlink():
            raise ValueError('Managed game installation paths must not be symbolic links')
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
    reviewed_default = author.lower() in ('luanti', 'minetest') and name == 'minetest_game' and int(raw_release) == 38214
    cache = root / '.voltra/luanti-cache' / ('minetest-game-' + REVIEWED_GAME_COMMIT + '.zip')
    for path in (root / '.voltra', cache.parent, cache):
        if path.is_symlink():
            raise ValueError('Managed game cache must not be a symbolic link')
    git_source = False
    if reviewed_default and cache.is_file():
        # Only this immutable, previously reviewed release may avoid metadata.
        git_source = True
    else:
        try:
            release = select_release(author, name, int(raw_release), fetch)
        except MetadataUnavailable as error:
            if not reviewed_default or error.status is not None and error.status < 500:
                raise
            git_source = True
    if git_source:
        release = {'id': 38214, 'commit': REVIEWED_GAME_COMMIT, 'url': REVIEWED_GAME_GIT_URL}
        print('Using the reviewed official Minetest Game commit for release 38214; content-tree verification is required.', flush=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.luanti-game-', dir=destination.parent) as temporary:
        stage = Path(temporary)
        archive = stage / 'game.zip'
        digest = hashlib.sha256()
        count = 0
        try:
            source = cache.open('rb') if git_source and cache.is_file() else open_url(release['url'])
            with source as response, archive.open('wb') as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
                    digest.update(chunk)
                    count += len(chunk)
                    if reviewed_default and count > 16 * 1024 * 1024:
                        raise ValueError('Reviewed game archive exceeds its bounded size')
        except OSError:
            raise ValueError('Game download failed; existing games were retained') from None
        if release.get('size') and count != int(release['size']):
            raise ValueError('Incomplete game download')
        if reviewed_default and not git_source:
            if digest.hexdigest() != '5b364f6b0cf31ec336319492e14106d932eb86b65a91ded99f4b25f4876519dc':
                raise ValueError('The reviewed Minetest Game archive checksum does not match')
        extracted = stage / 'game'
        extract_game(archive, extracted)
        tree = game_tree_digest(extracted) if git_source else None
        if git_source and tree != REVIEWED_GAME_TREE:
            raise ValueError('Reviewed official Minetest Game content tree does not match')
        receipt = {'author': author, 'name': name, 'release': release['id'], 'commit': release.get('commit'),
                   'archive_sha256': digest.hexdigest(), 'archive_bytes': count, 'engine': '5.17.0',
                   'source': 'reviewed_official_git_commit' if git_source else 'contentdb',
                   'content_tree_sha256': tree}
        (extracted / '.voltra-contentdb.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
        os.rename(extracted, destination)
    print(('Reviewed official game source installed.' if git_source else 'ContentDB game installed.') + ' Reinstall preserves this game and all worlds.', flush=True)
    return True


if __name__ == '__main__':
    try:
        install('/mnt/server', os.environ)
    except (ValueError, OSError, zipfile.BadZipFile, KeyError, TypeError) as error:
        if isinstance(error, ValueError):
            print('Luanti game installation failed: ' + str(error), flush=True)
        else:
            print('Luanti game installation failed. Check package, release, game ID and available storage. Existing worlds and games were retained.', flush=True)
        raise SystemExit(1)
