#!/usr/bin/env python3
"""RedM scoped native-file authority and pre-acquisition validation."""
import os
from pathlib import Path
import shlex
import sys
import tempfile
import importlib.util

def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

def prepare(root, env):
    root = root.resolve()
    cfg = root / 'server.cfg'
    if cfg.is_symlink() or (cfg.exists() and not cfg.is_file()):
        raise ValueError('RedM server.cfg must be a regular native file')
    for name in ('.voltra', 'fivem', 'resources'):
        if not (root / name).resolve().is_relative_to(root):
            raise ValueError('RedM state escapes owned volume')
    raw = cfg.read_bytes().decode('utf-8') if cfg.exists() else ''
    parser = module('fivem-cfg')
    effective = dict(env)
    # This variant cannot be switched to another game or txAdmin launcher.
    effective.update(VOLTRA_CFX_GAME='redm', TXHOST_GAME_NAME='redm', TXADMIN_ENABLE='0')
    mapping = {'sv_hostname': 'SERVER_HOSTNAME', 'sv_maxclients': 'MAX_PLAYERS',
               'sv_maxplayers': 'MAX_PLAYERS', 'sv_licensekey': 'CFX_LICENSE',
               'steam_webapikey': 'STEAM_WEBAPIKEY', 'sv_lan': 'LAN_ONLY'}
    effective.pop('FIVEM_LICENSE', None)
    effective.pop('FIVEM_VERSION', None)
    for line, key, token in parser.parse(raw):
        if key == 'gamename' and shlex.split(token[0]) != ['rdr3']:
            raise ValueError('Native game differs from RedM; use Files for review')
        if key in mapping:
            value = shlex.split(token[0])[0]
            if key == 'sv_lan':
                if value not in ('true', 'false', '0', '1'):
                    raise ValueError('Invalid native sv_lan')
                value = '1' if value in ('true', '1') else '0'
            effective[mapping[key]] = value
    # Run shared validation in a disposable directory, never the operator volume.
    with tempfile.TemporaryDirectory(prefix='voltra-redm-preflight-') as tmp:
        scratch = Path(tmp)
        (scratch / 'server.cfg').write_bytes(raw.encode('utf-8'))
        module('fivem-runtime').configure(scratch, effective)
        content = (scratch / 'server.cfg').read_bytes()
    return effective, content

def install(root, env):
    effective, _ = prepare(root, env)
    version = effective.get('CFX_VERSION', '')
    # identity() can perform network access, so reject missing digest first.
    if (version != '35245' or effective.get('DOWNLOAD_URL')):
        import re
        if not re.fullmatch('[a-fA-F0-9]{64}', effective.get('FIVEM_RELEASE_SHA256', '')):
            raise ValueError('Review FIVEM_RELEASE_SHA256 before acquisition of latest/custom builds')
    return module('fivem-install').install(root, effective)

def run(root, env):
    effective, content = prepare(root, env)
    module('gta-runtime').write_config(root, root / 'server.cfg', content.decode('utf-8'))
    return module('fivem-runtime').run(root, effective)

if __name__ == '__main__':
    root = Path(os.environ.get('VOLTRA_SERVER_ROOT', '/mnt/server' if sys.argv[1:] == ['install'] else '/home/container')).resolve()
    sys.exit(install(root, os.environ) if sys.argv[1:] == ['install'] else run(root, os.environ))
