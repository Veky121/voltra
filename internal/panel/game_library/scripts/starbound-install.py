#!/usr/bin/env python3
"""Prerequisites run before state creation or Steam acquisition. No private bypass."""
import os
from pathlib import Path
from starbound_runtime import preflight


def install(root, env=None):
    env = dict(os.environ if env is None else env)
    root = Path(root).resolve()
    preflight(root, env)
    if env.get('STEAM_USER', '').strip().lower() in ('', 'anonymous'):
        raise ValueError('Starbound requires an entitled account through secure Steam integration')
    # This shared guard currently refuses private credentials. Keep that boundary
    # before the legacy installer's mkdir, downloads or publication.
    from steam_template import arguments
    arguments(root, 211820, env, validate=env.get('VALIDATE', 'false') == 'true')
    from stationeers_wurm_starbound_install import install as native_install
    return native_install(root, 'starbound', env)


if __name__ == '__main__':
    install(Path.cwd())
