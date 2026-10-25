"""Publisher metadata preflight only, using pinned existing VDF reader."""
import json,re,sys
from pathlib import Path
sys.path.insert(0,'/vendor')
import vdf
match=re.search(r'(?m)^"402370"\s*\n\{[\s\S]*?^\}',Path('/evidence/metadata.log').read_text())
if not match:raise ValueError('Missing target public metadata')
app=vdf.loads(match[0])['402370'];depots=[]
for name,value in app['depots'].items():
    if not name.isdecimal()or not isinstance(value,dict):continue
    config=value.get('config',{});system=config.get('oslist','');arch=config.get('osarch','')
    if system and'linux'not in system.split(','):continue
    if arch and arch!='64':continue
    public=value.get('manifests',{}).get('public')
    if not isinstance(public,dict):continue
    depots.append({'depot':name,'manifest':public['gid'],'installed_bytes':int(public['size']),'download_bytes':int(public['download']),'os':system,'arch':arch})
size=sum(d['installed_bytes']for d in depots)
if not depots or size*3+1024**3>8192*1024**2:raise ValueError('Publisher bytes x3 world/backup/staging reserve plus1GiB exceeds approved8GiB')
print(json.dumps({'appid':402370,'publisher_name':app.get('common',{}).get('name'),'build':app['depots']['branches']['public']['buildid'],'linux64_depots':depots,'installed_bytes':size,'download_bytes':sum(d['download_bytes']for d in depots),'conservative_multiplier':3,'additional_headroom_bytes':1024**3,'within_disk':True},indent=2))
