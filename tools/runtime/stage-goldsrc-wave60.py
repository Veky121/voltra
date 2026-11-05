"""Task-owned offline review and staging. Never writes canonical profiles."""
import json, hashlib, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave60-goldsrc-admission'
KEYS=['hlds_server/vanilla/egg-custom-h-l-d-s-engine-game.json','hlds_server/rehlds/egg-custom-re-h-l-d-s-engine-game.json']
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def stage():
 OUT.mkdir(parents=True,exist_ok=True)
 canonical=ROOT/'internal/panel/game_library/overrides.json'
 profiles=json.loads(canonical.read_text()); prior=json.loads((ROOT/'artifacts/game-parity-20261029/wave58-goldsrc_generic/recipes.pending.json').read_text())
 fragment={}; drift=[]
 for i,key in enumerate(KEYS):
  assert key in profiles and key in prior
  p=json.loads(json.dumps(prior[key])); script=p['egg']['scripts']['installation']['script']
  emitted=OUT/f'emitted-{i}'; emitted.mkdir(exist_ok=True)
  for match in list(re.finditer(r"cat > .voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE",script,re.S)):
   name,old=match.groups(); source=ROOT/'internal/panel/game_library/scripts'/name.replace('_','-')
   if source.exists():
    current=source.read_text().rstrip(); script=script.replace(match.group(0),match.group(0).replace(old,current))
    drift.append({'recipe':key,'helper':name,'changed':old!=current,'source_sha256':sha(source)})
   else: current=old
   (emitted/name).write_text(current+'\n')
  p['egg']['scripts']['installation']['script']=script
  a=json.loads(json.dumps(p));b=json.loads(json.dumps(profiles[key]))
  a['egg']['scripts']['installation']['script']='';b['egg']['scripts']['installation']['script']=''
  assert a==b, 'metadata drift'
  fragment[key]=p
 (OUT/'recipes.pending.json').write_text(json.dumps(fragment,indent=2)+'\n')
 old=json.loads((ROOT/'artifacts/game-parity-20261029/wave58-goldsrc_generic/report.json').read_text())
 report={'scope':'SOURCE ONLY; unapplied exact current helpers','native_promotion':False,'authority_claimed':False,'canonical_sha256':sha(canonical),'helper_review':drift,'recipes':old['recipes'],'env_mapping':old['env_mapping'],'boundaries':old['boundaries'],'root_integration_contract':['Apply only the two reviewed fragment keys after integration review','Installer receives same-address allocations via serverConfig; Wings publisher execution remains mocked','No native or API/browser acceptance promotion; no crash-atomic multifile publication claim'],'gaps':['Current native/gameplay/WAN acceptance pending','Wings internal install-container environment consumption not executed','No generic native schema invented'],'original_profiles':{k:{x:v for x,v in profiles[k].items() if x!='egg'} for k in KEYS}}
 for item in report['recipes']: assert len(item['checks'])==37
 (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__': stage()
