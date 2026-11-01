#!/usr/bin/env python3
"""Astroneer-only adapter. Existing native files win over setup seed values."""
import importlib.util
import os
from pathlib import Path
import re
import signal
import sys
import threading


def load():
    spec = importlib.util.spec_from_file_location('astro_legacy', Path(__file__).with_name('space-survival.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


legacy = load()
SECTION = '/Script/Astro.AstroServerSettings'
VULKAN_LIBRARY = Path('/usr/lib/x86_64-linux-gnu/libvulkan.so.1')


def seed(content, section, values):
    """Append missing scalars only; retain duplicate rows and operator text."""
    # Validate all managed identities, including present seed values, before
    # deciding which values to append. Unmanaged repeated arrays stay intact.
    legacy.native.resolve_ini_identities(content, {section: values})
    current = ''; present = set()
    for line in content.splitlines():
        match = re.match(r'^\s*\[([^]]+)\]', line)
        if match:
            current = match[1].casefold()
        elif current == section.casefold() and '=' in line and not line.lstrip().startswith((';', '#')):
            present.add(line.split('=', 1)[0].strip().casefold())
    missing = {k: v for k, v in values.items() if k.casefold() not in present}
    return legacy.native.patch_ini(content, {section: missing}, case_insensitive=True) if missing else content


def configure(root, env):
    root = Path(root).resolve()
    shared = legacy.shared
    settings = shared.confined(root, root/'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini')
    engine = shared.confined(root, root/'Astro/Saved/Config/WindowsServer/Engine.ini')
    # Validate all seeds before any write, using the original typed parser on an
    # in-memory document rather than modifying operator files.
    public = shared.text(env, 'PUBLIC_IP', '', 64)
    legacy.ipaddress.ip_address(public)
    owner = shared.text(env, 'OWNER_NAME', '', 100)
    content = settings.read_text(encoding='utf-8-sig') if settings.exists() else ''
    guid = legacy.helper('astroneer-rcon').owner_guid(content, env.get('OWNER_GUID', ''))
    if not owner:
        raise ValueError('Owner name/GUID required')
    values = {'PublicIP': public, 'OwnerName': owner, 'OwnerGuid': guid,
              'ServerPassword': shared.text(env, 'SERVER_PWD', '', 100),
              'ServerName': shared.text(env, 'SERVER_NAME', 'Pterodactyl hosted Server', 60)}
    content = settings.read_text(encoding='utf-8-sig') if settings.exists() else ''
    updated = seed(content, SECTION, values)
    control = legacy.helper('astroneer-rcon')
    legacy.shared.roles(env, [])
    allocated = [int(value) for value in env['VOLTRA_ALLOCATED_PORTS'].split(',')]
    controls = control.plan(updated, allocated, allocated)
    updated = legacy.native.patch_ini(updated, {SECTION: controls}, case_insensitive=True)
    previous = engine.read_text(encoding='utf-8-sig') if engine.exists() else ''
    port = legacy.shared.roles(env, [])['primary']
    engine_text = seed(previous, 'SystemSettings', {'net.AllowEncryption': 'false'})
    engine_text = legacy.native.patch_ini(engine_text, {'URL': {'Port': str(port)}}, case_insensitive=True)
    shared.write_config(root, settings, updated)
    if engine_text != previous: shared.write_config(root, engine, engine_text)
    # Native passwords can differ from the original environment after a UI edit.
    passwords = re.findall(r'(?mi)^\s*ServerPassword\s*=\s*(.*)$', updated)
    return passwords + [controls['ConsolePassword']]


def install(root, env):
    # Shared GE-Proton provisioning copies this system loader after extracting
    # its distribution. Refuse before Steam can publish any game payload when
    # the installer image lacks the required package.
    if not VULKAN_LIBRARY.is_file():
        raise ValueError('Astroneer installer requires libvulkan1 before acquisition')
    legacy.identity('astroneer', env)
    root = Path(root).resolve()
    settings = legacy.shared.confined(root, root/'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini')
    preview = settings.read_text(encoding='utf-8-sig') if settings.exists() else ''
    legacy.helper('astroneer-rcon').owner_guid(preview, env.get('OWNER_GUID', ''))
    preview = seed(preview, SECTION, {'PublicIP': legacy.shared.text(env, 'PUBLIC_IP', '', 64)})
    legacy.shared.roles(env, [])
    allocated = [int(value) for value in env['VOLTRA_ALLOCATED_PORTS'].split(',')]
    legacy.helper('astroneer-rcon').plan(preview, allocated, allocated)
    # Existing installer preserves native config/world data during Steam update.
    legacy.install(root, 'astroneer', env)
    configure(root, env)


def run(root, env):
    root = Path(root).resolve()
    legacy.identity('astroneer', env)
    mode = legacy.engineering.choice(env, 'INSTALL_MODE', 'steam', ('steam', 'operator_files'))
    auto = legacy.engineering.choice(env, 'VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'), ('0', '1'))
    settings = legacy.shared.confined(root, root/'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini')
    preview = settings.read_text(encoding='utf-8-sig') if settings.exists() else ''
    legacy.helper('astroneer-rcon').owner_guid(preview, env.get('OWNER_GUID', ''))
    preview = seed(preview, SECTION, {'PublicIP': legacy.shared.text(env, 'PUBLIC_IP', '', 64)})
    legacy.shared.roles(env, [])
    allocated = [int(value) for value in env['VOLTRA_ALLOCATED_PORTS'].split(',')]
    legacy.helper('astroneer-rcon').plan(preview, allocated, allocated)
    if auto == '1': install(root, env)
    elif mode == 'operator_files': legacy.operator_files(root, 'astroneer')
    passwords = configure(root, env)
    environment = dict(os.environ)
    environment.update(HOME=str(root), WINEDEBUG='-all')
    for key, relative in {'STEAM_COMPAT_CLIENT_INSTALL_PATH': '.steam/steam',
                          'STEAM_COMPAT_DATA_PATH': '.steam/steam/steamapps/compatdata/728470'}.items():
        target = legacy.shared.confined(root, root/relative)
        target.mkdir(parents=True, exist_ok=True); environment[key] = str(target)
    environment.update(PROTON_LOG=legacy.engineering.choice(env, 'PROTON_LOG', '1', ('0', '1')),
                       PROTON_LOG_DIR=str(root), LD_LIBRARY_PATH=str(root/'.voltra/proton/lib')+':'+str(root/'.steam/sdk64'))
    for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS', 'PYTHONPATH', 'PYTHONHOME', 'LD_PRELOAD', 'WINEPREFIX'):
        environment.pop(key, None)
    passwords += [env.get(k, '') for k in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    log = legacy.shared.confined(root, root/'Astro/Saved/Logs/Astro.log')
    if log.exists():
        history = legacy.shared.confined(root, root/'.voltra/space-survival/log-history')
        history.mkdir(parents=True, exist_ok=True)
        log.rename(history/(str(legacy.time.time_ns())+'.log'))
    log.parent.mkdir(parents=True, exist_ok=True)
    finished = threading.Event()
    thread = threading.Thread(target=legacy.follow_log, args=(log, finished, passwords), daemon=True)
    thread.start()
    binary = legacy.shared.confined(root, root/legacy.PINS['astroneer']['binary'])
    argv = [str(legacy.helper('enshrouded-proton').location(root)), 'run', str(binary), '-log']
    contents = (root/'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini').read_text(encoding='utf-8-sig')
    control_helper = legacy.helper('astroneer-rcon')
    transport = control_helper.Transport(int(control_helper.scalar(contents, 'ConsolePort')), control_helper.scalar(contents, 'ConsolePassword'), legacy.shared.roles(env, [])['primary'], native_binary=binary)
    try:
        code = legacy.helper('native-console').run(root, argv, environment, 'stop', passwords,
                    terminal_input=True, stop_signal=signal.SIGINT, stop_signal_timeout=20, control_transport=transport)
        return code if code >= 0 else 128-code
    finally:
        finished.set(); thread.join(timeout=2)


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['install']: install(Path.cwd(), dict(os.environ))
        elif not sys.argv[1:]: sys.exit(run(Path.cwd(), dict(os.environ)))
        else: raise ValueError('Unknown action')
    except Exception:
        print('Astroneer setup failed; review native files, allocations and lawful runtime prerequisites.', file=sys.stderr)
        sys.exit(1)
