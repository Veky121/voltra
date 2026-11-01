"""Nova-Life-only native-file authority. MIT. No native acceptance claimed."""
import os
from pathlib import Path
import sys
import sandbox_servers as shared

_original_nova = shared.nova
_original_install = shared.install


def nova(root, env):
    # Validate original controls and path rules before any mutation.
    updates, argv, credentials, marker = _original_nova(root, env)
    path, seeded = updates[0]
    if path.exists():
        native = shared.read_json(path)  # Reject duplicates/nonfinite/malformed input.
        primary, selected = shared.ports(env)
        if native.get('serverPort') != primary:
            raise ValueError('Native serverPort differs from selected primary allocation; reconcile while stopped')
        for key, variable in (('queryPort', 'QUERY_PORT'), ('steamPort', 'STEAM_PORT')):
            if env.get(variable) and str(native.get(key, '')) != str(env[variable]):
                raise ValueError('Explicit listener differs from native file; reconcile while stopped')
        # No serialization and no chmod of operator files, even on a no-op start.
        updates = []
        credentials = shared.secrets(native)
    # Unity stdout avoids following overlapping Player.log and stdout streams.
    return updates, [*argv, '-logFile', '-'], credentials, marker


def install(root, game, env, validate=True):
    if game != 'nova':
        raise ValueError('Nova-only adapter')
    # Automatic updates must use the same prerequisite validation as installation.
    return _original_install(root, game, env, validate=True)


def main():
    if len(sys.argv) != 3 or sys.argv[1] != 'nova' or sys.argv[2] not in ('run', 'install'):
        raise ValueError('Expected nova run or nova install')
    shared.nova = nova
    shared.install = install
    return shared.main()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Nova-Life operation refused or failed. Check native configuration, selected allocations and acquisition prerequisites. Operator files retained; no readiness implied.', file=sys.stderr)
        sys.exit(1)
