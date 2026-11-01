"""Scoped AAPG preflight; retain the accepted native launch and update path."""
from pathlib import Path
import os
from tactical_next_runtime import main as tactical_main


def preflight(env):
    if env.get('VOLTRA_TACTICAL_NEXT') != 'aapg':
        raise ValueError('AAPG launcher requires its exact tactical selection')
    # The native engine reparses the quoted operand. Do not permit a quote or
    # backslash to escape that operand; run before AUTO_UPDATE can mutate disk.
    name = env.get('SERVER_NAME', 'Dedicated server')
    if any(c in name for c in ('"', '\\', '\r', '\n', '\x00')):
        raise ValueError('AAPG server name contains unsupported engine quoting')
    if not name or len(name) > 100:
        raise ValueError('AAPG server name must contain 1 to 100 characters')


def main(root, env):
    preflight(env)
    return tactical_main(root, env)


if __name__ == '__main__':
    raise SystemExit(main(Path.cwd(), dict(os.environ)))
