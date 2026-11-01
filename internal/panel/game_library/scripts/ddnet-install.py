#!/usr/bin/env python3
"""MIT. Select publisher-checked DDNet releases for the shared native installer."""
import json
import os
from pathlib import Path
import re
import urllib.request
from native_release import install_release


def text(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read(4 * 1024 * 1024).decode('utf-8')


STABLE_VERSION = r'[0-9]{1,6}\.[0-9]{1,6}(?:\.[0-9]{1,6})?'
CHECKSUMS_URL = 'https://ddnet.org/downloads/sha256sums.txt'


def published_checksums(body):
    """Accept only exact publisher Linux x86-64 archive identities, not URLs."""
    rows = {}
    pattern = re.compile(r'([a-f0-9]{64})[ \t]+\*?(DDNet-(' + STABLE_VERSION + r')-linux_x86_64\.tar\.xz)[ \t]*')
    for line in body.splitlines():
        match = pattern.fullmatch(line)
        if match:
            rows.setdefault(match[2], []).append(match[1])
    return rows


def version_order(version):
    numbers = tuple(int(part) for part in version.split('.'))
    # Prefer the publisher's shorter identity on equal numeric versions, while
    # explicit versions still address their exact archive filename unchanged.
    return numbers + (0,) * (3 - len(numbers)), -len(numbers), version


def latest_checked_version(page, rows):
    names = re.findall(r'''href=(["'])(?:https://ddnet.org/downloads/)?(DDNet-(''' + STABLE_VERSION + r''')-linux_x86_64\.tar\.xz)\1''', page)
    if not names:
        raise ValueError('Publisher latest stable Linux x86-64 release was not found')
    versions = {match[2] for match in names}
    versions.update(name[len('DDNet-'):-len('-linux_x86_64.tar.xz')] for name in rows)
    checked = [version for version in versions if len(rows.get('DDNet-' + version + '-linux_x86_64.tar.xz', [])) == 1]
    if not checked:
        raise ValueError('No stable DDNet Linux x86-64 release has a unique published SHA-256 checksum')
    selected = max(checked, key=version_order)
    skipped = sorted((v for v in versions if version_order(v) > version_order(selected)), key=version_order, reverse=True)
    if skipped:
        print('DDNet latest skipped ' + ', '.join(skipped) + ' because their official SHA-256 is missing or ambiguous; selected publisher-checksummed stable ' + selected + '.', flush=True)
    return selected


def select_release(version):
    if version == '20.1.1':
        return {'version': version, 'prefix': 'DDNet-20.1.1-linux_x86_64',
                'url': 'https://ddnet.org/downloads/DDNet-20.1.1-linux_x86_64.tar.xz',
                'sha256': '13e75af21845ebb2bb02d76e4b9c5a1680ab4fb044057c1586ceb83835c811f3', 'bytes': 45927396}
    if version == 'latest':
        page = text('https://ddnet.org/downloads/')
        rows = published_checksums(text(CHECKSUMS_URL))
        version = latest_checked_version(page, rows)
    else:
        if not re.fullmatch(STABLE_VERSION, version):
            raise ValueError('Select a published stable version or latest')
        rows = published_checksums(text(CHECKSUMS_URL))
    if not re.fullmatch(STABLE_VERSION, version):
        raise ValueError('Select a published stable version or latest')
    name = 'DDNet-' + version + '-linux_x86_64.tar.xz'
    matches = rows.get(name, [])
    if len(matches) != 1:
        raise ValueError('Published DDNet checksum is missing or ambiguous for ' + name + '; choose a uniquely publisher-checksummed stable version or latest')
    return {'version': version, 'prefix': name.removesuffix('.tar.xz'),
            'url': 'https://ddnet.org/downloads/' + name, 'sha256': matches[0]}


def install(root):
    if os.uname().machine not in ('x86_64', 'amd64'):
        raise ValueError('The selected publisher archive requires Linux x64')
    release = select_release(os.environ.get('RELEASE_VERSION', '20.1.1'))
    install_release(root, release, 'ddnet', 'DDNet-Server',
                    {'storage.cfg': 'add_path $CURRENTDIR\nadd_path $DATADIR\nadd_path $APPDIR\n'})


if __name__ == '__main__':
    install(Path.cwd())
