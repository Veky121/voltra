"""OpenRCT2-only unapplied profile. No acquisition or canonical writes."""
import hashlib
import json
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave39-openrct2-repair'
SCRIPTS=ROOT/'internal/panel/game_library/scripts'
def stage():
    profile=json.loads((SCRIPTS.parent/'overrides.json').read_text(encoding='utf-8'))['openrct2/egg-openrct2.json']
    script=profile['egg']['scripts']['installation']['script']
    names=[]
    def replace(match):
        name=match[1];source_name='steam-template.py' if name=='steam_template.py' else name
        source=SCRIPTS/source_name
        if not source.is_file():raise ValueError('Unknown emitted helper '+name)
        names.append(name)
        return "cat > .voltra/"+name+" <<'VOLTRA_SOURCE'\n"+source.read_text(encoding='utf-8').rstrip()+"\nVOLTRA_SOURCE"
    script=re.sub(r"cat > \.voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE",replace,script,flags=re.S)
    assert len(names)==len(set(names)) and {'small-native-install.py','small-native-runtime.py','openrct2-runtime.py','native-config.py'}.issubset(names)
    profile['egg']['scripts']['installation']['script']=script
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'profile.unapplied.json').write_text(json.dumps({'openrct2/egg-openrct2.json':profile},indent=2)+'\n',encoding='utf-8')
    return profile,names
if __name__=='__main__':stage()
