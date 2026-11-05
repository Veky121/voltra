"""SRB2-only unapplied canonical fragment. No runtime or acquisition."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
RECIPE='sonic_robo_blast_2/egg-sonic-robo-blast2.json'
OUT=ROOT/'artifacts/game-parity-20261029/wave48-srb2'

def stage():
    canonical=ROOT/'internal/panel/game_library/overrides.json'
    profile=json.loads(canonical.read_text(encoding='utf-8-sig'))[RECIPE]
    script=profile['egg']['scripts']['installation']['script']
    marker="cat > .voltra/sonic_rimworld.py <<'VOLTRA_SOURCE'\n"
    start=script.index(marker)+len(marker)
    end=script.index('\nVOLTRA_SOURCE',start)
    helper=(ROOT/'internal/panel/game_library/scripts/sonic-rimworld.py').read_text()
    script=script[:start]+helper+script[end:]
    profile['egg']['scripts']['installation']['script']=script
    OUT.mkdir(exist_ok=True)
    (OUT/'profile.pending.json').write_text(json.dumps({RECIPE:profile},indent=2)+'\n')
    return profile

if __name__=='__main__':stage()
