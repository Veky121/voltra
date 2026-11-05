import hashlib,json,re,sys,types,tempfile,zipfile,subprocess,socket,urllib.request,os
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/game-parity-20261029/wave69-rehlds-admission';OUT.mkdir(parents=True,exist_ok=True)
KEY='counter_strike/counter_strike_1.6_rehlds/egg-cs 1.6-rehlds.json'
h=lambda b:hashlib.sha256(b).hexdigest()
paths=['internal/panel/game_library/overrides.json','tools/runtime/embedded-python.mjs']
paths += ['internal/panel/game_library/scripts/'+n+'.py' for n in ['goldsrc-runtime','goldsrc-install','cs16-modules-install','counterstrike-preflight','steam-template']]
snapshot={x['path']:x['sha256'] for x in json.loads((ROOT/'artifacts/game-parity-20261029/root-source-regression-wave68/source-before.json').read_text())}
before={p:h((ROOT/p).read_bytes()) for p in paths}
for p,v in before.items():
 assert p in snapshot and snapshot[p]==v,(p,'checkpoint mismatch')
cat=json.loads((ROOT/paths[0]).read_bytes());recipe=cat[KEY];egg=recipe['egg'];script=egg['scripts']['installation']['script']
pattern=r'''cat\s+>\s*(?:"([^"\r\n]+\.py)"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)'''
sources={Path(m[1] or m[2] or m[3]).stem:m[5]+'\n' for m in re.finditer(pattern,script)}
# Extract actual non-Python manifest literal, never substitute publisher facts.
m=re.search(r"cat > .voltra/cs16-modules-release.json <<'([^']+)'\n(.*?)\n\1",script,re.S);assert m
manifest=m[2];release=json.loads(manifest.lstrip(chr(65279)))
base={v['env_variable']:v['default_value'] for v in egg['variables']};base.update(SERVER_PORT='27015',VOLTRA_ALLOCATED_PORTS='27015,27016',VOLTRA_GOLDSRC_RECIPE='generic')
staged=dict(sources)
a="    root = root.resolve();owner = root.stat()\n"
b="    from counterstrike_preflight import preflight\n    import goldsrc_runtime as runtime\n    preflight('rehlds', root, env, runtime, require_payload=False)\n"
assert sources['cs16_modules_install'].count(a)==1
staged['cs16_modules_install']=sources['cs16_modules_install'].replace(a,a+b)
a="        env['VOLTRA_GOLDSRC_RECIPE'] = 'cs16' if game == 'cs16' else 'generic'\n"
b="        if game == 'rehlds':\n            from steam_template import arguments\n            arguments(root, 90, env)\n"
assert sources['counterstrike_preflight'].count(a)==1
staged['counterstrike_preflight']=sources['counterstrike_preflight'].replace(a,a+b)
for name, source in staged.items(): compile(source, name+'.py', 'exec')
class Boundary(Exception): pass
results=[]
def forbidden(*a,**k): raise AssertionError('unmocked external boundary')
def load(src):
 for name in src: sys.modules.pop(name,None)
 for name in src: sys.modules[name]=types.ModuleType(name)
 for name in ('steam_template','native_console','native_release','goldsrc_runtime','goldsrc_install','cs16_modules_install','counterstrike_preflight'):
  module=sys.modules[name];module.__file__=name+'.py';exec(compile(src[name],module.__file__,'exec'),module.__dict__)
 return sys.modules['cs16_modules_install'],sys.modules['counterstrike_preflight'],sys.modules['goldsrc_runtime']
def case(src,label,delta,startup):
 events=[]
 with tempfile.TemporaryDirectory(prefix='wave69-rehlds-') as tmp:
  root=Path(tmp);(root/'.voltra').mkdir();(root/'.voltra/cs16-modules-release.json').write_text(manifest)
  mod,wrap,runtime=load(src)
  def download(record,target):
   events.append('module_download:'+record['module'])
   with zipfile.ZipFile(target,'w') as z:
    # Only rehlds selected for positive archive path exercise.
    z.writestr('bin/linux32/hlds_linux',b'synthetic inert bytes, never executable')
  def publisher(*a,**k):events.append('publisher_install');raise Boundary()
  mod.download=download;mod.publisher_install=publisher
  sys.modules['steam_template'].update=forbidden;runtime.update=forbidden;runtime.run=forbidden;runtime.await_native_info=forbidden
  env={**base,'INSTALL_MODULES':'rehlds',**delta}
  try:
   if startup:wrap.main('rehlds',root,env,runtime=runtime,module_installer=mod)
   else:mod.install(root,env)
   outcome='unexpected completion'
  except Boundary:outcome='mock publisher boundary'
  except ValueError as e:outcome='rejected: '+str(e)
  assert not list((root/'.voltra').glob('.cs16-modules-*'))
 return dict(variant=label,path='startup-auto-update' if startup else 'installer',input=delta,events=events,outcome=outcome)
