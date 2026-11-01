#!/usr/bin/env python3
"""DayZ-only refusal preflight using the existing pure Arma planning hooks."""
import importlib.util
import os
import re
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


def mission_templates(content):
    """Read active Missions child templates without rewriting native CFG bytes."""
    tokens = []
    pattern = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:""|[^"])*"|[A-Za-z_][A-Za-z0-9_]*|[^\s]')
    for match in pattern.finditer(content):
        token = match[0]
        if not token.startswith(('//', '/*')):
            tokens.append(token)
    scopes, templates, seen = [], [], set()
    pending = None
    for i, token in enumerate(tokens):
        if token == 'class' and i + 1 < len(tokens):
            pending = tokens[i + 1]
        elif token == '{':
            scopes.append(pending); pending = None
        elif token == '}':
            if scopes: scopes.pop()
        elif token == ';':
            pending = None
        elif token == 'template' and len(scopes) == 2 and scopes[0] == 'Missions' and scopes[1]:
            scope = tuple(scopes)
            if scope in seen:
                raise ValueError('Duplicate DayZ mission template')
            seen.add(scope)
            if i + 3 >= len(tokens) or tokens[i + 1] != '=' or tokens[i + 3] != ';':
                raise ValueError('Mission template must be a literal string')
            literal = tokens[i + 2]
            if not re.fullmatch(r'"[A-Za-z0-9_.-]+"', literal):
                raise ValueError('Invalid mission template name')
            name = literal[1:-1]
            if name in ('.', '..'): raise ValueError('Invalid mission template name')
            templates.append(name)
    if not templates:
        raise ValueError('DayZ config must select an uploaded mission template')
    return templates


def existing_dayz(root, environment, shared):
    shared.dayz_gate(environment)
    if environment.get('SERVER_BINARY', 'DayZServer') != 'DayZServer':
        raise ValueError('Original DayZ Linux executable is required')
    binary = shared.confined(root, root / 'DayZServer')
    with binary.open('rb') as stream:
        if stream.read(6) != b'\x7fELF\x02\x01':
            raise ValueError('Uploaded DayZServer must be a little-endian Linux64 ELF')
    config = shared.confined(root, root / 'serverDZ.cfg')
    if not config.is_file() or config.stat().st_size > 8 * 1024**2:
        raise ValueError('Upload bounded native serverDZ.cfg')
    content = config.read_text(encoding='utf-8-sig')
    shared.arma.patch_cfg(content, {})
    for name in mission_templates(content):
        mission = shared.confined(root, root / 'mpmissions' / name)
        if not mission.is_dir() or not shared.confined(root, mission / 'init.c').is_file():
            raise ValueError('Missing uploaded mission init.c')
    return content


def preflight(root, environment, shared):
    """Read only; refusal precedes shared lowercase repair and key publication."""
    root = Path(root).resolve()
    existing_dayz(root, environment, shared)
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
    original = shared.existing_dayz
    shared.existing_dayz = lambda path, env: existing_dayz(path, env, shared)
    try:
        return shared.run(root, 'dayz', environment)
    finally:
        shared.existing_dayz = original


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
