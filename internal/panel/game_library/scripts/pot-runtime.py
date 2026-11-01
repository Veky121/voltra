"""PoT-only admission before publisher downloads or workspace mutation. MIT."""
import os
import re
import uuid
from pathlib import Path
from publisher_runtime import preflight as publisher_preflight, main as publisher_main
from publisher_install import install as publisher_install, confined
from tactical_runtime import integer, text
from native_config import patch_ini


def preflight(root, env):
    if env.get('VOLTRA_PUBLISHER') != 'titans':
        raise ValueError('This wrapper only supports the exact Path of Titans recipe')
    publisher_preflight(env)
    if env.get('POT_HOSTING_AGREEMENT') != '1':
        raise ValueError('Explicit operator acceptance of https://alderongames.com/legal/server-hosting-agreement is required')
    if env['AG_AUTH_TOKEN'].casefold() in ('changeme', 'token', 'your_auth_token_here'):
        raise ValueError('Configure a real entitled hosting token privately')
    guid = uuid.UUID(env['SERVER_GUID'])
    if guid.version != 4 or guid.int == 0:
        raise ValueError('A unique UUIDv4 server GUID is required')
    main = integer(env, 'SERVER_PORT', 7777, 1025, 65532)
    query = integer(env, 'QUERY_PORT', 7778, 1025, 65535)
    rcon = integer(env, 'RCON_PORT', 7779, 1025, 65535)
    try:
        allocated = {int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if p}
    except ValueError:
        raise ValueError('Invalid allocated port list') from None
    roles = [main, main + 1, main + 3, query, rcon]
    if len(set(roles)) != 5 or any(p not in allocated for p in roles):
        raise ValueError('Allocate distinct game, game+1, game+3, query and RCON ports before acquisition')
    game_map = env.get('SERVER_MAP', 'Island')
    if not re.fullmatch(r'[A-Za-z0-9_/-]{1,128}', game_map) or '..' in game_map.split('/'):
        raise ValueError('Choose a native map name')
    integer(env, 'SERVER_MAX_PLAYERS', 100, 1, 200)
    text(env.get('SERVER_NAME', 'YoutServerName'), 25)
    # Read and plan only. Preserve collections/comments and fail before updater
    # acquisition if a managed INI edit cannot be planned safely.
    root = Path(root).resolve()
    for name in ('server/PathOfTitans/Saved/Config/LinuxServer/Game.ini', 'server.properties'):
        target = confined(root, name)
        if target.exists():
            if target.stat().st_size > 8 * 1024**2:
                raise ValueError('PoT configuration exceeds limit')
            content = target.read_text(encoding='utf-8-sig')
            if name.endswith('Game.ini'):
                patch_ini(content, {'SourceQuery': {'bEnabled': 'true', 'Port': str(query), 'IP': '"0.0.0.0"'}})


def install(root, env):
    preflight(root, env)
    return publisher_install(root, env)


def main(root, env):
    preflight(root, env)
    return publisher_main(root, env)


if __name__ == '__main__':
    import sys
    try:
        if '--preflight' in sys.argv:
            preflight(Path.cwd(), dict(os.environ))
        else:
            raise SystemExit(main(Path.cwd(), dict(os.environ)))
    except (ValueError, OSError):
        # Do not interpolate publisher exceptions: malformed inputs may be secrets.
        print('Path of Titans prerequisite validation failed; check private token, agreement, GUID, allocations and native configuration.', file=sys.stderr)
        raise SystemExit(1)
