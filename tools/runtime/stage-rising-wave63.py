import json,re,hashlib
from pathlib import Path
repo=Path(__file__).resolve().parents[2]
out=repo/'artifacts/game-parity-20261029/wave63-rising-legacy'
out.mkdir(parents=True,exist_ok=True)
key='rising_world/legacy/egg-rising-world-legacy.json'
profile=json.loads((repo/'internal/panel/game_library/overrides.json').read_text())[key]
script=profile['egg']['scripts']['installation']['script']
for source,target in [('java-games-runtime.py','java_games_runtime.py'),('java-games-install.py','java_games_install.py')]:
 content=(repo/'internal/panel/game_library/scripts'/source).read_text()
 pattern=r"(cat > .voltra/"+target+r" <<'VOLTRA_JAVA_SOURCE'\n).*?(\nVOLTRA_JAVA_SOURCE)"
 script,count=re.subn(pattern,lambda m:m[1]+content+m[2],script,flags=re.S)
 assert count==1
profile['egg']['scripts']['installation']['script']=script
(out/'recipe-fragment.json').write_text(json.dumps({key:profile},indent=2)+'\n')
