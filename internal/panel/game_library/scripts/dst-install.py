#!/usr/bin/env python3
"""MIT. Typed Steam maintenance with preservation of native mod setup."""
import os
from pathlib import Path
import re
import tempfile
import time
import urllib.parse
import urllib.request
from steam_template import update
from native_config import private_write

BINARY = 'bin64/dontstarve_dedicated_server_nullrenderer_x64'


def update_game(root, validate=True):
    root = Path(root).resolve()
    target = root / 'mods/dedicated_server_mods_setup.lua'
    backups = root / '.voltra/dst/publisher-file-backups'
    if not target.resolve().is_relative_to(root) or not backups.resolve().is_relative_to(root):
        raise ValueError('Native mod setup leaves the server volume')
    previous = target.read_bytes() if target.is_file() else None
    if previous is not None:
        backups.mkdir(parents=True, exist_ok=True)
        backup = backups / (str(time.time_ns()) + '-dedicated_server_mods_setup.lua')
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as output:output.write(previous)
    try:
        return update(root, 343050, validate=validate, required=(BINARY,))
    finally:
        if previous is not None:
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix='.voltra-', dir=target.parent)
            try:
                with os.fdopen(fd, 'wb') as output:output.write(previous)
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):os.unlink(temporary)


def worldgen(root, env):
    root = Path(root).resolve()
    identity = env.get('CLUSTER_ID', 'server')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', identity):raise ValueError('Invalid persistent cluster ID')
    for shard, key, bundled in [('Master','MASTER_WORLDGEN','dst-worldgen-master.lua'),('Caves','CAVES_WORLDGEN','dst-worldgen-caves.lua')]:
        target = root / 'DoNotStarveTogether/config' / identity / shard / 'worldgenoverride.lua'
        if not target.resolve().is_relative_to(root):raise ValueError('World generation file leaves the volume')
        if target.exists():continue
        url = env.get(key, '')
        if not url:continue
        if url == 'https://raw.githubusercontent.com/ptero-eggs/game-eggs/main/dont_starve/worldgenoverride.' + shard.lower() + '.lua':
            content = (root / '.voltra' / bundled).read_text(encoding='utf-8')
        else:
            parsed = urllib.parse.urlsplit(url)
            if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError('Worldgen downloads require an HTTPS URL without embedded credentials')
            with urllib.request.urlopen(url, timeout=45) as response:
                if urllib.parse.urlsplit(response.url).scheme != 'https':raise ValueError('Worldgen redirect requires HTTPS')
                content = response.read(4 * 1024 * 1024 + 1)
            if len(content) > 4 * 1024 * 1024:raise ValueError('Worldgen file exceeds 4 MiB')
            content = content.decode('utf-8')
        private_write(target, content)


if __name__ == '__main__':
    root = Path.cwd()
    update_game(root)
    worldgen(root, os.environ)
