"""MIT. Typed Neos, Resonite and NWN startup; never sends credentials in argv."""
import json
import os
import pwd
import re
from pathlib import Path, PurePosixPath
import sys
import tomllib
import steam_template
from native_console import run


def confined(root, relative):
    relative = str(relative)
    parts = PurePosixPath(relative).parts
    if not parts or PurePosixPath(relative).is_absolute() or '\\' in relative or any(p in ('.', '..') for p in parts):
        raise ValueError('Expected a relative server-volume path')
    target = root / relative
    if not target.resolve().is_relative_to(root) or any(p.is_symlink() for p in (target, *target.parents) if p.is_relative_to(root)):
        raise ValueError('Server path must not traverse a symlink')
    if target.exists() and not (target.is_file() or target.is_dir()):
        raise ValueError('Server path must be a regular file or directory')
    return target


def text(value, maximum=1024):
    if not isinstance(value, str) or len(value.encode('utf-8')) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Expected bounded single-line text')
    return value


def integer(value, low, high):
    if not re.fullmatch('[0-9]+', str(value)) or not low <= int(value) <= high:
        raise ValueError('Numeric setting outside supported range')
    return int(value)


def boolean(value):
    if str(value).lower() not in ('true', 'false', '1', '0'):
        raise ValueError('Expected true/false or 1/0')
    return str(value).lower() in ('true', '1')


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError('Duplicate JSON key')
        result[key] = value
    return result


def read_json(path):
    if path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('Configuration exceeds four MiB')
    result = json.loads(path.read_text(encoding='utf-8-sig'), object_pairs_hook=pairs,
                        parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
    if not isinstance(result, dict):
        raise ValueError('Configuration must be a JSON object')
    return result


def publish(root, relative, data, mode=0o600):
    confined(root, relative)
    steam_template._publish(root, relative, lambda output: output.write(data), default_mode=mode)


def port(root, env):
    primary = integer(env.get('SERVER_PORT', ''), 1, 65535)
    allocated = {integer(x, 1, 65535) for x in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if x}
    if primary not in allocated:
        raise ValueError('Primary port must belong to the selected allocations')
    return primary, allocated


def secret_values(value):
    result = []
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, str) and item and any(name in key.lower() for name in ('password', 'credential', 'token', 'secret')):
                result.append(item)
            result.extend(secret_values(item))
    elif isinstance(value, list):
        for item in value:
            result.extend(secret_values(item))
    return result


def headless_config(root, game, env):
    primary, allocated = port(root, env)
    base = '' if game == 'neos' else 'Headless/'
    path = confined(root, base + 'Config/Config.json')
    existing = path.exists()
    value = read_json(path) if existing else {'comment': 'Voltra private initial session', 'startWorlds': [
        {'sessionName': 'Voltra', 'loadWorldPresetName': 'Grid', 'accessLevel': 'Private',
         **({'forcePort': primary} if game == 'neos' else {'forcePorts': {'lnl': primary}})}]}
    worlds = value.get('startWorlds')
    if not isinstance(worlds, list) or len(worlds) > 256:
        raise ValueError('Headless startWorlds must be an array of at most 256 entries')
    for world in worlds:
        if not isinstance(world, dict):
            raise ValueError('Headless world entry must be an object')
        for candidate in [world.get('forcePort'), world.get('forceResoniteLinkPort')]:
            if candidate is not None and (isinstance(candidate, bool) or integer(candidate, 1, 65535) not in allocated):
                raise ValueError('Headless world listener must use a selected allocation')
        ports = world.get('forcePorts', {})
        if not isinstance(ports, dict):
            raise ValueError('forcePorts must be an object')
        for protocol, candidate in ports.items():
            if protocol not in ('lnl', 'quic', 'tcp') or isinstance(candidate, bool) or integer(candidate, 1, 65535) not in allocated:
                raise ValueError('Headless protocol listener must use a selected allocation')
    for name in ('dataFolder', 'cacheFolder', 'logsFolder'):
        if value.get(name):
            directory = Path(value[name])
            if directory.is_absolute():
                if not directory.is_relative_to(root):
                    raise ValueError('Headless data paths must stay inside the server volume')
                confined(root, directory.relative_to(root))
            else:
                confined(root, base + str(directory))
    # Existing JSON is operator-owned: not reformatted, rewritten or chmodded.
    if not existing:
        publish(root, base + 'Config/Config.json', (json.dumps(value, indent=2) + '\n').encode())
    return path, secret_values(value)


