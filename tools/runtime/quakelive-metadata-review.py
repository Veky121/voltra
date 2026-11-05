"""Parse primary Valve app349090 metadata; no subscription assumptions."""
import json
from pathlib import Path
import re
import sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/runtime/steam-game-cache-vendor'))
import vdf
raw=(ROOT/'.local/game-parity-20261029/quakelive-native/metadata.log').read_text(errors='replace')
raw=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',raw)
match=re.search(r'(?m)^"349090"\s*\n\{[\s\S]*?^\}',raw)
if not match:raise ValueError('Missing complete Valve app349090 section')
app=vdf.loads(match[0])['349090'];selected=[];excluded=[];unresolved=[]
for depot,entry in app.get('depots',{}).items():
    if not depot.isdecimal() or not isinstance(entry,dict):continue
    config=entry.get('config',{})
    if config.get('oslist') and 'linux' not in config['oslist'].split(','):
        excluded.append({'depot':depot,'config':config,'reason':'Non-Linux publisher selector'});continue
    if config.get('language') and config['language']!='english':
        excluded.append({'depot':depot,'config':config,'reason':'Non-default language publisher selector'});continue
    manifest=entry.get('manifests',{}).get('public')
    if not isinstance(manifest,dict) or not all(k in manifest for k in ('gid','size','download')):
        unresolved.append({'depot':depot,'config':config,'shared_from_app':entry.get('depotfromapp'),'reason':'No complete direct public manifest bounds'});continue
    selected.append({'depot':depot,'config':config,'manifest':manifest['gid'],'installed_bytes':int(manifest['size']),'download_bytes':int(manifest['download'])})
installed=sum(x['installed_bytes'] for x in selected);download=sum(x['download_bytes'] for x in selected);peak=2*installed+1024**3
out={'appid':349090,'publisher_name':app.get('common',{}).get('name'),'publisher_type':app.get('common',{}).get('type'),'oslist':app.get('common',{}).get('oslist'),'public_branch':app.get('depots',{}).get('branches',{}).get('public'),'selected_linux_depots':selected,'excluded_depots':excluded,'unresolved_depots':unresolved,'installed_bytes':installed,'download_bytes':download,'conservative_staging_bytes':peak,'catalog_disk_mib':8192,'fits_catalog_disk':bool(selected) and not unresolved and peak<=8192*1024**2,'eulas':app.get('eulas',app.get('common',{}).get('eulas')),'metadata_only':True,'game_content_acquired':False,'installation_entitlement_verified':False,'primary_source':'Actual anonymous Valve SteamCMD app_info_print349090; fixed Linux platform, app_info only, no app_update'}
print(json.dumps({'app':app,'bounds':out}))
