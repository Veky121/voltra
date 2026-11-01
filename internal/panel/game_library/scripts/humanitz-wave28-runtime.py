#!/usr/bin/env python3
"""HumanitZ native-file authority. Uses emitted shared installer and console ABI."""
import os
from pathlib import Path
import configparser
from unreal_survival_install import metadata, confined, install
from unreal_survival_runtime import configure as seed
from native_console import run

def configure(root, environment):
    root = Path(root).resolve()
    info = metadata()['humanitz']
    env = {**info['defaults'], **environment}
    ports = [int(env['SERVER_PORT']), int(env['QUERY_PORT'])]
    allocated = {int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if p}
    if len(set(ports)) != 2 or any(p not in allocated or not 1 <= p <= 65535 for p in ports):
        raise ValueError('Choose distinct allocated native service ports')
    candidates = [p for p in info['binaries'] if confined(root, p).is_file()]
    if len(candidates) != 1:
        raise ValueError('Expected exactly one supported HumanitZ layout')
    layout = candidates[0].split('/')[0]
    target = confined(root, layout + '/GameServerSettings.ini')
    if not target.exists():
        # Shared accepted seed handles the modern publisher alias, once only.
        seed(root, 'humanitz', env)
    if not target.is_file() or target.stat().st_size > 8*1024*1024:
        raise ValueError('Invalid native configuration')
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    parser.read_string(target.read_bytes().decode('utf-8-sig'))
    # Native secrets must also be redacted when environment values are stale.
    secrets = [env.get(k, '') for k in ('PASSWORD','ADMIN_PASS','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    secrets += [parser.get('Host Settings', k, fallback='') for k in ('Password','AdminPass')]
    child = dict(os.environ)
    for k in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH'):
        child.pop(k, None)
    child.update(HOME=str(root), LD_LIBRARY_PATH=str(root/'.steam/sdk64'))
    # ServerName is native-file owned; only allocation ports remain CLI managed.
    argv = [str(root/candidates[0]), layout, '-log', '-stdout', '-FullStdOutLogOutput',
            '-port='+str(ports[0]), '-queryport='+str(ports[1])]
    return argv, child, secrets

def main():
    root = Path.cwd()
    env = dict(os.environ)
    # Refuse invalid allocations/layout/config before update can alter files.
    argv, child, secrets = configure(root, env)
    if env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','0')) == '1':
        install(root, 'humanitz', env)
        argv, child, secrets = configure(root, env)
    return run(root, argv, child, '\x03', credentials=secrets,
               ready_marker=b'Success => Session created!', terminal_input=True)

if __name__ == '__main__':
    raise SystemExit(main())
