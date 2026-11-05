"""Guarded five-body integration; source-only evidence, no native acceptance."""
import ast, copy, difflib, hashlib, importlib.util, json, pathlib, re, shutil, subprocess, sys, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[2]
BASE=ROOT/'artifacts/game-parity-20261029'
OUT=BASE/'wave72-gta-followup-integration'
CAT=ROOT/'internal/panel/game_library/overrides.json'
sha=lambda b:hashlib.sha256(b).hexdigest()
spec=importlib.util.spec_from_file_location('w70',ROOT/'tools/runtime/wave70-reviewed-consolidation.py')
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
def main():
 OUT.mkdir(exist_ok=True)
 packet=json.loads((BASE/'wave70-reviewed-consolidation/integration-packet.json').read_bytes())
 checked=[]; drift=[]
 for name,h in packet['protected_inputs'].items():
  p=ROOT/name.replace('\\','/')
  if sha(p.read_bytes())!=h: drift.append(name)
  else: checked.append(name)
 assert all('wave71-gta-dangling-migration/' in n.replace('\\','/') for n in drift),drift
 raw=CAT.read_bytes();assert sha(raw)=='4a06588876036335855e6ed6fb762ef62986a5e1c44c2a720d76e80aac94a0d5'
 assert raw==(BASE/'wave70-reviewed-consolidation/canonical.pending.json').read_bytes()
 protected={str(p.relative_to(ROOT)):sha(p.read_bytes()) for d in BASE.iterdir() if d.is_dir() and d!=OUT for p in d.rglob('*') if p.is_file()}
 original=json.loads(raw);merged=copy.deepcopy(original);pins=[];diff=[]
 for folder,file,helper,count in [('wave71-gta-read-safety','candidate-fragments.json',None,2),('wave71-gta-dangling-migration','recipes.pending.json','.voltra/gta-install.py',3)]:
  proposals=json.loads((BASE/folder/file).read_bytes());assert len(proposals)==count
  report=(BASE/folder/'report.json').read_text()
  for recipe,profile in proposals.items():
   name=helper or ('.voltra/gtac-runtime.py' if '/gtac/' in recipe else '.voltra/ragecoop-runtime.py')
   old=w.modules(w.script(original[recipe]))[name];new=w.modules(w.script(profile))[name]
   assert sha(old.encode()) in report and sha(new.encode()) in report,(recipe,'guard')
   s=w.script(merged[recipe]);assert s.count(old)==1 and old!=new
   merged[recipe]['egg']['scripts']['installation']['script']=s.replace(old,new,1)
   pins.append(dict(recipe=recipe,helper=name,before=sha(old.encode()),after=sha(new.encode()),authority_normalized=sha((new.replace('\r\n','\n').rstrip('\n')+'\n').encode()),semantic_one_lf_trimmed=sha((new[:-1] if new.endswith('\n') else new).encode()),final_heredoc_lf=new.endswith('\n')))
   diff.extend(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile=recipe+':'+name,tofile='candidate'))
 assert len(pins)==5
 encoded=raw.decode()
 for recipe in merged:
  p=copy.deepcopy(merged[recipe]);p['egg']['scripts']['installation']['script']=w.script(original[recipe]);assert p==original[recipe]
  for name,body in w.modules(w.script(merged[recipe])).items():compile(body.encode(),name,'exec')
  if merged[recipe]!=original[recipe]:encoded=encoded.replace(json.dumps(w.script(original[recipe]),ensure_ascii=False),json.dumps(w.script(merged[recipe]),ensure_ascii=False),1)
 result=encoded.encode();assert json.loads(result)==merged
 assert sum(merged[k]==original[k] for k in merged)==231
 (OUT/'canonical.before.json').write_bytes(raw);(OUT/'canonical.pending.json').write_bytes(result)
 (OUT/'selected-helpers.diff').write_text(''.join(diff))
 (OUT/'preservation.before.json').write_text(json.dumps(protected,indent=2)+'\n')
 (OUT/'integration-packet.json').write_text(json.dumps(dict(before=sha(raw),after=sha(result),pins=pins,other_profiles_unchanged=231,metadata_unchanged=236,old_protected_checked=len(checked),old_drift=drift,drift_explanation='Wave70 owner stopped final preservation check during concurrent root strengthening of NEW wave71 dangling migration receipt. This is not a historical pass. All other protected inputs verified.',protected=protected),indent=2)+'\n')
 assert CAT.read_bytes()==raw
 if '--apply' in sys.argv:
  CAT.write_bytes(result)
  for file,old,new in [('game_settings_gtac.go','72ad0d930a8dcf841d0ada8ec65d4bda7b2a4f3be558ea165db3755d20be5b36',next(p['authority_normalized'] for p in pins if '/gtac/' in p['recipe'])),('game_settings_ragecoop.go','3639394dd8712c97b90e9f89fe37dbb1a63a1db272af80206479b614c7f14635',next(p['authority_normalized'] for p in pins if 'ragecoop' in p['recipe']))]:
   p=ROOT/'internal/panel'/file;b=p.read_bytes();assert b.count(old.encode())==1;p.write_bytes(b.replace(old.encode(),new.encode()))
 print(json.dumps(dict(after=sha(result),pins=pins)))
if __name__=='__main__':main()
