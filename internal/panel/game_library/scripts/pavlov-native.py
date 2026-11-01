"""Pavlov-only native authority and conservative scalar parser. No acquisition on import."""
import os
from pathlib import Path
import re
import signal
import sys
import importlib.util


def load():
    path = Path(__file__).with_name('vr_tower_ohd.py')
    if not path.exists():
        path = path.with_name('vr-tower-ohd.py')
    spec = importlib.util.spec_from_file_location('pavlov_base', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = load()
GAME = 'Pavlov/Saved/Config/LinuxServer/Game.ini'
RCON = 'Pavlov/Saved/Config/RconSettings.txt'
SECTION = '/script/pavlov.dedicatedserver'


def scalar(content, key, section=None, replacement=None):
    """Refuse ambiguous managed syntax; preserve all unrelated bytes as text."""
    if '\x00' in content or '\r' in content.replace('\r\n', ''):
        raise ValueError('Unsupported Pavlov config encoding or line endings')
    lines = content.splitlines(keepends=True)
    active = section is None
    sections = 0
    found = []
    for index, line in enumerate(lines):
        stripped = line.strip().lstrip('\ufeff')
        if stripped.startswith((';', '#')) or not stripped:
            continue
        if stripped.startswith('['):
            match = re.fullmatch(r'\[([^\]]+)\]\s*(?:[;#].*)?', stripped)
            if not match:
                raise ValueError('Malformed Pavlov section')
            active = section is not None and match[1].casefold() == section
            if active:
                sections += 1
                if sections > 1:
                    raise ValueError('Duplicate Pavlov managed section')
            continue
        if active and re.match(r'^[+.!-]?' + re.escape(key) + r'\s*(?:=|$)', stripped, re.I):
            match = re.fullmatch(re.escape(key) + r'\s*=\s*([^\r\n]*)', stripped, re.I)
            if not match or found:
                raise ValueError('Ambiguous Pavlov managed setting')
            raw = match[1].strip()
            if raw.startswith('"'):
                if not re.fullmatch(r'"[^"\\]*"', raw):
                    raise ValueError('Ambiguous Pavlov quoted setting')
                value = raw[1:-1]
            else:
                if any(c in raw for c in '\\";#'):
                    raise ValueError('Ambiguous Pavlov scalar setting')
                value = raw
            found.append((index, value))
    if replacement is None:
        return found[0][1] if found else None
    newline = '\r\n' if '\r\n' in content else '\n'
    row = key + '=' + replacement + newline
    if found:
        index = found[0][0]
        prefix = '\ufeff' if lines[index].startswith('\ufeff') else ''
        lines[index] = prefix + row
        return ''.join(lines)
    # Avoid inserting into a different section or guessing precedence.
    if section is not None:
        if sections:
            raise ValueError('Missing managed Pavlov key in existing section; edit native file explicitly')
        return content + (newline if content and not content.endswith('\n') else '') + '[' + section + ']' + newline + row
    return content + (newline if content and not content.endswith('\n') else '') + row


def prepare(root, env):
    # Port admission precedes credentials, Steam operations and config writes.
    base.ports(env, 'pavlov')
    contents = {}
    for name in (GAME, RCON):
        path = base.confined(root, name)
        contents[name] = path.read_bytes().decode('utf-8') if path.exists() else ''
    values = dict(env)
    for name, key, variable, section, limit in ((GAME, 'ApiKey', 'API_KEY', SECTION, 64), (RCON, 'Password', 'RCON_PASSWORD', None, 20)):
        current = scalar(contents[name], key, section)
        # Existing native rows are authoritative, including invalid/empty rows.
        # Refuse unsupported credentials before writes; never replace them from env.
        if current is not None:
            base.secret({variable: current}, variable, limit)
            values[variable] = current
    selected = base.plan(root, 'pavlov', values)
    for content in contents.values():
        for match in re.finditer(r'(?mi)^\s*(?:Password|ApiKey)\s*=\s*([^\r\n]+)', content):
            selected['credentials'].extend([match[1], match[1].strip('\"')])
    updates = {
        GAME: scalar(contents[GAME], 'ApiKey', SECTION, base.quoted(values['API_KEY'])),
        RCON: scalar(contents[RCON], 'Password', replacement=values['RCON_PASSWORD'])}
    updates[RCON] = scalar(updates[RCON], 'Port', replacement=str(selected['ports']['RCON_PORT']))
    return selected, contents, updates


def configure(root, env):
    selected, before, after = prepare(root, env)
    for name in after:
        path = base.confined(root, name)
        if before[name] != after[name]:
            base.native.private_write(path, after[name])
        else:
            path.chmod(0o600)
    return selected


def install(root, env):
    prepare(root, env)
    base.steam_options(root, 'pavlov', env)
    base.install(root, 'pavlov', env)


def main():
    root = Path.cwd().resolve()
    env = dict(os.environ)
    action = sys.argv[1]
    if action == 'preflight':
        prepare(root, env)
        base.steam_options(root, 'pavlov', env)
        return 0
    if action == 'install':
        install(root, env)
        return 0
    if action != 'run':
        raise ValueError('Unknown Pavlov action')
    prepare(root, env)
    base.pavlov_libraries(root)
    if base.boolean(env, 'VOLTRA_STEAM_AUTO_UPDATE', True):
        install(root, env)
    selected = configure(root, env)
    child_env = {k: v for k, v in env.items() if k not in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH') and not any(word in k for word in ('PASSWORD', 'TOKEN', 'API_KEY', 'STEAM_PASS', 'STEAM_AUTH', 'BETAPASS'))}
    child_env['HOME'] = str(root)
    child_env['LD_LIBRARY_PATH'] = base.pavlov_libraries(root)
    return base.console.run(root, [str(selected['binary']), *selected['args']], child_env, '', credentials=selected['credentials'], ready_marker=selected['ready'], stop_signal=signal.SIGINT)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Pavlov preflight or operation failed; inspect native configuration and prerequisites. Credentials omitted.', file=sys.stderr)
        sys.exit(1)
