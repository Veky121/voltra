"""MIT. Typed Wine Generic, Nova-Life and Modiverse source adapters."""
import copy
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import sys
import tempfile
import unicodedata
from decimal import Decimal, InvalidOperation
import steam_template
import native_console
from fantasy_worlds_runtime import confined, publish, read_json, update_file, integer, boolean
from fantasy_worlds_install import Retention
from fantasy_worlds_wine import display, private_prefix
import sandbox_servers_release as release

APPS = {'nova': 1665030, 'modiverse': 1549820}
MOD_CONFIG = 'KJMod/Binaries/Linux/ServerData/ServerConfiguration.json'
DEFAULT_PRESERVE = ['.wine', 'Config', 'Saved', 'Saves', 'Worlds', 'Mods', 'Plugins', 'ServerConfig.toml', 'Resources']


def text(value, maximum=4096, empty=True):
    if not isinstance(value, str) or len(value) > maximum or not empty and not value or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Expected bounded literal text')
    return value


def volume_path(root, value, allow_root=False):
    value = text(value)
    # Retain documented relative paths plus exact installer/runtime volume
    # aliases. Whitespace, dollars, quotes and shell-looking names stay data.
    for prefix in ('/home/container', '/mnt/server'):
        if value == prefix or value.startswith(prefix + '/'):
            value = value[len(prefix):].lstrip('/')
            break
    if PurePosixPath(value).is_absolute() or '\\' in value or ':' in value:
        raise ValueError('Use a server-volume path')
    parts = []
    for part in value.split('/'):
        if part in ('', '.'): continue
        if part == '..':
            if not parts: raise ValueError('Path leaves server volume')
            parts.pop()
        else: parts.append(part)
    if not parts:
        if allow_root: return root
        raise ValueError('Choose a file or subdirectory in the server volume')
    return confined(root, '/'.join(parts))


def string_list(value, maximum=128):
    if not isinstance(value, str) or len(value.encode()) > 65536:
        raise ValueError('Expected bounded JSON string array')
    result = json.loads(value)
    if not isinstance(result, list) or len(result) > maximum:
        raise ValueError('Expected bounded JSON string array')
    return [text(item) for item in result]


def defaults():
    return json.loads(Path(__file__).with_name('sandbox_servers_defaults.json').read_text())


def ports(env):
    primary = integer(env.get('SERVER_PORT', ''), 1, 65535)
    raw = env.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*', raw):
        raise ValueError('Missing selected allocations')
    selected = {integer(value, 1, 65535) for value in raw.split(',')}
    if primary not in selected:
        raise ValueError('Primary port must be selected')
    return primary, selected


def secrets(value):
    result = []
    if isinstance(value, dict):
        for key, item in value.items():
            if re.search(r'password|secret|token|authkey|^pin$|adminpin', key, re.I) and isinstance(item, (str, int)) and not isinstance(item, bool):
                result.append(str(item))
            else: result.extend(secrets(item))
    elif isinstance(value, list):
        for item in value: result.extend(secrets(item))
    return result


def nova(root, env):
    primary, selected = ports(env)
    name = text(env.get('SERVER_NAME', ''), 64, False)
    if any(unicodedata.category(c)[0] not in ('L', 'M', 'N') and c not in '_-' for c in name):
        raise ValueError('Nova server profile must retain its original alpha_dash semantics')
    try:
        numeric_slots = Decimal(str(env.get('SERVER_SLOTS', '25')))
        if not numeric_slots.is_finite() or numeric_slots != numeric_slots.to_integral_value():
            raise ValueError('Native player slots must be a whole number')
        slots = integer(str(int(numeric_slots)), 1, 50)
    except InvalidOperation:
        raise ValueError('Invalid native player slots') from None
    list_name = text(env.get('SERVER_LIST_NAME', 'A Pterodactyl server'), 128, False)
    relative = 'Servers/' + name + '/Config/server.json'
    path = confined(root, relative)
    value = read_json(path) if path.exists() else copy.deepcopy(defaults()['nova'])
    value.update(serverName=name, serverListName=list_name, serverSlot=slots, serverPort=primary)
    used = {primary}
    for key, variable in (('queryPort', 'QUERY_PORT'), ('steamPort', 'STEAM_PORT')):
        explicit = env.get(variable, '')
        if explicit or key in value:
            chosen = integer(explicit if explicit else value[key], 1, 65535)
            if chosen not in selected or chosen in used:
                raise ValueError('Existing or explicit Nova listener needs its own selected allocation')
            value[key] = chosen; used.add(chosen)
    return [(path, value)], [str(confined(root, 'nova-life.x86_64')), '-batchmode', '-nographics', '-startServer', name], secrets(value), b'Server launched in '


