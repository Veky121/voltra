#!/usr/bin/env python3
"""DayZ-only refusal preflight using the existing pure Arma planning hooks."""
import importlib.util
import os
from pathlib import Path
import sys


def load_runtime():
    file = Path(__file__).with_name('zombie-native.py')
    if not file.exists():
        file = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/zombie-native.py'
    spec = importlib.util.spec_from_file_location('dayz_shared_zombie', file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def preflight(root, environment, shared):
    """Read only; refusal precedes shared lowercase repair and key publication."""
    root = Path(root).resolve()
    shared.existing_dayz(root, environment)
    shared.ports(environment, [('QUERY_PORT', 27016), ('RCON_PORT', 2305)])
    shared.dayz_arguments(environment)
    clients = shared.arma.mod_list(shared.text(environment, 'MODIFICATIONS'))
    servers = shared.arma.mod_list(shared.text(environment, 'SERVERMODS'))
    filename = shared.text(environment, 'MOD_FILE', 'modlist.html', 255)
    if filename:
        if '/' in filename or '\\' in filename or filename in ('.', '..'):
            raise ValueError('Launcher modlist must be a root filename')
        file = shared.confined(root, root / filename)
        if file.exists():
            if not file.is_file() or file.stat().st_size > 2 * 1024**2:
                raise ValueError('Launcher modlist must be a bounded regular file')
            parser = shared.arma.Launcher()
            parser.feed(file.read_text(encoding='utf-8-sig'))
            clients = list(dict.fromkeys(clients + parser.ids))
    repair = shared.boolean(environment, 'MODS_LOWERCASE')
    for name in dict.fromkeys(clients + servers):
        directory = shared.confined(root, root / name)
        if not directory.is_dir():
            raise ValueError('Upload the legitimate missing DayZ mod')
        for base, folders, files in os.walk(directory, followlinks=False):
            for entry in folders + files:
                file = shared.confined(root, Path(base) / entry)
                if file.is_symlink() or not (file.is_dir() or file.is_file()):
                    raise ValueError('DayZ mod links and special files are unsupported')
                if file.is_file() and file.suffix.lower() == '.bikey' and file.stat().st_size > 8 * 1024**2:
                    raise ValueError('DayZ signature key exceeds the supported bound')
        if repair:
            shared.arma.plan_lowercase_tree(directory)
            if directory.name != directory.name.lower() and directory.with_name(directory.name.lower()).exists():
                raise ValueError('DayZ lowercase root collision')
    # This catches bad ownership ledgers, operator-key conflicts and destination
    # aliases before the existing shared code can rename even one mod entry.
    shared.arma.plan_keys(root, (clients, servers, []), lowercase=repair)
    return clients, servers


def launch(root, environment, shared=None):
    shared = shared or load_runtime()
    preflight(root, environment, shared)
    return shared.run(root, 'dayz', environment)


def main():
    if sys.argv[1:] != ['run', 'dayz']:
        raise ValueError('Expected DayZ run')
    return launch(Path.cwd(), dict(os.environ))


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError):
        print('DayZ preflight failed. Review native files, mod keys and Runtime prerequisites.', file=sys.stderr)
        sys.exit(1)