with patch('subprocess.run',forbidden),patch('subprocess.Popen',forbidden),patch('os.system',forbidden),patch('os.execv',forbidden),patch('socket.socket',forbidden),patch('urllib.request.urlopen',forbidden):
 for label,src in [('before',sources),('candidate',staged)]:
  for startup in (False,True):
   for name,delta in [('valid',{}),('invalid-slots',{'SRV_SLOTS':'0'}),('invalid-public',{'PUBLIC_SERVER':'2'}),('invalid-hostname',{'HOSTNAME':'bad;value'}),('invalid-validation',{'VALIDATE':'2'}),('invalid-steam-account',{'STEAM_USER':'synthetic-user'}),('invalid-module',{'INSTALL_MODULES':'bogus'}),('invalid-branch',{'SRCDS_BETAID':'other'})]:
    if startup:delta={**delta,'AUTO_UPDATE':'1'}
    r=case(src,label,delta,startup);r['case']=name;results.append(r)
    if name=='valid':assert r['events']==['module_download:rehlds','publisher_install'],r
    elif label=='candidate':assert not r['events'] and r['outcome'].startswith('rejected:'),r
    elif startup and name not in ('invalid-steam-account',):assert not r['events'],r
    elif name in ('invalid-module','invalid-branch'):assert not r['events'],r
    else:assert r['events'][0]=='module_download:rehlds',r
# Candidate is only a helper fragment, preserving all other script bytes and metadata.
newscript=script
for name in ('cs16_modules_install','counterstrike_preflight'):
 old=sources[name];new=staged[name];assert newscript.count(old)==1;newscript=newscript.replace(old,new)
newrecipe=json.loads(json.dumps(recipe));newrecipe['egg']['scripts']['installation']['script']=newscript
restored=json.loads(json.dumps(newrecipe));restored['egg']['scripts']['installation']['script']=script;assert restored==recipe
fragment={KEY:newrecipe}
(OUT/'candidate-fragment.json').write_text(json.dumps(fragment,indent=2)+'\n')
import difflib
(OUT/'helper-only.patch').write_text(''.join(''.join(difflib.unified_diff(sources[n].splitlines(True),staged[n].splitlines(True),fromfile=n+'.py',tofile=n+'.py')) for n in ('cs16_modules_install','counterstrike_preflight')))
after={p:h((ROOT/p).read_bytes()) for p in paths};assert before==after
report=dict(outcome='demonstrated_missing_admission_gate_candidate_staged',recipe=KEY,source_hashes_before=before,source_hashes_after=after,checkpoint_match=True,recipe_sha256=h(json.dumps(recipe,sort_keys=True).encode()),startup=egg['startup'],startup_sha256=h(egg['startup'].encode()),install_before_sha256=h(script.encode()),install_candidate_sha256=h(newscript.encode()),emitted_helpers={n:dict(before=h(v.encode()),after=h(staged[n].encode()),final_newline=v.endswith('\n')) for n,v in sources.items()},tests=results,verification_notes=['Initial harness failed while parsing actual BOM-prefixed manifest; corrected parser to accept BOM, then all cases passed. Emitted manifest bytes preserved.', 'All final emitted Python modules compiled in memory; only required caller dependency modules imported.'],passed=len(results),failures=0,skips=[],original37statuses='unchanged; status records not read, values unknown',cleanup='TemporaryDirectory fixtures removed; no real container paths, shell installer, game, account acquisition, network or process executed',candidate_adoption_contract='Root may adopt only the two helper substitutions after matching exact recipe and install before hashes. Preserve every other helper, manifest, pin, revision, metadata, startup, ordered variable/default/permission/image. This fragment is a proposal, not canonical authority.',trigger='Installer accepts invalid supported controls and downloads selected modules before publisher_install. Startup wrapper rejects controls but does not call Steam arguments admission; synthetic nonanonymous STEAM_USER reaches module download before publisher rejection.',remaining_gaps=['No current publisher facts, native ABI, payload runtime, gameplay or acceptance claim','Shell apt/python bundling not executed; module entry and startup Python caller exercised only','Publisher and game process execution intentionally blocked; positive path ends at mocked publisher boundary'])
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':len(results),'output':str(OUT),'cleanup':True}))

