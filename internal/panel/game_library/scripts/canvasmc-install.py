#!/usr/bin/env python3
"""Canvas-only acquisition boundary. Shared Java helpers remain read-only."""
import hashlib
import json
import os
from pathlib import Path
import re
import hybrid_java_install as shared


def install(root, env):
    root = Path(root).resolve()
    port = env.get('SERVER_PORT', '25565')
    if not re.fullmatch(r'[0-9]{1,5}', port) or not 1 <= int(port) <= 65535:
        raise ValueError('SERVER_PORT must be a valid allocated port')
    release = shared.canvas(env)
    expected = env.get('DOWNLOAD_SHA256', '').strip().lower() or release.get('sha256', '')
    if not re.fullmatch('[0-9a-f]{64}', expected):
        raise ValueError('Unreviewed Canvas builds require DOWNLOAD_SHA256; latest defaults use the reviewed pin')
    if release.get('sha256') and expected != release['sha256']:
        raise ValueError('DOWNLOAD_SHA256 conflicts with the reviewed Canvas pin')
    # Reject every symlink component, including paths resolving within this volume.
    def target(name):
        path = root / name
        current = root
        for part in Path(name).parts:
            current = current / part
            if current.is_symlink():
                raise ValueError('Canvas managed paths must not be symlinks')
        if not path.resolve().is_relative_to(root):
            raise ValueError('Canvas path escapes server volume')
        return path
    jar = target('server.jar')
    properties = target('server.properties')
    cache = target('.voltra/canvasmc/cache/' + expected + '.jar')
    receipt = target('.voltra/canvasmc/release.json')
    for path in (jar, properties, cache, receipt):
        if path.exists() and not path.is_file():
            raise ValueError('Canvas managed file is a directory')
    data = cache.read_bytes() if cache.is_file() else shared.fetch(release['url'])
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('Canvas artifact SHA256 mismatch; existing program preserved')
    main, major = shared.inspect_jar(data)
    shared.write(cache, data)
    shared.write(jar, data)
    if not properties.exists():
        shared.write(properties, ('server-ip=0.0.0.0\nserver-port=' + str(int(port)) + '\nonline-mode=true\nmax-players=20\nmotd=A Minecraft server\n').encode())
    # No EULA creation or acceptance, no config rewrite, no plugin/world pruning.
    result = dict(release, sha256=expected, bootstrap_main_class=main,
                  bootstrap_class_major=major, java_required=25,
                  version_identity=release.get('version_identity', 'reviewed pin or publisher metadata'))
    shared.write(receipt, (json.dumps(result, indent=2) + '\n').encode())
    print('Canvas artifact installed and verified; native readiness has not been tested')


if __name__ == '__main__':
    install(Path.cwd(), os.environ)
