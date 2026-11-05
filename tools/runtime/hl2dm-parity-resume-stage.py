"""Adopt only the hash-reviewed HL2DM candidate files. No runtime mutations."""
import ast
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CANDIDATES = {
    'artifacts/game-parity-20261029/hl2dm-wave10-gameplay.py.pending': ('internal/panel/game_library/scripts/hl2dm-gameplay.py', '9d8883a0f92214f8f1ad9e5fffeb2152c7953d7cf25f7048a8214740c4133c7b'),
    'artifacts/game-parity-20261029/hl2dm-wave10-runtime.py.pending': ('internal/panel/game_library/scripts/hl2dm-runtime.py', 'f3285bc82fd9a1dc758c71288b4521348ad4c0ec7224a24bd915e7c1ab093627'),
    'internal/panel/game_settings_hl2dm.go.pending': ('internal/panel/game_settings_hl2dm.go', '386ee02191365f34b3a838b3d4f8afe60c98f386a1dc4d0653e721638c8a9749'),
    'internal/panel/game_settings_hl2dm_test.go.pending': ('internal/panel/game_settings_hl2dm_test.go', 'a7d7bf4340f85476b4bbec1c326617d75a6fc4ff27935e039135e797854590a5'),
}

def main():
    writes = []
    for source, (target, expected) in CANDIDATES.items():
        data = (ROOT/source).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Candidate changed: '+source)
        if target.endswith('.py'):
            ast.parse(data, filename=target)
        destination = ROOT/target
        if destination.exists() and destination.read_bytes() != data:
            raise ValueError('Refuse overwriting different owned source: '+target)
        writes.append((destination, data))
    for destination, data in writes:
        destination.write_bytes(data)
    print('Validated and adopted four exact HL2DM candidates; no shared files changed.')

if __name__ == '__main__':
    main()
