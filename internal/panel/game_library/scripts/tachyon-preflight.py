#!/usr/bin/env python3
"""MIT. TachyonsCE allocation reconciliation before shared console supervision."""
import os
from pathlib import Path
import re
import stat
import sys
import time


def confined(root, relative, required=False):
    path = root / relative
    for current in [path, *path.parents]:
        if current == root:
            break
        if current.is_symlink():
            raise ValueError('Tachyon paths must not use symlinks')
    if not path.resolve().is_relative_to(root):
        raise ValueError('Tachyon path leaves the volume')
    if path.exists() and not path.is_file():
        raise ValueError('Tachyon file target must be regular')
    if required and not path.is_file():
        raise ValueError('Install the reviewed Tachyon payload first')
    return path


def integer(value, low, high):
    if not re.fullmatch(r'[0-9]+', str(value)) or not low <= int(value) <= high:
        raise ValueError('Tachyon number outside supported bounds')
    return int(value)


def plan(root, environment):
    root = Path(root)
    if root.is_symlink() or root.resolve() != root:
        raise ValueError('Tachyon volume must be absolute and canonical')
    port = integer(environment.get('SERVER_PORT', ''), 1, 65535)
    allocated = {integer(v, 1, 65535) for v in environment.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if v}
    if port not in allocated:
        raise ValueError('Choose an allocated Tachyon port')
    memory = integer(environment.get('SERVER_MEMORY', '1024'), 256, 65536)
    java = confined(root, '.voltra/java8/bin/java', True)
    if not os.access(java, os.X_OK):
        raise ValueError('Reviewed Tachyon Java runtime is not executable')
    confined(root, 'tachyon/TachyonsCEServer.jar', True)
    config = confined(root, 'tachyon/config.cfg', True)
    if config.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('Tachyon configuration exceeds supported size')
    previous = config.read_bytes().decode('utf-8')
    matches = []
    for match in re.finditer(r'(?m)^([^\r\n]*)(\r*\n|$)', previous):
        line = match[1]
        if line.lstrip().startswith(('--', '#', ';', '//')) or '=' not in line:
            continue
        key = line.split('=', 1)[0].strip()
        if key.upper() == 'SERVER_PORT':
            if key != 'SERVER_PORT':
                raise ValueError('Ambiguous Tachyon port key casing')
            # Publisher e.bj() trims the whole line, then splits at its LAST
            # equals sign without trimming the key/value individually.
            scalar = re.fullmatch(r'([ \t]*SERVER_PORT=)([0-9]+)([ \t]*)', line)
            if not scalar:
                raise ValueError('Invalid native Tachyon port scalar')
            integer(scalar[2], 1, 65535)
            matches.append((match.start() + scalar.start(2), match.start() + scalar.end(2)))
    if len(matches) != 1:
        raise ValueError('Expected one unambiguous native Tachyon port')
    begin, end = matches[0]
    updated = previous[:begin] + str(port) + previous[end:]
    backup = confined(root, '.voltra/small-games-family/backups/tachyon-' + str(time.time_ns()) + '.cfg')
    env = {k: v for k, v in environment.items() if k not in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH')}
    env.update(HOME=str(root), XDG_CONFIG_HOME=str(root / '.voltra/small-games-family/config'), XVFB='0')
    argv = [str(java), '-Xms128M', '-Xmx' + str(max(128, memory * 75 // 100)) + 'M', '-Djava.awt.headless=true', '-jar', 'TachyonsCEServer.jar']
    return config, previous, updated, backup, argv, env


def main(root=None, environment=None):
    root = Path.cwd() if root is None else Path(root)
    config, previous, updated, backup, argv, env = plan(root, dict(os.environ if environment is None else environment))
    from native_config import private_write
    from native_console import run
    if updated != previous:
        metadata = config.stat()
        private_write(backup, previous)
        private_write(config, updated)
        config.chmod(stat.S_IMODE(metadata.st_mode))
        if os.geteuid() == 0:
            os.chown(config, metadata.st_uid, metadata.st_gid)
    return run(root / 'tachyon', argv, env, '/exit', [], ready_marker=b'[Server] SERVER STARTED.', terminal_input=True, terminal_query_reply=True)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, UnicodeError):
        print('Tachyon setup refused. Review allocations, resources and native paths.', file=sys.stderr)
        raise SystemExit(1)
