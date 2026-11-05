"""Stage only the exact vanilla recipe; never apply canonical overrides."""
import copy
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
KEY='valheim/valheim_vanilla/egg-valheim.json'
OUT=ROOT/'artifacts/game-parity-20261029/wave48-valheim'

def stage():
    canonical=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())
    profile=copy.deepcopy(canonical[KEY])
    script=profile['egg']['scripts']['installation']['script']
    for source in ('valheim-runtime.py','valheim-vrising-install.py'):
        emitted=source.replace('-','_')
        marker=f"cat > .voltra/{emitted} <<'VOLTRA_SOURCE'\n"
        if script.count(marker)!=1:raise ValueError('Expected exactly one emitted '+emitted)
        start=script.index(marker)+len(marker);end=script.index('\nVOLTRA_SOURCE',start)
        script=script[:start]+(ROOT/'internal/panel/game_library/scripts'/source).read_text().rstrip('\n')+'\n'+script[end:]
    profile['egg']['scripts']['installation']['script']=script
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'profile.pending.json').write_text(json.dumps({KEY:profile},indent=2)+'\n')
    return profile

if __name__=='__main__':stage()
