"""Wave50: six exact source scripts, no native or network operations."""
import copy,hashlib,json,pathlib,re,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave50-six-runtime-integration';OUT.mkdir(exist_ok=True)
CAT=ROOT/'internal/panel/game_library/overrides.json'
SPECS=[('valheim','stage-wave48-valheim.py','profile.pending.json'),('vrising','stage-vrising-wave48.py','profiles.pending.json'),('trackmania','stage-trackmania-wave48.mjs','profile-fragment.json'),('urbanterror','urbanterror-wave48-stage.py','overrides.pending.json'),('srb2','stage-srb2-wave48.py','profile.pending.json'),('zandronum','stage-zandronum-wave48.py','profile.pending.json')]
def run(label,args):
 p=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,timeout=180)
 (OUT/(label+'.log')).write_text(p.stdout+p.stderr)
 if p.returncode:raise RuntimeError(label+' failed, see log')
def emissions(script):return {m[1]:m[3] for m in re.finditer(r"cat > \.voltra/(\S+) <<'(\w+)'\n(.*?)\n\2",script,re.S)}
def stage(name,tool,file):
 run('stage-'+name,(['node'] if tool.endswith('.mjs') else [sys.executable,'-B'])+[str(ROOT/'tools/runtime'/tool)])
 return json.loads((ROOT/'artifacts/game-parity-20261029'/('wave48-'+name)/file).read_text())
def main():
 raw=CAT.read_bytes();(OUT/'baseline.json').write_bytes(raw);before=json.loads(raw);result=copy.deepcopy(before);records=[];failures=[]
 for name,tool,file in SPECS:
  fragment=stage(name,tool,file);key,profile=next(iter(fragment.items()));old=copy.deepcopy(before[key]);new=copy.deepcopy(profile)
  old['egg']['scripts']['installation']['script']='';new['egg']['scripts']['installation']['script']='';assert old==new,(name,'metadata drift')
  script=profile['egg']['scripts']['installation']['script'].replace('\r\n','\n');result[key]['egg']['scripts']['installation']['script']=script
  folder=OUT/name;folder.mkdir(exist_ok=True);(folder/'install.sh').write_text(script,newline='\n')
  hashes={}
  for filename,body in emissions(script).items():
   (folder/filename).write_text(body,newline='\n');hashes[filename]=hashlib.sha256(body.encode()).hexdigest()
   if filename.endswith('.py'):compile(body,filename,'exec')
   source=ROOT/'internal/panel/game_library/scripts'/filename
   if not source.exists():source=source.with_name(filename.replace('_','-'))
   if source.exists() and body.rstrip()!=source.read_text().rstrip():failures.append({'recipe':key,'helper':filename,'failure':'emitted helper differs from current shared source; preserved reviewed bytes','emitted_sha256':hashes[filename],'source_sha256':hashlib.sha256(source.read_text().encode()).hexdigest()})
  report=json.loads((ROOT/'artifacts/game-parity-20261029'/('wave48-'+name)/'report.json').read_text())
  records.append({'name':name,'recipe':key,'outcome':'source integrated','script_sha256':hashlib.sha256(script.encode()).hexdigest(),'emitted_sha256':hashes,'historical_checks':report['checks']})
 owned={r['recipe'] for r in records};assert len(before)-len(owned)==230
 assert all(before[k]==result[k] for k in before if k not in owned)
 # Replace only the six JSON string tokens, preserving all other bytes exactly.
 text=raw.decode();changes=[]
 for r in records:
  old=json.dumps(before[r['recipe']]['egg']['scripts']['installation']['script'],ensure_ascii=False)
  new=json.dumps(result[r['recipe']]['egg']['scripts']['installation']['script'],ensure_ascii=False)
  start=text.index('"'+r['recipe']+'"');idx=text.index(old,start);changes.append((idx,idx+len(old),new))
 for a,b,new in sorted(changes,reverse=True):text=text[:a]+new+text[b:]
 assert json.loads(text)==result;CAT.write_bytes(text.encode())
 # Undo replacements and demand exact original bytes.
 restored=text
 for r in records:
  old=json.dumps(before[r['recipe']]['egg']['scripts']['installation']['script'],ensure_ascii=False);new=json.dumps(result[r['recipe']]['egg']['scripts']['installation']['script'],ensure_ascii=False)
  start=restored.index('"'+r['recipe']+'"');idx=restored.index(new,start);restored=restored[:idx]+old+restored[idx+len(new):]
 assert restored.encode()==raw
 for name,tool,file in SPECS:
  fragment=stage(name,tool,file);key,p=next(iter(fragment.items()));assert p['egg']['scripts']['installation']['script'].replace('\r\n','\n')==result[key]['egg']['scripts']['installation']['script'],name+' repeat staging drift'
 report={'scope':'source only','recipes':records,'failures':failures,'other_profiles_strict_byte_comparison':230,'all_metadata_and_statuses_preserved':True,'tooling_io':'OS package bootstrap and helper emission are necessary tooling I/O. Refusal precedes game payload/world/config mutation; no no-Python-bootstrap guarantee.','cleanup':{'synthetic_fixtures':'temporary only','native_resources':'none created or accessed','operations_running':[]}}
 (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print('Integrated six scripts; strict preservation of 230 others; helper mismatches:',len(failures))
if __name__=='__main__':main()
