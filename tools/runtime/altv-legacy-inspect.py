"""Read-only inventory for retired alt:V configurations. Never launches or downloads."""
import argparse
import hashlib
import json
from pathlib import Path
import tomllib

REASON = ('alt:V has shut down. New installation and acquisition are disabled. '
          'Preserve existing operator resources and plan migration; no mirror or replacement is selected.')


def discover(root, config=None):
    root = Path(root).resolve(strict=True)
    names = [config] if config is not None else ['server.toml', 'altv/server.toml', 'srv.toml', 'altv/srv.toml']
    found = []
    for name in names:
        candidate = Path(name)
        if candidate.is_absolute() or '..' in candidate.parts or '\\' in str(name) or ':' in str(name):
            raise ValueError('Config path must be relative to the server volume')
        path = root / candidate
        # Reject links even inside the volume: inspection must not bless a writable alias.
        if any(p.is_symlink() for p in [path, *path.parents] if p != root and root in p.parents):
            raise ValueError('Config path contains a symbolic link')
        if not path.resolve().is_relative_to(root):
            raise ValueError('Config path escapes the server volume')
        if path.exists():
            if not path.is_file():
                raise ValueError('Config is not a regular file')
            found.append(path)
    if len(found) != 1:
        raise ValueError('Specify the actual --config relative path when config is absent or ambiguous')
    path = found[0]
    if path.stat().st_size > 1024 * 1024:
        raise ValueError('Config exceeds bounded inspection size')
    raw = path.read_bytes()
    # srv.toml is only a candidate, never silently migrated or presumed active.
    try:
        data = tomllib.loads(raw.decode('utf-8-sig'))
    except (ValueError, UnicodeError):
        raise ValueError('Invalid TOML; preserve original bytes and repair offline') from None
    port = data.get('port', 7788)
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError('Invalid native port')
    for key in ['modules', 'resources']:
        value = data.get(key, [])
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise ValueError('Invalid module/resource list')
    return {'path': path.relative_to(root).as_posix(), 'sha256': hashlib.sha256(raw).hexdigest(),
            'port': port, 'protocols': ['tcp', 'udp'],
            'module_count': len(data.get('modules', [])), 'resource_count': len(data.get('resources', [])),
            'active_file_verified': False, 'support': 'shutdown', 'writable': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=REASON)
    parser.add_argument('root')
    parser.add_argument('--config')
    args = parser.parse_args()
    try:
        print(json.dumps(discover(args.root, args.config)))
    except (ValueError, OSError) as error:
        # Never print TOML values, paths from OS exceptions, tokens or passwords.
        parser.exit(2, (str(error) if isinstance(error, ValueError) else 'Cannot inspect config') + '\n')
