"""Replay follow-up fixtures in a disposable WSL tree; retain every raw result."""
import hashlib,json,pathlib,shutil,subprocess,sys,tempfile,importlib.util
ROOT=pathlib.Path(__file__).resolve().parents[2];BASE=ROOT/'artifacts/game-parity-20261029';OUT=BASE/'wave72-gta-followup-integration'
def main():
 results=[]
 with tempfile.TemporaryDirectory(prefix='voltra-wave72-') as tmp:
  root=pathlib.Path(tmp)
  for name in ['wave71-gta-read-safety-run.py','wave71-gta-dangling-migration.py','wave69-gta-migration-tests.py']:
   p=root/'tools/runtime'/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/'tools/runtime'/name,p)
  for name in ['wave69-gtac-ragecoop-proof','wave69-gta-migration']:
   shutil.copytree(BASE/name,root/'artifacts/game-parity-20261029'/name)
  for name in ['wave71-gta-read-safety-run.py','wave71-gta-dangling-migration.py']:
   run=subprocess.run([sys.executable,'-B',str(root/'tools/runtime'/name)],capture_output=True,text=True,timeout=100)
   results.append(dict(driver=name,exit=run.returncode,stdout=run.stdout,stderr=run.stderr));assert run.returncode==0,results[-1]
  for folder,file in [('wave71-gta-read-safety','candidate-fragments.json'),('wave71-gta-dangling-migration','recipes.pending.json')]:
   assert json.loads((root/'artifacts/game-parity-20261029'/folder/file).read_bytes())==json.loads((BASE/folder/file).read_bytes())
   shutil.copyfile(root/'artifacts/game-parity-20261029'/folder/'report.json',OUT/(folder+'-fixture-report.json'))
  # Re-run read admission using the final wave70 writers, not the older proposal writers.
  spec=importlib.util.spec_from_file_location('w',ROOT/'tools/runtime/wave70-reviewed-consolidation.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
  final=json.loads((OUT/'canonical.pending.json').read_bytes())
  p=root/'artifacts/game-parity-20261029/wave69-gtac-ragecoop-proof/profiles.pending.json';profiles=json.loads(p.read_bytes())
  r=p.parent/'report.json';receipt=json.loads(r.read_bytes())
  for recipe,profile in profiles.items():
   old=w.modules(w.script(profile))['.voltra/gta-runtime.py'];new=w.modules(w.script(final[recipe]))['.voltra/gta-runtime.py']
   profile['egg']['scripts']['installation']['script']=w.script(profile).replace(old,new,1)
   pin=next(x for x in receipt['recipes'] if x['recipe']==recipe)
   pin['emitted_after']={pathlib.Path(n).name:hashlib.sha256(b.encode()).hexdigest() for n,b in w.modules(w.script(profile)).items()}
  p.write_text(json.dumps(profiles));r.write_text(json.dumps(receipt))
  run=subprocess.run([sys.executable,'-B',str(root/'tools/runtime/wave71-gta-read-safety-run.py')],capture_output=True,text=True,timeout=100)
  results.append(dict(driver='read admission with final writers',exit=run.returncode,stdout=run.stdout,stderr=run.stderr));assert run.returncode==0,results[-1]
  proposed=json.loads((root/'artifacts/game-parity-20261029/wave71-gta-read-safety/candidate-fragments.json').read_bytes())
  assert all(w.script(profile)==w.script(final[recipe]) for recipe,profile in proposed.items())
  shutil.copyfile(root/'artifacts/game-parity-20261029/wave71-gta-read-safety/report.json',OUT/'final-writers-read-fixture-report.json')
  # Replay retained migration cases against the final combined writer and installer.
  spec=importlib.util.spec_from_file_location('m',root/'tools/runtime/wave69-gta-migration-tests.py');m=importlib.util.module_from_spec(spec)
  source=spec.loader.get_source('m').replace("assert (r / 'missing-referent').read_bytes() == b'stale-root'","assert (r / game / config).is_symlink() and not (r / 'missing-referent').exists()")
  exec(compile(source,'retained migration','exec'),m.__dict__)
  spec=importlib.util.spec_from_file_location('w',ROOT/'tools/runtime/wave70-reviewed-consolidation.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
  final=json.loads((OUT/'canonical.pending.json').read_bytes());cases=[]
  for game,egg in [('altv','egg-alt--v.json'),('ragemp','egg-rage--m-p.json'),('samp','egg-s-a--m-p.json')]:
   recipe='gta/'+game+'/'+egg;after=w.modules(w.script(final[recipe]));before=dict(after)
   key='.voltra/gta-install.py';before[key]=after[key].replace('            if new.exists() or new.is_symlink():continue\n','')
   cases+=m.run(game,before,after)
  results.append(dict(driver='final combined migration/writer',cases=cases,exit=0))
 assert not root.exists()
 (OUT/'fixture-results.json').write_text(json.dumps(dict(results=results,temporary_tree_removed=True),indent=2)+'\n')
 print('Follow-up fixtures and final combined migration passed; temporary tree removed.')
if __name__=='__main__':main()
