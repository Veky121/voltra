#!/usr/bin/env python3
"""MIT. Typed Steam installs preserving operator-owned native configuration."""
from pathlib import Path
import os
import sys
import time
import tempfile
from steam_template import update


GAMES = {'barotrauma': (1026340, 'linux', ('DedicatedServer',), ('serversettings.xml', 'config_player.xml', 'Data/clientpermissions.xml', 'Data/bannedplayers.txt', 'Data/karmasettings.xml', 'Data/permissionpresets.xml')),
         'enshrouded': (2278520, 'windows', ('enshrouded_server.exe',), ('enshrouded_server.json',))}


def private_bytes(path, content, metadata=None):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd, temporary=tempfile.mkstemp(prefix='.voltra-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as output:
            output.write(content)
            if metadata is not None:
                os.fchown(output.fileno(),metadata.st_uid,metadata.st_gid)
                os.fchmod(output.fileno(),metadata.st_mode&0o777)
        os.replace(temporary,path)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def install(root, game, env=None, validate=True):
    root = Path(root).resolve()
    if game not in GAMES:raise ValueError('Unknown reviewed survival game')
    app, platform, required, protected = GAMES[game]
    if not (root/'.voltra'/game/'publisher-backups').resolve().is_relative_to(root):raise ValueError('Backup directory escapes the server volume')
    previous = {}
    for name in protected:
        target = root/name
        if not target.resolve().is_relative_to(root):raise ValueError('Native configuration escapes the server volume')
        if target.exists():
            if target.stat().st_size > 8*1024*1024:raise ValueError('Native configuration exceeds 8 MiB')
            previous[name] = (target.read_bytes(),target.stat())
            private_bytes(root/'.voltra'/game/'publisher-backups'/(str(time.time_ns())+'-'+name.replace('/','-')), previous[name][0])
    try:
        release=update(root, app, env=env, platform=platform, validate=validate, required=required)
        if game=='enshrouded':
            from enshrouded_proton import provision
            provision(root)
        return release
    finally:
        for name, (content,metadata) in previous.items():private_bytes(root/name, content,metadata)


if __name__ == '__main__':
    install(Path.cwd(), sys.argv[1], dict(os.environ))
