"""Resonite-only validation before shared installer/runtime side effects. MIT."""
import json
import math
import os
from pathlib import Path
import re
import sys


def pairs(items):
    result = {}
    seen = set()
    for key, value in items:
        if key.casefold() in seen:
            raise ValueError('Ambiguous configuration keys')
        seen.add(key.casefold())
        result[key] = value
    return result


def preflight(root, env):
    def flag(name, default):
        value = env.get(name, default)
        if value not in ('0', '1', 'true', 'false'):
            raise ValueError('Invalid boolean control')
        return value in ('1', 'true')
    update = flag('AUTO_UPDATE', '1')
    if 'VOLTRA_STEAM_AUTO_UPDATE' in env:
        update = flag('VOLTRA_STEAM_AUTO_UPDATE', '1')
    flag('ENABLE_MODLOADER', 'false')
    if env.get('SRCDS_APPID', '2519830') != '2519830' or env.get('SRCDS_BETAID', 'headless') != 'headless':
        raise ValueError('Unexpected application or branch')
    def port(value):
        if not re.fullmatch(r'[0-9]{1,5}', str(value)) or not 1 <= int(value) <= 65535:
            raise ValueError('Invalid allocation')
        return int(value)
    allocated = {port(v) for v in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if v}
    if port(env.get('SERVER_PORT', '')) not in allocated:
        raise ValueError('Primary listener is not allocated')
    def confined(relative):
        target = root / relative
        if not target.resolve().is_relative_to(root) or any(p.is_symlink() for p in (target, *target.parents) if p.is_relative_to(root)):
            raise ValueError('Native path escapes volume')
        return target
    path = confined('Headless/Config/Config.json')
    confined('Headless/Logs')
    if path.exists():
        if not path.is_file() or path.stat().st_size > 4 * 1024 * 1024:
            raise ValueError('Invalid native configuration file')
        value = json.loads(path.read_text(encoding='utf-8-sig'), object_pairs_hook=pairs,
                           parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
        if not isinstance(value, dict):
            raise ValueError('Expected configuration object')
        # Shared runtime currently consumes lower camel case. Refuse unsupported
        # aliases rather than silently reading a different value than the engine.
        for key in value:
            if key.casefold() in {k.casefold() for k in ('startWorlds', 'tickRate', 'maxConcurrentAssetTransfers', 'dataFolder', 'cacheFolder', 'logsFolder')} and key not in ('startWorlds', 'tickRate', 'maxConcurrentAssetTransfers', 'dataFolder', 'cacheFolder', 'logsFolder'):
                raise ValueError('Unsupported native key casing')
        for key in ('tickRate', 'maxConcurrentAssetTransfers'):
            if key in value:
                n = value[key]
                if isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or n <= 0 or (key == 'maxConcurrentAssetTransfers' and not isinstance(n, int)):
                    raise ValueError('Invalid native numeric setting')
        worlds = value.get('startWorlds')
        if not isinstance(worlds, list) or len(worlds) > 256:
            raise ValueError('Invalid world list')
        for world in worlds:
            if not isinstance(world, dict):
                raise ValueError('Invalid world')
            for key, item in world.items():
                if key in ('isEnabled', 'saveOnExit', 'autoRecover', 'autoSleep', 'keepOriginalRoles', 'mobileFriendly') and not isinstance(item, bool):
                    raise ValueError('Invalid world boolean')
                if key == 'maxUsers' and (isinstance(item, bool) or not isinstance(item, int) or item < 1):
                    raise ValueError('Invalid maximum users')
            ports = world.get('forcePorts', {})
            if not isinstance(ports, dict):
                raise ValueError('Invalid protocol mapping')
            for protocol, candidate in ports.items():
                if protocol not in ('lnl', 'quic', 'tcp') or port(candidate) not in allocated:
                    raise ValueError('Unallocated protocol listener')
            for key in ('forcePort', 'forceResoniteLinkPort'):
                if world.get(key) is not None and port(world[key]) not in allocated:
                    raise ValueError('Unallocated listener')
        for key in ('dataFolder', 'cacheFolder', 'logsFolder'):
            if value.get(key):
                if not isinstance(value[key], str) or '\\' in value[key]:
                    raise ValueError('Invalid native folder')
                directory = Path(value[key])
                confined(directory if directory.is_absolute() else Path('Headless') / directory)
    if update:
        raise ValueError('Private Steam transport unavailable; acquisition requires separately verified entitlement and transport')


def main():
    root = Path.cwd().resolve()
    preflight(root, dict(os.environ))
    if len(sys.argv) != 2 or sys.argv[1] not in ('runtime', 'install', 'check'):
        raise ValueError('Choose runtime, install or check')
    if sys.argv[1] == 'check':
        return 0
    if sys.argv[1] == 'install':
        raise ValueError('Private Steam acquisition remains unavailable')
    from virtual_worlds_runtime import main as runtime
    sys.argv = [sys.argv[0], 'resonite']
    return runtime()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        # Never echo config, credentials, argv or publisher exceptions.
        print('Resonite prerequisite/configuration check failed; no acquisition was authorized.', file=sys.stderr)
        sys.exit(1)
