#!/usr/bin/env python3
"""MIT. Source family aliases, sharing configuration and native supervision."""
import os
from pathlib import Path
import time
from source_runtime import GAMES, configure, private_write
from native_console import run
from source_install import update

# Keep variant registration separate while the base Source recipes are being
# accepted. Configuration, Steam updates and console transport remain shared.
VARIANTS = {'232370': ('hl2mp', 'dm_lockdown', 20),
            '295230': ('fof', 'fof_revenge', 32),
            '346680': ('bms', 'dm_crossfire', 128),
            '317670': ('nmrih', 'nms_northway', 8),
            '222840': ('left4dead', 'l4d_hospital01_apartment', 8),
            '222860': ('left4dead2', 'c1m1_hotel', 8),
            '673990': ('iosoccer', '8v8_vienna', 64)}
GAMES.update(VARIANTS)
BUILTIN_MODES = {'222840': ('coop', 'versus', 'survival'),
                 '222860': ('coop', 'versus', 'survival', 'realism', 'scavenge', 'teamversus', 'teamscavenge')}


def launch(root, env):
    env = dict(env)
    app = env.get('SRCDS_APPID', '')
    if app not in VARIANTS: raise ValueError('Choose a reviewed Source variant application')
    tickrate = None
    extras = []
    if app == '232370':
        # Preserve the original egg's public environment names and behavior.
        env['HOSTNAME'] = env.get('SERVER_NAME', 'Pterodactyl-server')
        env['SRCDS_MAP'] = env.get('MAP_NAME', 'dm_lockdown')
        env.setdefault('MAX_PLAYERS', '20')
        tickrate = int(env.get('TICK_RATE', '66'))
        if not 10 <= tickrate <= 128: raise ValueError('Choose a tick rate from 10 to 128')
    elif app == '673990':
        env['SRCDS_MAP'] = env.get('MAP', '8v8_vienna')
        env['MAX_PLAYERS'] = env.get('SLOTS', '32')
        env['RCON_PASSWORD'] = env.get('RCON', '')
        tickrate = int(env.get('TICKRATE', '100'))
        maximum_fps = int(env.get('MAX_FPS', '500'))
        if not 10 <= tickrate <= 128 or not 0 <= maximum_fps <= 1000:
            raise ValueError('Choose an IOsoccer tick rate from 10 to 128 and FPS limit from 0 to 1000')
        extras.append('fps_max ' + str(maximum_fps))
    elif app in ('222840', '222860'):
        import re
        mode = env.get('GAMEMODE', 'coop')
        if mode not in BUILTIN_MODES[app]: raise ValueError('Choose a built-in mode supported by this Left 4 Dead game')
        custom_mode = env.get('CUSTOM_GAMEMODE', '')
        if custom_mode:
            if not re.fullmatch(r'[A-Za-z0-9_]{1,64}', custom_mode): raise ValueError('Choose an installed mutation ID without console commands')
            mode = custom_mode
        difficulty = env.get('DIFFICULTY', 'Normal')
        lobby_only = env.get('LOBBY_ONLY', '0')
        if difficulty not in ('Easy', 'Normal', 'Hard', 'Impossible') or lobby_only not in ('0', '1'):
            raise ValueError('Choose a supported native difficulty and lobby setting')
        # L4D derives the real player capacity from its native mode definition.
        # Do not advertise an independent slot control that the engine ignores.
        if app == '222840': extras.append('mp_gamemode "' + mode + '"')
        extras += ['z_difficulty "' + difficulty + '"', 'sv_allow_lobby_connect_only ' + lobby_only]
    elif app == '317670': env.setdefault('MAX_PLAYERS', '8')
    elif app == '346680': env.setdefault('MAX_PLAYERS', '32')
    native_capacity = app in ('222840', '222860')
    launcher = 'srcds_run_64' if app == '673990' else 'srcds_run'
    argv, environment = configure(root, env, source_tv=not native_capacity, player_limit=not native_capacity, launcher=launcher, client_allocation=not native_capacity, server_config_selector=not native_capacity)
    if tickrate is not None: argv[1:1] = ['-tickrate', str(tickrate)]
    if app == '673990': argv[1:1] = ['-condebug', '+fps_max', str(maximum_fps)]
    if app in ('222840', '222860'):
        argv[1:1] = ['+mp_gamemode', mode]
    if extras:
        game = VARIANTS[app][0]
        target = root.resolve() / game / 'cfg/voltra-variant.cfg'
        if not target.resolve().is_relative_to(root.resolve()): raise ValueError('Source variant configuration escapes the server volume')
        content = '\n'.join(extras) + '\n'
        original = target.read_text(encoding='utf-8') if target.exists() else None
        if original is not None and original != content:
            state = root.resolve() / '.voltra/source/variant-config-backups'
            if not state.resolve().is_relative_to(root.resolve()): raise ValueError('Source variant backup escapes the volume')
            private_write(state / (str(time.time_ns()) + '.cfg'), original)
        if original != content: private_write(target, content)
        private_write(root.resolve() / game / 'cfg/voltra-server.cfg', 'exec server.cfg\nexec voltra-managed.cfg\nexec voltra-variant.cfg\n')
    if native_capacity:
        from source_l4d import append_footer
        append_footer(root, VARIANTS[app][0], readiness_marker=app == '222860')
    return argv, environment


if __name__ == '__main__':
    root = Path.cwd()
    app = os.environ.get('SRCDS_APPID', '')
    if app not in VARIANTS: raise ValueError('Unsupported Source variant application')
    automatic = os.environ.get('VOLTRA_STEAM_AUTO_UPDATE', os.environ.get('AUTO_UPDATE', '1'))
    if automatic not in ('0', '1'): raise ValueError('AUTO_UPDATE must be 0 or 1')
    if automatic == '1': update(root, int(app), validate=False, required=('srcds_run_64' if app == '673990' else 'srcds_run',))
    argv, environment = launch(root, os.environ)
    credentials = [os.environ.get(key, '') for key in ('SERVER_PASSWORD', 'RCON_PASSWORD', 'RCON', 'STEAM_GSLT', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    if app in ('222840', '222860'):
        from source_l4d import run_ready
        raise SystemExit(run_ready(run, root, argv, environment, credentials, os.environ))
    raise SystemExit(run(root, argv, environment, 'quit', credentials, terminal_input=True))
