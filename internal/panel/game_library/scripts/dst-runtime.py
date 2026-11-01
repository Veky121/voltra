#!/usr/bin/env python3
"""MIT. Run both native DST shards against their persistent cluster directory."""
import os
from pathlib import Path
from dst_config import configure
from dst_install import BINARY, update_game
from native_shards import run


def launch(root, env):
    root = Path(root).resolve()
    binary = root / BINARY
    if not binary.is_file():raise ValueError('Install the native DST server first')
    configuration = configure(root, env)
    child_env = dict(env)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD'):child_env.pop(key, None)
    child_env['LD_LIBRARY_PATH'] = str(root / 'bin64/lib64')
    shared = [str(binary), '-bind_ip', '0.0.0.0', '-persistent_storage_root', str(root / 'DoNotStarveTogether'),
              '-conf_dir', 'config', '-cluster', configuration['identity'], '-console']
    specs = [{'name':name,'argv':[*shared,'-shard',name,'-port',str(configuration['ports'][index])],
              'ready':(b'[Shard] Secondary Caves(2) ready!' if name == 'Master' else b'[Shard] secondary shard LUA is now ready!'),
              'failed':(b'[Error] Server failed to start!',b'error calling PrefabPostInit:')}
             for index,name in enumerate(('Master','Caves'))]
    credentials = configuration['credentials'] + [env.get(key,'') for key in ('CLUSTER_PASSWORD','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    return specs, child_env, credentials


def main(root, env):
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0'))
    if automatic not in ('0','1'):raise ValueError('AUTO_UPDATE must be 0 or 1')
    configure(root, env, dry_run=True)
    if automatic == '1':update_game(root, validate=False)
    specs, environment, credentials = launch(root, env)
    return run(Path(root) / 'bin64', specs, environment, 'c_shutdown()',
                         credentials,
                         ready_message='VOLTRA_DST_READY')


if __name__ == '__main__':
    raise SystemExit(main(Path.cwd(), dict(os.environ)))
