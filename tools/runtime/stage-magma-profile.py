"""Emit only the exact Magma profile; never mutate canonical overrides."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/magma-owner'
RECIPE = 'minecraft/java/magma/egg-magma.json'


def stage():
    profile = json.loads((ROOT / 'internal/panel/game_library/overrides.json').read_text(encoding='utf-8'))[RECIPE]
    script = profile['egg']['scripts']['installation']['script']
    source = (ROOT / 'internal/panel/game_library/scripts/magma-install.py').read_text(encoding='utf-8')
    old = "python3 .voltra/java_fork_install.py 'magma'"
    if script.count(old) != 1:
        raise ValueError('Canonical Magma installer changed; review integration')
    script = script.replace(old, "cat > .voltra/magma_install.py <<'VOLTRA_MAGMA_SOURCE'\n" + source + "VOLTRA_MAGMA_SOURCE\npython3 .voltra/magma_install.py")
    profile['egg']['scripts']['installation']['script'] = script
    profile['revision'] = 'magma-consent-defaults-source-v1'
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'profile.pending.json').write_text(json.dumps({RECIPE: profile}, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    stage()
