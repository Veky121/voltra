"""Six reviewed recipes only. Fresh outputs, surgical canonical publication, no runtime."""
import copy, hashlib, json, re, sys, difflib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'artifacts/game-parity-20261029'
CANON=ROOT/'internal/panel/game_library/overrides.json'
FRAGMENTS=['wave60-goldsrc-admission/recipes.pending.json','wave60-nuclear/recipe-fragment.unapplied.json','wave60-solace/profiles.json','wave60-starmade/final/recipe-fragment.json','wave60-nzportable/recipe-fragment.json']
def sha(b):return hashlib.sha256(b).hexdigest()
def stage(current):
 result={}
 for name in FRAGMENTS:
  for key,candidate in json.loads((BASE/name).read_text()).items():
   value=copy.deepcopy(current[key])
   value['egg']['scripts']['installation']['script']=candidate['egg']['scripts']['installation']['script']
   result[key]=value
 assert len(result)==6
 return result
def main():
 out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=False)
 raw=CANON.read_bytes();current=json.loads(raw);pending=stage(current)
 assert pending==stage(current)
 (out/'canonical.before.json').write_bytes(raw)
 (out/'profiles.pending.json').write_text(json.dumps(pending,indent=2)+'\n')
 text=raw.decode();spans=[];review=[]
 for index,(key,value) in enumerate(pending.items()):
  m=re.search(r'^  '+re.escape(json.dumps(key))+r': ',text,re.M);assert m
  start=m.end();old,end=json.JSONDecoder().raw_decode(text[start:]);assert old==current[key]
  spans.append((start,start+end,json.dumps(value,indent=2,ensure_ascii=False).replace('\n','\n  ')))
  dest=out/('emitted-'+str(index));dest.mkdir()
  script=value['egg']['scripts']['installation']['script'];helpers=[]
  for name,marker,body in re.findall(r"cat > \.voltra/([^ ]+) <<'(\w+)'\n(.*?)\n\2",script,re.S):
   assert Path(name).name==name
   (dest/name).write_text(body+'\n')
   source=ROOT/'internal/panel/game_library/scripts'/name.replace('_','-')
   helpers.append({'name':name,'sha256':sha((body+'\n').encode()),'current_shared_source':str(source.relative_to(ROOT)) if source.exists() else None,'matches_current_shared':source.read_text().rstrip()==body.rstrip() if source.exists() else None,'current_shared_sha256':sha(source.read_bytes()) if source.exists() else None})
  review.append({'recipe':key,'profile_sha256':sha(json.dumps(value,separators=(',',':')).encode()),'helpers':helpers,'startup':value['egg'].get('startup')})
 for start,end,value in sorted(spans,reverse=True):text=text[:start]+value+text[end:]
 after=json.loads(text)
 assert all(after[k]==v for k,v in pending.items())
 assert all(after[k]==v for k,v in current.items() if k not in pending)
 assert stage(after)==pending
 assert CANON.read_bytes()==raw
 CANON.write_bytes(text.encode())
 (out/'canonical.diff').write_text(''.join(difflib.unified_diff(raw.decode().splitlines(True),text.splitlines(True))))
 (out/'integration.json').write_text(json.dumps({'before_sha256':sha(raw),'after_sha256':sha(text.encode()),'unrelated_profiles_preserved':len(current)-6,'unrelated_raw_bytes_preserved':True,'metadata_controls_preserved':True,'repeatable':True,'recipes':review,'candidate_hashes':{f:sha((BASE/f).read_bytes()) for f in FRAGMENTS}},indent=2)+'\n')
if __name__=='__main__':main()