def password_toml(content, values):
    """Keep unknown TOML/comments intact. Only update two managed scalar keys."""
    tomllib.loads(content)
    newline = '\r\n' if '\r\n' in content else '\n'
    section = None
    output = []
    seen = set()
    found_section = False
    def missing():
        for key, value in values.items():
            if key not in seen:
                output.append(key + ' = ' + json.dumps(value, ensure_ascii=False) + newline)
                seen.add(key)
    for line in content.splitlines(keepends=True):
        header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:#.*)?', line.strip())
        if header:
            if section == 'server.login':
                missing()
            section = header.group(1)
            found_section |= section == 'server.login'
        elif section == 'server.login':
            match = re.match(r'\s*([A-Za-z0-9_-]+)\s*=\s*(.*)', line)
            if match and match.group(1) in values:
                if match.group(2).startswith(('"""', "'''")):
                    raise ValueError('Managed passwords must use single-line TOML strings')
                key = match.group(1)
                line = key + ' = ' + json.dumps(values[key], ensure_ascii=False) + newline
                seen.add(key)
        if output and not output[-1].endswith(('\r', '\n')):
            output[-1] += newline
        output.append(line)
    if output and not output[-1].endswith(('\r', '\n')):
        output[-1] += newline
    if section == 'server.login':
        missing()
    elif not found_section:
        output.append('[server.login]' + newline)
        missing()
    result = ''.join(output)
    parsed = tomllib.loads(result)
    if any(parsed['server']['login'].get(key) != value for key, value in values.items()):
        raise ValueError('Managed password TOML update failed')
    return result


def nwn(root, env):
    primary, _ = port(root, env)
    executable = confined(root, 'bin/linux-x86/nwserver-linux')
    if not executable.is_file():
        raise ValueError('Install the official dedicated-server archive first')
    module = text(env.get('MODULE_NAME', ''), 255)
    if '/' in module or '\\' in module or module in ('.', '..'):
        raise ValueError('MODULE_NAME must be a module name without directory traversal')
    slot = env.get('SAVE_SLOT', '')
    if slot:
        slot = str(integer(slot, 2, 99999))
    elif not module:
        raise ValueError('MODULE_NAME is required when SAVE_SLOT is blank')
    argv = [str(executable), '-interactive', '-port', str(primary), '-userdirectory', str(confined(root, 'user'))]
    argv += ['-load', slot] if slot else ['-module', module]
    mapping = [
        ('MAX_CLIENTS', 'maxclients', '96', 1, 244), ('MIN_LEVEL', 'minlevel', '1', 1, 40),
        ('MAX_LEVEL', 'maxlevel', '40', 1, 40), ('PAUSE_AND_PLAY', 'pauseandplay', '1', 0, 1),
        ('PVP', 'pvp', '2', 0, 2), ('SERVER_VAULT', 'servervault', '1', 0, 1),
        ('ELC', 'elc', '1', 0, 1), ('ILR', 'ilr', '1', 0, 1), ('GAME_TYPE', 'gametype', '0', 0, 65535),
        ('ONE_PARTY', 'oneparty', '0', 0, 1), ('DIFFICULTY', 'difficulty', '3', 1, 4),
        ('AUTO_SAVE_INTERVAL', 'autosaveinterval', '0', 0, 2147483647),
        ('IS_PUBLIC', 'publicserver', '0', 0, 1), ('RELOAD_WHEN_EMPTY', 'reloadwhenempty', '0', 0, 1)]
    for key, flag, default, low, high in mapping:
        value = env.get(key, default)
        if high == 1:
            value = '1' if boolean(value) else '0'
        argv += ['-' + flag, str(integer(value, low, high))]
    if int(argv[argv.index('-minlevel') + 1]) > int(argv[argv.index('-maxlevel') + 1]):
        raise ValueError('MIN_LEVEL exceeds MAX_LEVEL')
    argv += ['-servername', text(env.get('SERVER_NAME', 'A Pterodactyl hosted server'), 255)]
    values = {'player-password': text(env.get('PLAYER_PASSWORD', '')), 'dm-password': text(env.get('DM_PASSWORD', ''))}
    settings = confined(root, 'user/settings.tml')
    if settings.exists() and settings.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('Native TOML exceeds four MiB')
    original = settings.read_bytes() if settings.exists() else b''
    content = password_toml(original.decode('utf-8-sig'), values).encode('utf-8')
    if content != original:
        if original:
            import time
            publish(root, '.voltra/virtual-worlds/backups/' + str(time.time_ns()) + '-settings.tml', original)
        publish(root, 'user/settings.tml', content)
    # Credential-bearing configuration is always private, even on a no-op.
    settings.chmod(0o600)
    parsed = tomllib.loads(content.decode())
    return executable.parent, argv, '\x03', list(values.values()) + secret_values(parsed), b'Server: Module loaded'


