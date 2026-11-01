#!/usr/bin/env python3
"""Vintage Story launch arguments retained; shared truthful console supervision."""
import json
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
    return ['dotnet', str(root / '.voltra/vintage-story/current/VintagestoryServer.dll'),
            '--dataPath', str(root / 'data'), '--port=' + str(port),
            '--maxclients=' + str(maximum), *shlex.split(options)]


def selected_data(root, argv):
    value = str(root / 'data')
    for index, arg in enumerate(argv):
        if arg.lower().startswith('--datapath='):
            value = arg.split('=', 1)[1]
        elif arg.lower() == '--datapath' and index + 1 < len(argv):
            value = argv[index + 1]
    path = Path(value)
    return path if path.is_absolute() else root / path


def configured_password(root, argv):
    config = selected_data(root, argv) / 'serverconfig.json'
    if config.is_file() and config.stat().st_size <= 16 * 1024**2:
        try:
            document = json.loads(config.read_text(encoding='utf-8-sig'))
            value = document.get('Password') if isinstance(document, dict) else None
            return [value] if isinstance(value, str) and value else []
        except (ValueError, UnicodeError):
            # Preserve the publisher's existing handling of nonstandard JSON.
            # This is a best-effort redaction input, never a config rewriter.
            pass
    return []


def main(root, env, supervisor=None):
    root = Path(root)
    # Parse bounds and quoted options before creating the old default directory.
    argv = arguments(env, root)
    allocated = {int(value) for value in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}
    if int(env['SERVER_PORT']) not in allocated:
        raise ValueError('Vintage Story needs an allocated primary port')
    credentials = configured_password(root, argv)
    backups = root / 'data/Backups'
    if backups.exists() and not backups.is_dir():
        raise ValueError('Vintage Story backup path must be a directory')
    child = dict(env)
    child.setdefault('SQLITE_TMPDIR', str(backups))
    backups.mkdir(parents=True, exist_ok=True)
    if supervisor is None:
        from native_console import run
        supervisor = run
    result = supervisor(root, argv, child, '/stop', credentials=credentials)
    # Keep direct-exec's conventional signal exit status; the shared supervisor
    # separately reports the actual raw negative child status and signal.
    return result if result >= 0 else 128 - result


if __name__ == '__main__':
    raise SystemExit(main(Path.cwd(), dict(os.environ)))
