"""Stage only the exact Mohist profile; never publish or execute its installer."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/mohist-owner'
RECIPE = 'minecraft/java/mohist/egg-mohist.json'


def stage():
    profile = copy.deepcopy(json.loads((ROOT / 'internal/panel/game_library/overrides.json').read_text())[RECIPE])
    script = profile['egg']['scripts']['installation']['script']
    invocation = "python3 .voltra/java_fork_install.py 'mohist'"
    if script.count(invocation) != 1:
        raise ValueError('Canonical Mohist installer invocation changed; review integration')
    helper = (ROOT / 'tools/runtime/mohist-owner.py').read_text()
    script = script.replace(invocation, "cat > .voltra/mohist_owner.py <<'VOLTRA_MOHIST_OWNER'\n" + helper + "\nVOLTRA_MOHIST_OWNER\npython3 .voltra/mohist_owner.py")
    profile['egg']['scripts']['installation']['script'] = script
    profile['setup_steps'].append('Mohist is end-of-life; publisher downloads remain available. No substitute project is selected automatically. Explicit EULA acceptance is required. ARM64 acquisition remains unsupported by this reviewed profile.')
    profile['revision'] = 'mohist-owner-source-v1'
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'profile.pending.json').write_text(json.dumps({RECIPE: profile}, indent=2) + '\n')


if __name__ == '__main__':
    stage()
