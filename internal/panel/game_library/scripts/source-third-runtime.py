#!/usr/bin/env python3
"""MIT. Typed Source2/Sven/legacy TF2C launchers using shared native console."""
import os
import hashlib
from pathlib import Path
import re
import threading
import source_l4d
from native_console import run
from source_runtime import quoted, private_write
from source_third_install import selection, install


SVEN_ORIGINAL_SHA256 = 'ea85064073709d24bae8abcc29d4bff7bf70b5cf82aeeb3a4372a17bcaee9b2c'
SVEN_PATCHED_SHA256 = 'ce155394e8043334f97d5e9439c2c114ee4f69470f32086ffd1016615fa20148'
SVEN_BRANCH = b'# debug not requested we can exec\n\t\t\t$GAME_BIN_CMD'


def sven_launcher(root, binary):
    """Preserve publisher bytes; accept only our exact owned launcher copy."""
    if binary != root / 'svends_run': raise ValueError('Unexpected Sven launcher path')
    for path in (root, binary, root / '.voltra', root / '.voltra-svends-run-exec'):
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError('Sven launcher symlink or traversal refused')
    if not (root / '.voltra').is_dir(): raise ValueError('Missing owned runtime directory')
    original = binary.read_bytes()
    if hashlib.sha256(original).hexdigest() != SVEN_ORIGINAL_SHA256 or original.count(SVEN_BRANCH) != 1:
        raise ValueError('Sven publisher launcher hash or branch drift')
    patched = original.replace(SVEN_BRANCH, SVEN_BRANCH.replace(b'\t\t\t$GAME_BIN_CMD', b'\t\t\texec $GAME_BIN_CMD'))
    if hashlib.sha256(patched).hexdigest() != SVEN_PATCHED_SHA256: raise ValueError('Sven patched launcher drift')
    target = root / '.voltra-svends-run-exec'
    if target.exists():
        if not target.is_file() or target.read_bytes() != patched or target.stat().st_nlink != 1:
            raise ValueError('Foreign existing Sven launcher refused')
    else:
        with target.open('xb') as output: output.write(patched)
        target.chmod(0o700)
    return target


def integer(env, key, default, minimum, maximum):
    value = env.get(key, str(default))
    if not re.fullmatch(r'-?[0-9]{1,8}', value) or not minimum <= int(value) <= maximum: raise ValueError('Invalid native numeric setting: ' + key)
    return int(value)


