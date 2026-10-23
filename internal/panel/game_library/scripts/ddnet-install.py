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


def select_release(version):
    if version == '20.1.1':
        return {'version': version, 'prefix': 'DDNet-20.1.1-linux_x86_64',
                'url': 'https://ddnet.org/downloads/DDNet-20.1.1-linux_x86_64.tar.xz',
                'sha256': '13e75af21845ebb2bb02d76e4b9c5a1680ab4fb044057c1586ceb83835c811f3', 'bytes': 45927396}
    if version == 'latest':
        names = re.findall(r'href="(?:https://ddnet.org/downloads/)?(DDNet-(\d+\.\d+(?:\.\d+)?)-linux_x86_64\.tar\.xz)"', text('https://ddnet.org/downloads/'))
        if not names:
            raise ValueError('Publisher latest release was not found')
        version = names[0][1]
    if not re.fullmatch(r'\d+\.\d+(?:\.\d+)?', version):
        raise ValueError('Select a published stable version or latest')
    name = 'DDNet-' + version + '-linux_x86_64.tar.xz'
    sums = text('https://ddnet.org/downloads/sha256sums.txt')
    matches = re.findall(r'^([a-f0-9]{64})\s+\*?' + re.escape(name) + r'\s*$', sums, re.MULTILINE)
    if len(matches) != 1:
        raise ValueError('Published DDNet checksum is missing or ambiguous')
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