def modiverse(root, env):
    primary, selected = ports(env)
    query = integer(env.get('QUERY_PORT', '27015'), 1, 65535)
    if query == primary or query not in selected:
        raise ValueError('Locked original QUERY_PORT=27015 requires its distinct selected allocation')
    hostname = text(env.get('HOSTNAME', 'Pterodactyl Server'), 32, False)
    maximum = integer(env.get('MAX_PLAYERS', '128'), 2, 128)
    path = confined(root, MOD_CONFIG)
    value = read_json(path) if path.exists() else copy.deepcopy(defaults()['modiverse'])
    argv = [str(confined(root, 'KJMod/Binaries/Linux/KJModServer')), '-port=' + str(primary), '-queryport=' + str(query),
            '-SteamServerName=' + hostname, '-KJModBaseUGCFolder=ServerData', '-DoNotRestartOnEmpty', '-InitUGCs', '-maxplayers=' + str(maximum)]
    credentials = secrets(value)
    alternate = confined(root, 'ServerData/ServerConfiguration.json')
    if alternate.exists(): credentials.extend(secrets(read_json(alternate)))
    return [(path, value)], argv, credentials, b'listening on port'


def generic(root, env):
    executable = volume_path(root, env.get('SERVER_EXECUTABLE', 'BeamMP-Server.exe'))
    arguments = string_list(env.get('SERVER_ARGUMENTS', '[]'))
    marker = text(env.get('READINESS_MARKER', ''), 1024)
    credentials = string_list(env.get('CONSOLE_SECRETS', '[]'))
    return [], ['wine', str(executable), *arguments], credentials, marker.encode() if marker else None


def plan(root, game, env):
    if game == 'generic': return generic(root, env)
    if game not in APPS or str(env.get('SRCDS_APPID', APPS[game])) != str(APPS[game]):
        raise ValueError('Use the original reviewed Steam application ID')
    return {'nova': nova, 'modiverse': modiverse}[game](root, env)


