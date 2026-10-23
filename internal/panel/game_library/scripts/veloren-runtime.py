# SPDX-License-Identifier: MIT
"""Native RON settings and a supervised, line-oriented Veloren server process."""
import json
import os
import signal
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit


def integer(env, key, minimum, maximum):
    value = env.get(key, '')
    if not value.isascii() or not value.isdigit() or not minimum <= int(value) <= maximum:
        raise ValueError('Invalid ' + key)
    return int(value)


def flag(env, key):
    if env.get(key) not in ('0', '1'):
        raise ValueError(key + ' must be 0 or 1')
    return env[key] == '1'


def change(kind, value):
    return dict(kind=kind, value=value)


def managed_settings(env):
    game_port = integer(env, 'SERVER_PORT', 1, 65535)
    name = env.get('SERVER_NAME', '')
    if not name.strip() or len(name) > 64 or any(c in name for c in '\r\n\x00'):
        raise ValueError('Choose a single-line SERVER_NAME of at most 64 characters')
    game = dict(server_name=change('string', name),
                max_players=change('integer', integer(env, 'MAX_PLAYERS', 1, 65535)))
    mode = env.get('AUTH_MODE')
    if mode not in ('official', 'offline'):
        raise ValueError('AUTH_MODE must be official or offline')
    authentication = env.get('AUTH_SERVER_URL', 'https://auth.veloren.net')
    if mode == 'official':
        url = urlsplit(authentication)
        if url.scheme != 'https' or not url.hostname or url.username or url.password or any(c in authentication for c in '\r\n\x00'):
            raise ValueError('AUTH_SERVER_URL must be an HTTPS address without credentials')
    game['auth_server_address'] = change('option_string', authentication if mode == 'official' else None)
    cli = dict(update_shutdown_grace_period_secs=change('integer', 5),
               shutdown_signals=change('raw', '[SIGUSR1, SIGTERM]'))
    if flag(env, 'MANAGE_NETWORK'):
        allocated = set()
        try:
            allocated = {int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if p}
        except ValueError:
            raise ValueError('The allocated port list is invalid') from None
        if game_port not in allocated:
            raise ValueError('The primary game port must be an actual allocation')
        game['gameserver_protocols'] = change('raw', '[Tcp(address: "0.0.0.0:' + str(game_port) + '")]')
        query_port = integer(env, 'QUERY_PORT', 0, 65535) or game_port
        query_enabled = flag(env, 'QUERY_ENABLED')
        if query_enabled and query_port not in allocated:
            raise ValueError('QUERY_PORT must be allocated to this server')
        game['query_address'] = change('option_string', '0.0.0.0:' + str(query_port) if query_enabled else None)
        metrics_port = integer(env, 'METRICS_PORT', 1, 65535)
        public_metrics = flag(env, 'METRICS_PUBLIC')
        if metrics_port == game_port:
            raise ValueError('METRICS_PORT must differ from the TCP game port')
        if public_metrics and metrics_port not in allocated:
            raise ValueError('Public METRICS_PORT must be allocated to this server')
        address = ('0.0.0.0:' if public_metrics else '127.0.0.1:') + str(metrics_port)
        # Older nightlies use metrics_address; newer builds use the CLI web server.
        game['metrics_address'] = change('string', address)
        cli['web_address'] = change('string', address)
    return game, cli


def configure(root, env):
    game, cli = managed_settings(env)
    helper = root / '.voltra/voltra-ron-config'
    documents = [(root / 'userdata/server/server_config/settings.ron', game),
                 (root / 'userdata/server-cli/settings.ron', cli)]
    original = {path: path.read_bytes() if path.exists() else None for path, _ in documents}
    with tempfile.TemporaryDirectory(prefix='.veloren-validate-', dir=root / '.voltra') as temporary:
        isolated = Path(temporary) / 'userdata'
        for path, changes in documents:
            candidate = isolated / path.relative_to(root / 'userdata')
            candidate.parent.mkdir(parents=True, exist_ok=True)
            if original[path] is not None:
                candidate.write_bytes(original[path])
            subprocess.run([str(helper), str(candidate)], input=json.dumps(changes), text=True, capture_output=True, check=True)
        # This native subcommand loads both settings types, then exits before
        # constructing a game server. Its fresh administrator list is empty.
        # Offline lookup prevents external account requests. All writes stay in
        # the isolated userdata directory, never the operator's real world.
        validate_env = dict(env, VELOREN_USERDATA=str(isolated), VELOREN_ASSETS=str(root / 'assets'), RUST_LOG='info')
        result = subprocess.run([str(root / 'veloren-server-cli'), '--no-auth', 'admin', 'remove', 'VoltraConfigValidation'],
                                cwd=root, env=validate_env, stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30)
        output = result.stdout + result.stderr
        if result.returncode or fallback(output) or 'FATAL: Failed to parse' in output:
            raise ValueError('Native Veloren configuration validation failed; existing settings were not changed')
        if str(isolated) not in output:
            raise ValueError('The game did not confirm the isolated validation directory; existing settings were not changed')
        for path, _ in documents:
            current = path.read_bytes() if path.exists() else None
            if current != original[path]:
                raise ValueError('Configuration changed during validation; retry after finishing file edits')
        for path, changes in documents:
            subprocess.run([str(helper), str(path)], input=json.dumps(changes), text=True, capture_output=True, check=True)


def fallback(line):
    text = line.casefold()
    return 'failed to parse setting file' in text or 'falling back to default settings' in text


def launch(root, env):
    root = Path(root).resolve()
    configure(root, env)
    child_env = dict(env, VELOREN_USERDATA=str(root / 'userdata'),
                     VELOREN_ASSETS=str(root / 'assets'))
    child = subprocess.Popen([str(root / 'veloren-server-cli')], cwd=root, env=child_env,
                             stdin=None, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, encoding='utf-8', errors='replace', start_new_session=True)
    stopping = False

    def stop(_number, _frame):
        nonlocal stopping
        if not stopping and child.poll() is None:
            stopping = True
            child.send_signal(signal.SIGUSR1)

    previous = {s: signal.signal(s, stop) for s in (signal.SIGTERM, signal.SIGINT)}
    invalid = False
    try:
        for line in child.stdout:
            if fallback(line):
                invalid = True
                print('Veloren rejected its settings. Existing configuration and backups are retained; startup was stopped.', flush=True)
                stop(None, None)
                continue
            if not invalid:
                print(line, end='', flush=True)
        code = child.wait()
        return 1 if invalid else code
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


if __name__ == '__main__':
    try:
        raise SystemExit(launch(Path.cwd(), os.environ))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        if isinstance(error, ValueError):
            print('Veloren setup failed: ' + str(error), flush=True)
        else:
            print('Veloren setup failed. Validate native RON settings and installed files; existing backups are retained.', flush=True)
        raise SystemExit(1)
