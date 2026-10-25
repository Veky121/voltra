"""Parse public Steam metadata with the existing pinned ValvePython VDF reader."""
import json
from pathlib import Path
import re
import sys
sys.path.insert(0, '/vendor')
import vdf

log=Path('/evidence/metadata.log').read_text()
match=re.search(r'(?m)^"619960"\s*\n\{[\s\S]*?^\}',log)
if not match:raise ValueError('Missing complete target metadata block')
app=vdf.loads(match[0])['619960'];depots=[]
for name,value in app['depots'].items():
    if not name.isdecimal() or not isinstance(value,dict):continue
    operating_system=value.get('config',{}).get('oslist','')
    if operating_system and 'linux' not in operating_system.split(','):continue
    public=value.get('manifests',{}).get('public')
    if not isinstance(public,dict):continue
    depots.append({'depot':int(name),'manifest':public['gid'],'installed_bytes':int(public['size']),'download_bytes':int(public['download'])})
size=sum(d['installed_bytes']for d in depots)
if not depots or size+1024**3>4096*1024**2:raise ValueError('Known publisher payload plus1GiB bootstrap headroom exceeds approved4GiB')
print(json.dumps({'appid':619960,'publisher_name':app.get('common',{}).get('name'),'public_build':app['depots']['branches']['public']['buildid'],'linux_public_depots':depots,'metadata_installed_bytes':size,'metadata_download_bytes':sum(d['download_bytes']for d in depots),'bootstrap_headroom_bytes':1024**3,'within_approved_disk':True},indent=2))
