"""Stage the exact current Puck profile without altering canonical/shared bytes."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'artifacts/game-parity-20261029/puck-file-authority-source'

def stage():
    OUT.mkdir(parents=True, exist_ok=True)
    canonical = ROOT/'internal/panel/game_library/overrides.json'
    profile = json.loads(canonical.read_text())['puck/egg-puck.json']
    script = profile['egg']['scripts']['installation']['script']
    marker = 'python3 .voltra/light_games_next_install.py puck'
    assert script.count(marker) == 1
    source = (ROOT/'internal/panel/game_library/scripts/puck-file-authority.py').read_text()
    script = script.replace(marker, "cat > .voltra/puck_file_authority.py <<'VOLTRA_PUCK_AUTHORITY'\n"+source+"\nVOLTRA_PUCK_AUTHORITY\npython3 .voltra/puck_file_authority.py install")
    assert profile['egg']['startup'] == 'exec python3 .voltra/light_games_next_runtime.py puck'
    profile['egg']['startup'] = 'exec python3 .voltra/puck_file_authority.py'
    profile['egg']['scripts']['installation']['script'] = script
    profile['revision'] = 'puck-file-authority-source-v1'
    profile['verification'] = 'not_verified'
    (OUT/'profiles.fragment.json').write_text(json.dumps({'puck/egg-puck.json':profile}, indent=2)+'\n')
    return profile

if __name__ == '__main__':
    stage()
