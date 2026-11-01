"""MIT. Exact ARM64 BDS adapter; x64 publisher payload requires box64."""
import importlib.util
import os
from pathlib import Path
import platform
import re
import shutil
import sys
import tempfile


def family():
    spec = importlib.util.spec_from_file_location('bedrock_family', Path(__file__).with_name('bedrock_family.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def plan(root, env, shared):
    """Validate all controls without changing the server volume."""
    shared.require_terms('bds_arm', env)
    version = env.get('BEDROCK_VERSION', 'latest')
    if version != 'latest' and not re.fullmatch(r'[0-9]+(?:\.[0-9]+){2,3}', version):
        raise ValueError('Invalid BDS version')
    with tempfile.TemporaryDirectory() as temporary:
        shared.configure(Path(temporary), 'bds_arm', env)
        defaults = (Path(temporary) / 'server.properties').read_bytes()
    path = shared.inside(root, 'server.properties')
    content = path.read_bytes() if path.exists() else b''
    # Preserve opaque unknown bytes, comments, line endings and native authority.
    managed = dict(row.split(b'=', 1) for row in defaults.splitlines() if b'=' in row)
    allocated = {b'server-port', b'server-portv6', b'server-udp-ports'}
    seen = set()
    rows = content.splitlines(keepends=True)
    for index, row in enumerate(rows):
        prefix = b'\xef\xbb\xbf' if index == 0 and row.startswith(b'\xef\xbb\xbf') else b''
        body = row[len(prefix):]
        match = re.match(rb'^\s*([^#!\s=:]+)\s*[=:]', body)
        if not match:
            continue
        key = match[1]
        canonical = key.lower()
        if canonical not in managed:
            continue
        if canonical in seen or key != canonical or body.rstrip(b'\r\n').endswith(b'\\'):
            raise ValueError('Ambiguous managed BDS property')
        seen.add(canonical)
        if key in allocated:
            ending = b'\r\n' if row.endswith(b'\r\n') else b'\n' if row.endswith(b'\n') else b''
            rows[index] = prefix + key + b'=' + managed[key] + ending
    missing = [key + b'=' + value for key, value in managed.items() if key not in seen]
    result = b''.join(rows)
    newline = b'\r\n' if b'\r\n' in content else b'\n'
    if missing:
        if result and not result.endswith(b'\n'):
            result += newline
        result += newline.join(missing) + newline
    return path, result


def preflight(root, env, action, shared):
    planned = plan(root, env, shared)
    if platform.system() != 'Linux' or platform.machine().lower() not in ('aarch64', 'arm64'):
        raise ValueError('Requires Linux ARM64 with x64 BDS under box64; native ARM BDS is not claimed')
    if action == 'run':
        if not shutil.which('box64'):
            raise ValueError('ARM64 runtime must provide box64 before configuration changes')
        binary = shared.inside(root, 'bedrock_server')
        with binary.open('rb') as source:
            header = source.read(20)
        if len(header) < 20 or header[:6] != b'\x7fELF\x02\x01' or int.from_bytes(header[18:20], 'little') != 62:
            raise ValueError('Expected publisher Linux x86_64 ELF for box64')
    return planned


def main(action, root, env):
    shared = family()
    path, content = preflight(root, env, action, shared)
    if action == 'install':
        return shared.install(root, 'bds_arm', env)
    if action != 'run':
        raise ValueError('Unknown ARM BDS operation')
    shared.write(path, content)
    # Reuse console supervision and raw exit status; do not overwrite native settings.
    original = shared.configure
    try:
        shared.configure = lambda *_: int(env.get('SERVER_PORT', '19132'))
        return shared.launch(root, 'bds_arm', env)
    finally:
        shared.configure = original


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], Path.cwd().resolve(), os.environ))

