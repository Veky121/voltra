"""Stage only the exact canonical Zandronum fragment; never publish it."""
import hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave48-zandronum'
RECIPE='doom/zandronum/egg-zandronum.json'
def stage():
 canonical=ROOT/'internal/panel/game_library/overrides.json'
 profile=json.loads(canonical.read_text())[RECIPE]
 script=profile['egg']['scripts']['installation']['script']
 sources=ROOT/'internal/panel/game_library/scripts'
 emitted={}
 def refresh(m):
  name=m[1];source=sources/(name.replace('_','-'))
  if not source.is_file():raise ValueError('Unknown emitted helper '+name)
  body=source.read_text() if name in ('id_family_runtime.py','id_family_install.py') else m[0].split("<<'VOLTRA_SOURCE'\n",1)[1].rsplit('\nVOLTRA_SOURCE',1)[0];emitted[name]=hashlib.sha256(body.encode()).hexdigest()
  return "cat > .voltra/"+name+" <<'VOLTRA_SOURCE'\n"+body+"\nVOLTRA_SOURCE"
 script=re.sub(r"cat > \.voltra/([^\s]+\.py) <<'VOLTRA_SOURCE'\n.*?\nVOLTRA_SOURCE",refresh,script,flags=re.S)
 preflight="python3 - <<'VOLTRA_PREFLIGHT'\nimport sys,os\nfrom pathlib import Path\nsys.path.insert(0,'.voltra')\nfrom id_family_runtime import zandronum_preflight\nzandronum_preflight(os.environ,Path.cwd(),acquisition=True)\nVOLTRA_PREFLIGHT\n"
 marker='if [ "${GEOIP:-1}"'
 if marker not in script:raise ValueError('Missing GeoIP boundary')
 if preflight not in script:script=script.replace(marker,preflight+marker,1)
 profile['egg']['scripts']['installation']['script']=script
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'profile.pending.json').write_text(json.dumps({RECIPE:profile},indent=2)+'\n')
 (OUT/'emitted-helpers.json').write_text(json.dumps(emitted,indent=2)+'\n')
 return profile,emitted
if __name__=='__main__':stage()