def nss_environment(root):
    """NWN dereferences getpwuid unconditionally; Wings UIDs may lack an entry."""
    try:
        pwd.getpwuid(os.getuid())
        return {}
    except KeyError:
        pass
    library = confined(root, '.voltra/virtual-worlds/nss/libnss_wrapper.so')
    if not library.is_file():
        raise ValueError('This runtime UID needs the privately installed libnss-wrapper dependency')
    if any(c in str(root) for c in ':\r\n'):
        raise ValueError('Server home cannot be represented in a private NSS mapping')
    passwd = confined(root, '.voltra/virtual-worlds/nss/passwd')
    group = confined(root, '.voltra/virtual-worlds/nss/group')
    publish(root, passwd.relative_to(root).as_posix(), ('voltra:x:' + str(os.getuid()) + ':' + str(os.getgid()) + ':Voltra server:' + str(root) + ':/bin/sh\n').encode())
    publish(root, group.relative_to(root).as_posix(), ('voltra:x:' + str(os.getgid()) + ':\n').encode())
    return {'LD_PRELOAD': str(library), 'NSS_WRAPPER_PASSWD': str(passwd), 'NSS_WRAPPER_GROUP': str(group)}


class NWNReady:
    """Normalize only actual publisher load-completion lines, never early boot."""
    def __init__(self):
        self.pending = b''
        self.ready = False

    def feed(self, data):
        self.pending += re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', data)
        while b'\n' in self.pending:
            line, self.pending = self.pending.split(b'\n', 1)
            if not self.ready and line.strip() in (b'Server: Module loaded', b'Server: Saved game loaded'):
                self.ready = True
                sys.stdout.buffer.write(b'VOLTRA_NWN_READY\n')
                sys.stdout.buffer.flush()
        self.pending = self.pending[-4096:]


def configure(root, game, env):
    root = root.resolve()
    if game == 'nwn':
        cwd, argv, stop, credentials, ready = nwn(root, env)
    elif game in ('neos', 'resonite'):
        base = '' if game == 'neos' else 'Headless/'
        executable = confined(root, base + ('Neos.exe' if game == 'neos' else 'Resonite.dll'))
        if not executable.is_file():
            raise ValueError('Entitled headless payload is absent. Private Steam transport is not enabled; use your own legally acquired files and disable AUTO_UPDATE.')
        modded = boolean(env.get('ENABLE_MODLOADER', 'false'))
        config, credentials = headless_config(root, game, env)
        cwd = root if game == 'neos' else confined(root, 'Headless')
        argv = ['mono' if game == 'neos' else 'dotnet', str(executable)]
        argv += (['-c', str(config), '-l', str(confined(root, 'Logs'))] if game == 'neos' else
                 ['-HeadlessConfig', str(config), '-Logs', str(confined(root, 'Headless/Logs'))])
        if modded:
            from virtual_worlds_install import install_mods
            loader = install_mods(root, game)
            argv += ['-LoadAssembly', str(loader)]
        stop, ready = 'shutdown', b'World running'
    else:
        raise ValueError('Unknown virtual-world recipe')
    clean = {key: value for key, value in env.items() if not key.startswith('NSS_WRAPPER_') and key not in (
        'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS', 'PLAYER_PASSWORD', 'DM_PASSWORD',
        'PYTHONPATH', 'PYTHONHOME', 'LD_PRELOAD')}
    clean.update(HOME=str(root), XVFB='0')
    if game == 'nwn':
        clean.update(nss_environment(root))
    return cwd, argv, clean, stop, credentials, ready


def main():
    from virtual_worlds_install import install
    game = sys.argv[1]
    root = Path.cwd().resolve()
    env = dict(os.environ)
    if game == 'nwn':
        # The engine rewrites settings.tml itself. Its replacement files must
        # remain private after our initial atomic config write/chmod.
        os.umask(0o077)
    if game != 'nwn' and boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'))):
        install(root, game, env)
    cwd, argv, clean, stop, credentials, ready = configure(root, game, env)
    observer = NWNReady() if game == 'nwn' else None
    return run(cwd, argv, clean, stop, credentials=credentials, ready_marker=ready, terminal_input=True,
               output_observer=observer.feed if observer else None)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Virtual-world startup failed. Check selected allocations, configuration, payload and documented entitlement prerequisites.', file=sys.stderr)
        sys.exit(1)
