import os
from pathlib import Path
from cuberite_install import install
from cuberite_parity_runtime import configure, plan_configuration
root = Path.cwd().resolve()
fresh = [name for name in ('settings.ini', 'webadmin.ini') if not (root / name).exists()]
plan_configuration(root, os.environ)
install(root)
configure(root, os.environ, fresh)
