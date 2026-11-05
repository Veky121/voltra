"""R5 existing-package entrypoint. No acquisition or native config rewriting."""
import importlib.util
import os
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('arena', Path(__file__).with_name('arena-native.py'))
arena = importlib.util.module_from_spec(spec)
spec.loader.exec_module(arena)

def install(root, env):
    # R5 existing-package installation has nothing to publish. Validate the
    # entire native argument/package contract without retention snapshots or
    # modifying timestamps, configs, mods, secrets or publisher binaries.
    arena.configure(root, 'r5', env)
    return {'mode': 'legitimate-operator-files', 'native_verified': False}

if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['install']:
            install(Path.cwd(), dict(os.environ))
        elif sys.argv[1:] == ['run']:
            sys.exit(arena.run(Path.cwd(), 'r5', dict(os.environ)))
        else:
            raise ValueError('Expected install or run')
    except Exception:
        # Native file decoding errors may contain secret bytes. Never echo them.
        print('R5 preflight/runtime failed; verify the operator package, allocations and native arguments.', file=sys.stderr)
        sys.exit(1)