def configure(root, game, env):
    updates, argv, credentials, ready = plan(root, game, env)
    for path, value in updates:
        # Keep operator byte formatting when no managed field changed.
        if not path.exists() or read_json(path) != value:
            update_file(root, path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())
        else: path.chmod(0o600)
    blocked = {'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS', 'PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'CONSOLE_SECRETS', 'DOWNLOAD_URL'}
    environment = {key: value for key, value in env.items() if key not in blocked}
    environment.update(HOME=str(root), XDG_CONFIG_HOME=str(root / '.config'), XVFB='0')
    if game == 'generic': environment = private_prefix(root, environment)
    else: environment['LD_LIBRARY_PATH'] = str(root / '.steam/sdk64') + ':' + str(root / 'linux64')
    return argv, environment, credentials, ready


class State(Retention):
    def __init__(self, root, paths, backup):
        self.root, self.backup = root, Path(backup)
        self.files, self.directories, self.links, self.seen = {}, {}, {}, set()
        for relative in paths:
            self.capture(root / relative, 'sandbox')


def install_generic(root, env):
    generic(root, env)  # Validate all executable/argument/redaction data first.
    source = env.get('INSTALL_SOURCE', 'download')
    if source not in ('download', 'uploaded'):
        raise ValueError('Choose verified download or legal uploaded files')
    install = volume_path(root, env.get('INSTALL_DIR', ''), allow_root=True)
    relative = install.relative_to(root).as_posix()
    if PurePosixPath(relative).parts and PurePosixPath(relative).parts[0].casefold() == '.voltra':
        raise ValueError('Install directory may not replace adapter control files')
    preserve = [volume_path(root, value).relative_to(root).as_posix() for value in string_list(env.get('PRESERVE_PATHS', json.dumps(DEFAULT_PRESERVE)))]
    archive_name = env.get('UPLOAD_ARCHIVE', '')
    expected = release.checksum(env.get('DOWNLOAD_SHA256', '')) if source == 'download' else None
    if source == 'download': release.url(env.get('DOWNLOAD_URL', 'https://beamng-mp.com/server/BeamMP_Server.zip'))
    elif not archive_name:
        program = volume_path(root, env.get('SERVER_EXECUTABLE', 'BeamMP-Server.exe'))
        if not program.is_file(): raise ValueError('Upload your legally owned executable and required files first')
        return {'source': 'uploaded-files', 'native_verification': 'not_verified'}
    with tempfile.TemporaryDirectory(prefix='.voltra-generic-stage-',dir=root) as folder:
        temporary = Path(folder)
        if source == 'download':
            archive = temporary / 'download.archive'
            release.download(env.get('DOWNLOAD_URL', 'https://beamng-mp.com/server/BeamMP_Server.zip'), expected, archive)
        else:
            archive = volume_path(root, archive_name)
            if env.get('DOWNLOAD_SHA256', '') and release.digest(archive) != release.checksum(env['DOWNLOAD_SHA256']):
                raise ValueError('Uploaded archive checksum mismatch')
        if not archive.is_file() or archive.stat().st_size > release.MAX_ARCHIVE:
            raise ValueError('Missing or oversized verified archive')
        extracted = temporary / 'extracted'; extracted.mkdir()
        release.extract(archive, extracted)
        # Reject missing executable before changing any program file.
        executable = volume_path(root, env.get('SERVER_EXECUTABLE', 'BeamMP-Server.exe'))
        source_executable = extracted / executable.relative_to(install) if executable.is_relative_to(install) else None
        if not executable.is_file() and (source_executable is None or not source_executable.is_file()):
            raise ValueError('Archive layout does not provide configured root-relative executable')
        release.publish_tree(root, extracted, relative, preserve, {'source': source, 'sha256': release.digest(archive)})
        return {'source': source, 'archive_sha256': release.digest(archive), 'native_verification': 'not_verified'}


def install(root, game, env, validate=True):
    root = root.resolve()
    if game == 'generic': return install_generic(root, env)
    if game not in APPS or str(env.get('SRCDS_APPID', APPS[game])) != str(APPS[game]):
        raise ValueError('Use original reviewed Steam application ID')
    if env.get('EXTRA_FLAGS', ''): raise ValueError('Use typed Steam options instead of raw flags')
    steam_template.arguments(root, APPS[game], env, validate, platform='linux')
    plan(root, game, env)  # Controls and native configuration validate before copies/network.
    paths = ['Servers', 'Plugins', 'Mods', '.config'] if game == 'nova' else ['KJMod/Binaries/Linux/ServerData', 'KJMod/Saved', 'ServerData', 'Plugins', 'Mods']
    with tempfile.TemporaryDirectory(prefix='.voltra-sandbox-preserve-',dir=root) as backup:
        state = State(root, paths, backup)
        try:
            required = ('nova-life.x86_64',) if game == 'nova' else ('KJMod/Binaries/Linux/KJModServer',)
            result = steam_template.update(root, APPS[game], env, validate=validate, required=required)
        finally: state.restore()
    configure(root, game, env)
    return result


def main():
    os.umask(0o077)
    game, action, root, env = sys.argv[1], sys.argv[2], Path.cwd().resolve(), dict(os.environ)
    if action == 'install':
        install(root, game, env); return 0
    if action != 'run': raise ValueError('Unknown sandbox operation')
    if game != 'generic' and boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'))):
        install(root, game, env, validate=False)
    argv, environment, credentials, ready = configure(root, game, env)
    program = volume_path(root, env.get('SERVER_EXECUTABLE', 'BeamMP-Server.exe')) if game == 'generic' else Path(argv[0])
    if not program.is_file(): raise ValueError('Missing reviewed or legally uploaded server program')
    screen = None
    emitted, tail = False, b''
    def observe(data):
        nonlocal emitted, tail
        if ready and ready in tail + data and not emitted:
            emitted = True
            if game == 'generic': print('VOLTRA_GENERIC_READY', flush=True)
        if ready: tail = (tail + data)[-len(ready):]
    try:
        if game == 'generic': screen, environment = display(environment)
        return native_console.run(root, argv, environment, '\x03', credentials=credentials, ready_marker=ready, terminal_input=True, output_observer=observe, stop_signal=signal.SIGINT)
    finally:
        if screen and screen.poll() is None:
            screen.terminate()
            try: screen.wait(timeout=5)
            except Exception:
                screen.kill(); screen.wait(timeout=5)


if __name__ == '__main__':
    try: sys.exit(main())
    except Exception:
        print('Sandbox server operation failed. Check literal paths/controls, selected ports, verified publisher archive and operator licenses. Private Steam transport remains unavailable.', file=sys.stderr)
        sys.exit(1)
