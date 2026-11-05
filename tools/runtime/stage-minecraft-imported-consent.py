"""Repeatable exact-profile proposal; never writes canonical overrides."""
import copy, json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/minecraft-imported-consent'
SPECS=[('magma','egg-magma.json','internal/panel/game_library/scripts/magma-install.py','magma_install.py'),('mohist','egg-mohist.json','tools/runtime/mohist-owner.py','mohist_owner.py'),('spongeforge','egg-sponge-forge.json','internal/panel/game_library/scripts/spongeforge-install.py','spongeforge_install.py')]
def stage():
 profiles=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())
 result={}
 for kind,filename,source,module in SPECS:
  recipe=f'minecraft/java/{kind}/{filename}'
  profile=copy.deepcopy(profiles[recipe]); script=profile['egg']['scripts']['installation']['script']
  body=(ROOT/source).read_text(); boundary=f"python3 .voltra/java_fork_install.py '{kind}'"
  block=f"cat > .voltra/{module} <<'VOLTRA_IMPORTED_CONSENT'\n{body}\nVOLTRA_IMPORTED_CONSENT\npython3 .voltra/{module}"
  if boundary in script:
   assert script.count(boundary)==1
   script=script.replace(boundary,block)
  else:
   pattern=r"cat > \.voltra/"+re.escape(module)+r" <<'([^']+)'\n.*?\n\1\npython3 \.voltra/"+re.escape(module)
   script,n=re.subn(pattern,lambda _:block,script,flags=re.S);assert n==1,'installer drift'
  profile['egg']['scripts']['installation']['script']=script
  variables=profile['egg']['variables']
  consent={'name':'Accept Minecraft EULA','description':'Explicit consent to https://www.minecraft.net/eula before acquisition. Existing operator eula.txt is preserved; eula=false still prevents native startup. Disable to revoke installer consent.','env_variable':'EULA_ACCEPTED','default_value':'false','user_viewable':True,'user_editable':True,'rules':'required|in:true,false'}
  matches=[v for v in variables if v['env_variable']=='EULA_ACCEPTED']
  if matches: assert matches==[consent], 'consent metadata drift'
  else: variables.append(consent)
  if kind=='spongeforge':
   # Modern Forge uses launcher argument files; Java8 needs the reviewed
   # direct-JAR fallback. Reuse the existing Java memory contract for both.
   java=profile['egg'].setdefault('voltra',{}).setdefault('java_config',{})
   java.update(enabled=True,memory_mode='argfile',args_file='user_jvm_args.txt',
               legacy_startup='java -jar "{{SERVER_JARFILE}}" nogui')
  profile['revision']='imported-minecraft-explicit-consent-v1'
  result[recipe]=profile
 OUT.mkdir(exist_ok=True)
 (OUT/'profiles.pending.json').write_text(json.dumps(result,indent=2)+'\n')
 return result
if __name__=='__main__':stage()