def configure(root, env):
    root = root.resolve(); kind, app, game, executable = selection(env)
    binary = root / executable
    if not binary.resolve().is_relative_to(root) or not binary.is_file(): raise ValueError('Publisher native launcher is missing or outside volume')
    main = integer(env, 'SERVER_PORT', 27015, 1025, 65535)
    allocated = {int(port) for port in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if port}
    if main not in allocated or any(not 1025 <= port <= 65535 for port in allocated): raise ValueError('Game port requires its own allocation')
    game_map = env.get('SC_MAP' if kind == 'sven' else 'SRCDS_MAP', 'svencoop1' if kind == 'sven' else 'de_dust2' if kind == 'cs2' else 'ctf_2fort')
    if not re.fullmatch(r'[A-Za-z0-9_/-]{1,128}', game_map) or any(part in ('', '.', '..') for part in game_map.split('/')): raise ValueError('Choose a native map without traversal or console delimiters')
    name = env.get('SC_NAME' if kind == 'sven' else 'SERVER_NAME', 'Dedicated server')
    password = env.get('SC_PASSWORD' if kind == 'sven' else 'SERVER_PASSWORD', '')
    values = {'hostname': quoted(name, 40 if kind == 'sven' else 128), 'sv_password': quoted(password, 20 if kind == 'sven' else 128), 'rcon_password': quoted(env.get('RCON_PASSWORD', ''))}
    capacity = integer(env, 'SC_PLAYERS' if kind == 'sven' else 'MAX_PLAYERS' if kind == 'cs2' else 'MAXPLAYERS', 12 if kind != 'tf2classic' else 24, 2 if kind == 'sven' else 1, 64 if kind == 'cs2' else 32)
    argv = [str(binary), '-console', '-port', str(main), '-ip', '0.0.0.0', '-strictportbind', '-norestart']
    if kind == 'cs2':
        argv += ['-dedicated', '-maxplayers', str(capacity)]
        for key in ('VAC_ENABLED', 'RCON_ENABLED'):
            if env.get(key, '1' if key == 'VAC_ENABLED' else '0') not in ('0', '1'): raise ValueError('Native toggles must be 0 or 1')
        if env.get('VAC_ENABLED', '1') == '0': argv += ['-insecure']
        if env.get('RCON_ENABLED', '0') == '1': argv += ['-usercon']
        available = sorted(allocated - {main}); tv = integer(env, 'TV_PORT', 0, 0, 65535)
        if tv == 0: tv = available[0] if available else 0
        if tv not in available: raise ValueError('SourceTV needs a distinct additional allocation')
        argv += ['-tv_port', str(tv), '+game_mode', str(integer(env, 'GAME_MODE', 1, 0, 10)), '+game_type', str(integer(env, 'GAME_TYPE', 0, 0, 10))]
        token = env.get('STEAM_GSLT', '')
        if token and not re.fullmatch(r'[A-Za-z0-9]{32}', token): raise ValueError('Invalid game server token')
        values['sv_setsteamaccount'] = quoted(token)
    elif kind == 'sven':
        argv[0] = str(sven_launcher(root, binary))
        if '-norestart' not in argv or '-debug' in argv: raise ValueError('Sven requires no restart and no debug')
        argv += ['+maxplayers', str(capacity)]
    else: argv += ['-game', game, '-debug', '+maxplayers', str(capacity)]
    cfg = root / game / ('server.cfg' if kind == 'sven' else 'cfg/server.cfg')
    # GoldSrc reparses '-' inside +command values as an option boundary.
    # Keep Sven filenames command-parser safe; other reviewed games unchanged.
    managed_name = 'voltra_managed.cfg' if kind == 'sven' else 'voltra-managed.cfg'
    wrapper_name = 'voltra_server.cfg' if kind == 'sven' else 'voltra-server.cfg'
    managed = cfg.with_name(managed_name); wrapper = cfg.with_name(wrapper_name)
    bootstrap = cfg.with_name('voltra_bootstrap.cfg') if kind == 'sven' else None
    for path in (cfg, managed, wrapper) + ((bootstrap,) if bootstrap else ()):
        if not path.resolve().is_relative_to(root): raise ValueError('Native configuration escapes volume')
    private_write(managed, '// Setup controls only; operator server.cfg remains intact.\n' + ''.join(key + ' ' + value + '\n' for key, value in values.items()))
    private_write(wrapper, 'exec server.cfg\nexec ' + managed_name + '\n')
    if kind == 'sven':
        # Reuse GoldSrc's CFG command buffer path: '-' in a +map value is
        # reparsed as an option. Only the fixed safe filename enters argv.
        private_write(bootstrap, 'servercfgfile ' + wrapper_name + '\nmap ' + quoted(game_map) + '\nexec ' + managed_name + '\n')
        argv += ['+exec', bootstrap.name]
    else:
        argv += ['+servercfgfile', wrapper_name, '+exec', managed_name, '+map', game_map]
    environment = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD'): environment.pop(key, None)
    environment['LD_LIBRARY_PATH'] = ':'.join(str(root / p) for p in (('game/bin/linuxsteamrt64', 'game/csgo/bin/linuxsteamrt64') if kind == 'cs2' else ('bin',)))
    return argv, environment, (main, name, game_map, bool(password))


def main(root, env):
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1'): raise ValueError('Automatic updates must be 0 or 1')
    if automatic == '1': install(root, env, validate=False)
    argv, environment, query = configure(root, env); cancel = threading.Event()
    def emit(marker, **kwargs):
        if not cancel.is_set(): print('VOLTRA_SOURCE_THIRD_MAP_READY', flush=True)
    observer = threading.Thread(target=source_l4d.query_ready, args=(*query, cancel), kwargs={'emit': emit}, daemon=True)
    credentials = tuple(env.get(key, '') for key in ('SC_PASSWORD', 'SERVER_PASSWORD', 'RCON_PASSWORD', 'STEAM_GSLT', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS'))
    # Start querying only after this actual child produces raw output. This
    # avoids accepting another process's old response before spawning our own.
    started = False
    def output(data):
        nonlocal started
        if data and not started and not cancel.is_set():
            started = True; observer.start()
    try:
        status = run(root, argv, environment, 'quit', credentials, terminal_input=True, output_observer=output)
        if env.get('VOLTRA_SOURCE_THIRD') == 'sven': print('VOLTRA_SVEN_NATIVE_CHILD_RETURN ' + str(status), flush=True)
        return status
    finally:
        cancel.set()
        if started: observer.join(timeout=1)


if __name__ == '__main__': raise SystemExit(main(Path.cwd(), dict(os.environ)))