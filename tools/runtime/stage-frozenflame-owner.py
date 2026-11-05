import base64, hashlib, json, re
from pathlib import Path
out=Path('artifacts/game-parity-20261029/wave30-frozenflame')
base=Path('internal/panel/game_library/scripts')
recipe='frozen_flame/egg-frozen-flame.json'
profile=json.loads(Path('internal/panel/game_library/overrides.json').read_text())[recipe]
profile['egg']['startup']='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/frozenflame_owner.py run'
script=profile['egg']['scripts']['installation']['script']
script=re.sub(r"printf '%s' '[^']+' \| base64 -d > .voltra/frozenflame_owner.py\n",'',script).replace('python3 .voltra/frozenflame_owner.py install','python3 .voltra/unreal_building.py install frozen')
marker='python3 .voltra/unreal_building.py install frozen'
assert marker in script
source=(base/'frozenflame-owner.py').read_bytes()
script=script.replace(marker,"printf '%s' '"+base64.b64encode(source).decode()+"' | base64 -d > .voltra/frozenflame_owner.py\npython3 .voltra/frozenflame_owner.py install")
profile['egg']['scripts']['installation']['script']=script
profile['revision']='frozenflame-owner-wave30-source-only'
# Preserve historical verification; source revision has not been served.
(out/'recipe-fragment.json').write_text(json.dumps({recipe:profile},indent=2)+'\n')
(out/'authority-pins.json').write_text(json.dumps({('/.voltra/'+p.name.replace('-','_')):hashlib.sha256(p.read_bytes()).hexdigest() for p in [base/n for n in ['frozenflame-owner.py','unreal-building.py','unreal-building-release.json','native-config.py','native-console.py','steam-template.py','bundle-debian-python.py']]},indent=2)+'\n')
