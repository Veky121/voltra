#!/usr/bin/env python3
"""ASKA-only file authority adapter; delegates install and supervision."""
import os
from pathlib import Path
import sys


def native_environment(root, environment, properties):
    """Preserve existing managed values; environment seeds absent properties."""
    root = Path(root).resolve()
    target = root / 'server properties.txt'
    if target.is_symlink() or not target.resolve().is_relative_to(root):
        raise ValueError('Native ASKA properties must remain in this volume')
    effective = dict(environment)
    if not target.exists():
        return effective
    if not target.is_file() or target.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('Invalid ASKA properties file')
    seen = set()
    aliases = {key.casefold(): key for key in properties}
    for line in target.read_text(encoding='utf-8-sig').splitlines():
        if line.lstrip().startswith(('#', ';')) or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        canonical = aliases.get(key.casefold())
        if canonical is None:
            continue
        # Publisher case-insensitivity is not established. Refuse aliases rather
        # than create a second setting with uncertain precedence.
        if key != canonical or canonical in seen:
            raise ValueError('Ambiguous ASKA property identity')
        seen.add(canonical)
        value = value.strip()
        if len(value.encode()) > 8192 or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('Invalid native ASKA setting')
        effective[properties[canonical]] = value
    return effective


def main():
    import unreal_survival_next as shared
    root = Path.cwd()
    # Resolve before shared.main's possible auto-update, so malformed native
    # settings never trigger acquisition and native credentials feed redaction.
    effective = native_environment(root, os.environ, shared.metadata()['aska']['properties'])
    old_environment = dict(os.environ)
    try:
        os.environ.clear()
        os.environ.update(effective)
        return shared.main()
    finally:
        os.environ.clear()
        os.environ.update(old_environment)


if __name__ == '__main__':
    sys.exit(main())
