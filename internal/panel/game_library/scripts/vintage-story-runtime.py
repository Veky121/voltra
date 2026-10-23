#!/usr/bin/env python3
"""MIT. Pass native server arguments literally, without evaluating a shell."""
import os
from pathlib import Path
import shlex


def arguments(env, root):
    port, maximum = int(env['SERVER_PORT']), int(env.get('MAX_CLIENTS', '16'))
    if not 1 <= port <= 65535 or not 1 <= maximum <= 256:
        raise ValueError('Invalid game port or player limit')
    options = env.get('OPTIONS', '')
    if any(c in options for c in '\x00\r\n'):
        raise ValueError('Startup options must be a single line')
    # Retains all native flags and quoting, including an explicit custom dataPath.
    # Shell operators are ordinary arguments, never commands.
    return ['dotnet', str(root / '.voltra/vintage-story/current/VintagestoryServer.dll'),
            '--dataPath', str(root / 'data'), '--port=' + str(port),
            '--maxclients=' + str(maximum), *shlex.split(options)]


if __name__ == '__main__':
    root = Path.cwd()
    (root / 'data/Backups').mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('SQLITE_TMPDIR', str(root / 'data/Backups'))
    argv = arguments(os.environ, root)
    os.execvp(argv[0], argv)
