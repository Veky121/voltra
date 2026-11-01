#!/usr/bin/env python3
"""Standalone LOOHP Limbo only. Seed binding once using the reviewed installer."""
import importlib.util
import os
from pathlib import Path
import re


def install(root, env, base):
    root = Path(root).resolve()
    # Refuse links even when dangling or pointing within the volume. Never
    # replace a link or silently adopt an operator's linked configuration.
    for name in ('server.properties', '.voltra', '.voltra/limbo', env.get('SERVER_JARFILE', 'Limbo.jar')):
        target = root / name
        if target.is_symlink() or not target.resolve().is_relative_to(root):
            raise ValueError('Limbo installation requires confined regular paths')
    config = root / 'server.properties'
    existing = config.exists()
    port = env.get('SERVER_PORT', '')
    if not existing and (not re.fullmatch(r'[0-9]{1,5}', port) or not 1 <= int(port) <= 65535):
        raise ValueError('A valid allocated SERVER_PORT is required for first installation')
    base.install(root, 'limbo', env)
    if not existing:
        data = config.read_bytes()
        for key, value in ((b'server-ip', b'0.0.0.0'), (b'server-port', port.encode('ascii'))):
            pattern = rb'(?m)^' + key + rb'[ \t]*=[^\r\n]*'
            if not re.search(pattern, data):
                raise ValueError('Publisher defaults lack the required binding property')
            data = re.sub(pattern, key + b'=' + value, data)
        base.write(config, data)


if __name__ == '__main__':
    spec = importlib.util.spec_from_file_location('limbo_base', Path(__file__).with_name('limbo-install.py'))
    base = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(base)
    install(Path.cwd(), os.environ, base)
