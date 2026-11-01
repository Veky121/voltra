"""MOHAA-only native-file authority adapter. No acquisition at runtime."""
import os
import re
from pathlib import Path
from small_games_family_runtime import number, text


def checked(root, value):
    path = Path(value)
    if not path.is_absolute():
        path = root / path
    if not path.resolve().is_relative_to(root):
        raise ValueError('MOHAA path leaves server volume')
    current = path
    while current != root:
        if current.is_symlink():
            raise ValueError('MOHAA paths cannot contain symlinks')
        current = current.parent
    return path


def configure(root, env):
    root = root.resolve()
    port = number(env.get('SERVER_PORT', ''), 1, 65535)
    if port not in env.get('VOLTRA_ALLOCATED_PORTS', '').split(','):
        raise ValueError('Choose an allocated primary port')
    base = checked(root, env.get('BASE_PATH') or root)
    home = checked(root, env.get('LOG_DIR') or root / 'Logs')
    binary = checked(root, root / 'mohaa/omohaaded')
    config = checked(root, base / 'main/server.cfg')
    shadow = checked(root, home / 'main/server.cfg')
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError('Install the reviewed executable before starting MOHAA')
    asset = checked(root, base / 'main/Pak0.pk3')
    if not asset.is_file() or asset.stat().st_size == 0:
        raise ValueError('Supply legally acquired main/Pak*.pk3 assets before starting MOHAA')
    if shadow != config and shadow.exists():
        raise ValueError('Ambiguous home/base server.cfg authority; retain files and resolve explicitly')
    if config.exists() and not config.is_file():
        raise ValueError('server.cfg must be a regular file')
    if not config.parent.is_dir() or (home.exists() and not home.is_dir()):
        raise ValueError('MOHAA config/log directory is invalid')
    # Validate all seed inputs before mutation, even when a native file exists.
    values = [text(env.get(k, default)) for k, default in (
        ('SERVER_NAME', 'MOHAA Server'), ('SERVER_PASSWORD', ''), ('RCON_PASSWORD', ''))]
    if any(any(c in value for c in ('"', '\\', ';')) for value in values):
        raise ValueError('Unsafe MOHAA seed text')
    maximum = number(env.get('SERVER_MAXCLIENTS', '14'), 1, 64)
    mapname = text(env.get('SERVER_MAP', 'dm/mohdm7'), 80)
    if not re.fullmatch(r'(dm|obj)/[A-Za-z0-9_-]+', mapname):
        raise ValueError('Invalid MOHAA map')
    # Never parse/rewrite an existing native CFG, including duplicate/unknown commands.
    if not config.exists():
        seed = ''.join(f'seta {key} "{value}"\n' for key, value in zip(
            ('sv_hostname', 'g_password', 'rconPassword', 'sv_maxclients'), values + [maximum]))
        seed += f'map "{mapname}"\n'
        fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as out:
            out.write(seed)
    environment = {k: v for k, v in env.items() if k not in (
        'PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH')}
    environment.update(HOME=str(root), LD_LIBRARY_PATH=str(binary.parent))
    argv = [str(binary), '+set', 'com_target_game', '0', '+set', 'sv_punkbuster', '0',
            '+set', 'fs_basepath', str(base), '+set', 'fs_homepath', str(home),
            '+set', 'com_logfile', '1', '+set', 'dedicated', '2',
            '+set', 'net_ip', '0.0.0.0', '+set', 'net_port', port, '+exec', 'server.cfg']
    return binary.parent, argv, environment, 'quit', values[1:], 'Server Initialization Complete'


if __name__ == '__main__':
    from native_console import run
    import sys
    cwd, argv, environment, stop, credentials, ready = configure(Path.cwd(), dict(os.environ))
    sys.exit(run(cwd, argv, environment, stop, credentials, ready_marker=ready.encode(),
                 terminal_input=True, terminal_query_reply=True))
