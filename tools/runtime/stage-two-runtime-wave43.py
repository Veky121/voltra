"""Scoped source-only integration. Does not acquire or run game payloads."""
import copy, hashlib, json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
S=ROOT/'internal/panel/game_library/scripts'
CANON=S.parent/'overrides.json'
OUT=ROOT/'artifacts/game-parity-20261029/wave43-two-runtime-integration'
MODULES={
 'openrct2/egg-openrct2.json':('VOLTRA_SOURCE',{'small-native-runtime.py':'small-native-runtime.py','small-native-install.py':'small-native-install.py'}),
 'necesse/egg-necesse.json':('VOLTRA_JAVA_SOURCE',{'java_games_runtime.py':'java-games-runtime.py','java_games_install.py':'java-games-install.py'})}
def digest(b):return hashlib.sha256(b).hexdigest()
def stage(before):
 result=copy.deepcopy(before)
 for key,(tag,modules) in MODULES.items():
  script=result[key]['egg']['scripts']['installation']['script']
  for target,source in modules.items():
   pattern=r"(cat > \.voltra/"+re.escape(target)+r" <<'"+tag+r"'\n)(.*?)(\n"+tag+r"(?=\n|$))"
   body=(S/source).read_text(encoding='utf-8').rstrip('\n')
   script,count=re.subn(pattern,lambda m:m[1]+body+m[3],script,flags=re.S)
   if count!=1:raise ValueError((key,target,count))
  result[key]['egg']['scripts']['installation']['script']=script
 return result
if __name__=='__main__':
 OUT.mkdir(parents=True,exist_ok=True)
 raw=CANON.read_bytes();before=json.loads(raw)
 (OUT/'before.json').write_bytes(raw)
 after=stage(before)
 assert stage(after)==after
 assert {k for k in before if before[k]!=after[k]}==set(MODULES)
 for key in MODULES:
  p=copy.deepcopy(after[key]);p['egg']['scripts']=before[key]['egg']['scripts'];assert p==before[key]
 (OUT/'profiles.json').write_text(json.dumps({k:after[k] for k in MODULES},indent=2)+'\n',encoding='utf-8')
 # Preserve canonical formatting and all bytes outside the two recipe values.
 text=raw.decode('utf-8')
 decoder=json.JSONDecoder()
 for key in MODULES:
  match=re.search(r'"'+re.escape(key)+r'"\s*:\s*',text)
  start=match.end();_,length=decoder.raw_decode(text[start:])
  text=text[:start]+json.dumps(after[key],ensure_ascii=False,indent=2)+text[start+length:]
 assert json.loads(text)==after
 CANON.write_bytes(text.encode('utf-8'))
 print('Integrated only',list(MODULES),'profiles',len(before),'other unchanged',len(before)-2)
