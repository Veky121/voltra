#!/usr/bin/env python3
"""MIT. Shared typed Steam installs and operator configuration preservation."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import time
from steam_template import update
from additional_survival_install import private_bytes


def dotnet_module():
    spec=importlib.util.spec_from_file_location('managed_runtime',Path(__file__).with_name('among-us-install.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def install(root, game, env=None, validate=True):
    root=Path(root).resolve();env=dict(os.environ if env is None else env)
    if game not in ('cryofall','avorion'):
        raise ValueError('Unknown reviewed game')
    app=1061710 if game=='cryofall' else 565060
    required=('Binaries/Server/CryoFall_Server.dll',) if game=='cryofall' else ('bin/AvorionServer',)
    patterns=['Data/SettingsServer.xml','Data/ServerRates.config','Data/ModsConfig.xml','Data/ServerIcon.png'] if game=='cryofall' else ['galaxy/*/server.ini','galaxy/*/admin.xml','galaxy/*/modconfig.lua']
    previous={}
    for pattern in patterns:
        for path in root.glob(pattern):
            if path.is_symlink() or not path.resolve().is_relative_to(root) or not path.is_file() or path.stat().st_size>16*1024**2:
                raise ValueError('Native configuration is not a bounded confined file')
            previous[path]=(path.read_bytes(),path.stat())
            private_bytes(root/'.voltra'/game/'publisher-backups'/(str(time.time_ns())+'-'+path.name),previous[path][0])
    try:
        receipt=update(root,app,env=env,validate=validate,required=required,platform='linux')
        if game=='cryofall':
            managed=dotnet_module()
            # Recorded only after checking this public archive against the
            # Microsoft SHA512 already pinned by the shared provisioner.
            identity={**managed.LEGACY_DOTNET['6'],
                      'sha256':'e269fa26930f08c6df920969a4e6c36138372115e193db3cccbbaa06f61e15be',
                      'bytes':39884693,'prefix':None}
            managed.runtime(root,identity,'dotnet-6','dotnet')
            subprocess.run([str(root/'.voltra/dotnet-6/dotnet'),'--list-runtimes'],check=True)
        return receipt
    finally:
        for path,(content,metadata) in previous.items():
            private_bytes(path,content,metadata)


if __name__=='__main__':
    install(Path.cwd(),sys.argv[1])
