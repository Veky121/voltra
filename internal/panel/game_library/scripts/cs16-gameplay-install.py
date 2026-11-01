#!/usr/bin/env python3
"""Vanilla-only fresh-install gameplay seeding; existing servers never migrate silently."""
import os
from pathlib import Path
import goldsrc_install
import cs16_gameplay_runtime as gameplay


def install(root, env, validate=True):
    root = Path(root).resolve()
    if goldsrc_install.selection(env) != ('cs16', 'cstrike'):
        raise ValueError('This installer supports only vanilla CS16')
    fresh = not (root / 'cstrike').exists() and not (root / 'cstrike').is_symlink()
    # Validate controlled paths and any explicit migration receipt before acquisition.
    gameplay.plan(root)
    goldsrc_install.install(root, env, validate)
    if fresh and gameplay.build(root) == '15961496':
        values = gameplay.values_checked(gameplay.DEFAULTS)
        content = ('// Native gameplay settings, seeded from measured publisher defaults.\n' + ''.join(k+' '+values[k]+'\n' for k in values)).encode()
        gameplay.seed_absent(root, content)
    elif fresh:
        print('[WARN] New publisher build: retaining native gameplay defaults until measured settings are reviewed.', flush=True)


if __name__ == '__main__':
    install(Path.cwd(), os.environ)
