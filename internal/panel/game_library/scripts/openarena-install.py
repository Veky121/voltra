#!/usr/bin/env python3
"""MIT. Publisher-package OpenArena installation using shared native ZIP staging."""
import os
from pathlib import Path
from native_zip_release import install_release

RELEASE = {'version': '0.8.8', 'prefix': 'openarena-0.8.8',
           'url': 'https://downloads.sourceforge.net/project/oarena/openarena-0.8.8.zip',
           'sha256': '5a8faf7f5b51f351b0a1618c06b6b98a5f1a6758f1d39818de2c87df2a0bac4a',
           'bytes': 425189255,
           'paths': ['oa_ded.x86_64', 'baseoa/', 'missionpack/', 'COPYING', 'COPYING.txt',
                     'README', 'README.md', 'readme.txt', 'license.txt', 'CREDITS']}


def install(root):
    if os.uname().machine not in ('x86_64', 'amd64'):
        raise ValueError('This OpenArena publisher binary requires Linux x64')
    install_release(root, RELEASE, 'openarena', 'oa_ded.x86_64')


if __name__ == '__main__':
    install(Path.cwd())
