"""Puck-only file authority. Shared family helpers remain unchanged."""
import os
import sys
from pathlib import Path
import light_games_next_runtime as family


def prepare(root, env):
    root = root.resolve()
    # Validate all inputs and native documents before writes or acquisition.
    port = family.integer(env.get('SERVER_PORT', ''), 1, 65535)
    query = family.integer(env.get('QUERY_PORT', '7778'), 1025, 65535)
    allocated = {family.integer(v, 1, 65535) for v in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if v}
    if port not in allocated or query not in allocated or port == query:
        raise ValueError('Puck requires distinct allocated primary and query ports')
    if env.get('PUCK_SERVER_CONFIG', ''):
        raise ValueError('Inline Puck config bypasses file authority')
    legacy_path = family.confined(root, 'server_configuration.json')
    current_path = family.confined(root, 'server_config.json')
    public_path = family.confined(root, 'public_game_mode_config.json')
    legacy = family.read_config(legacy_path)
    current = family.read_config(current_path)
    public = family.read_config(public_path)
    values = dict(port=port, pingPort=query,
        maxPlayers=family.integer(env.get('MAX_PLAYERS', '10'), 1, 32),
        password=family.text(env.get('SRV_PASSWORD', ''), 64),
        kickTimeout=family.integer(env.get('KICK_TIMEOUT', '300'), 0, 2147483647),
        targetFrameRate=family.integer(env.get('FRAME_RATE', '120'), 1, 380),
        serverTickRate=family.integer(env.get('SERVER_TICK_RATE', '100'), 1, 360),
        clientTickRate=family.integer(env.get('CLIENT_TICK_RATE', '360'), 1, 720))
    # Reuse the reviewed legacy translation only for missing native values.
    seeded = dict(legacy)
    for key, value in values.items():
        seeded.setdefault(key, value)
    defaults = family.puck_current(root, seeded, seeded)
    native_defaults = defaults[0][1]
    public_defaults = defaults[1][1]
    for key, value in current.items():
        native_defaults[key] = value
    native_defaults['port'] = port
    for key, value in public.items():
        public_defaults[key] = value
    for key, low, high in [('maxPlayers', 1, 32), ('tickRate', 1, 720)]:
        if type(native_defaults[key]) is not int:
            raise ValueError('Puck native integer required')
        family.integer(native_defaults[key], low, high)
    family.text(native_defaults['password'], 64)
    family.text(native_defaults['name'], 200)
    for key in ['isPublic', 'useVoip', 'useWhitelist']:
        if type(native_defaults[key]) is not bool:
            raise ValueError('Puck native boolean required')
    for key, low, high in [('kickTimeout', 0, 2147483647), ('targetFrameRate', 1, 380), ('serverTickRate', 1, 360), ('clientTickRate', 1, 720)]:
        if type(seeded[key]) is not int:
            raise ValueError('Puck plugin integer required')
        family.integer(seeded[key], low, high)
    # Plugin reads these controls from environment; align client cadence with native tickRate.
    seeded.update(port=port, pingPort=query, maxPlayers=native_defaults['maxPlayers'],
                  password=native_defaults['password'], clientTickRate=native_defaults['tickRate'])
    environment = {k: v for k, v in env.items() if k not in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','STEAM_PASS','STEAM_AUTH')}
    environment.update(HOME=str(root), XVFB='0', LD_LIBRARY_PATH=str(root/'linux64')+':'+str(root/'.steam/sdk64'), QUERY_PORT=str(query))
    for key, field in [('FRAME_RATE','targetFrameRate'), ('SERVER_TICK_RATE','serverTickRate'), ('CLIENT_TICK_RATE','clientTickRate'), ('KICK_TIMEOUT','kickTimeout')]:
        environment[key] = str(seeded[field])
    return [(legacy_path, seeded, 'puck'), (current_path, native_defaults, 'puck-current'), (public_path, public_defaults, 'puck-public')], environment


def install(root, env, validate=True):
    prepare(root, env)
    from light_games_next_install import install as shared_install
    return shared_install(root, 'puck', env, validate)


def main():
    root = Path.cwd().resolve()
    env = dict(os.environ)
    prepare(root, env)
    if len(sys.argv) > 1 and sys.argv[1] == 'install':
        install(root, env)
        return 0
    if family.boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0'))):
        install(root, env, False)
    documents, environment = prepare(root, env)
    family.check_puck_plugin(root)
    for path, value, label in documents:
        family.write_config(root, path, value, label)
    from puck_readiness import PuckObserver
    observer = PuckObserver(environment)
    result = family.run(root, ['/bin/bash', str(family.confined(root, 'start_server.sh')), '--serverConfigPath', str(root/'server_config.json')], environment, '\x03', credentials=[documents[1][1]['password']], ready_marker=b'is ready to accept clients on', terminal_input=True, output_observer=observer)
    if result == 0 and not observer.emitted:
        raise ValueError('Puck stopped without verified native compatibility readiness')
    return result


if __name__ == '__main__':
    sys.exit(main())
