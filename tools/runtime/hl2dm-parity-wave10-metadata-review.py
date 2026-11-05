"""Parse only the completed bounded Valve app_info query; no content downloads."""
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0,str(Path(__file__).with_name('steam-game-cache-vendor')))
import vdf

folder=Path('.local/game-parity-20261029/runtime/hl2dm-metadata-wave10')
receipt=json.loads(Path('artifacts/game-parity-20261029/hl2dm-wave10-metadata-utility.json').read_text())
if receipt['actual_exit']!=0 or not receipt['anonymous_connected'] or not receipt['container_absent'] or not receipt['slot_released']:
    raise ValueError('Completed primary metadata utility receipt required')
raw=(folder/'metadata.log').read_text(errors='replace')
raw=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',raw)
apps={}
for appid in ('232370','320'):
    match=re.search(r'(?m)^"'+appid+r'"\s*\n\{[\s\S]*?^\}',raw)
    if not match:raise ValueError('Missing complete Valve app section '+appid)
    apps[appid]=vdf.loads(match[0])[appid]
    (folder/('app-'+appid+'.json')).write_text(json.dumps(apps[appid],indent=2)+'\n')
summary={}
for appid,app in apps.items():
    depots=[]
    for depotid,depot in app.get('depots',{}).items():
        if depotid.isdecimal() and isinstance(depot,dict):
            depots.append({'id':depotid,'config':depot.get('config',{}),'from_app':depot.get('depotfromapp'),'public':depot.get('manifests',{}).get('public')})
    summary[appid]={'name':app.get('common',{}).get('name'),'type':app.get('common',{}).get('type'),'oslist':app.get('common',{}).get('oslist'),'game_directory':app.get('extended',{}).get('gamedir'),'app_config':app.get('config',{}),'public_branch':app.get('depots',{}).get('branches',{}).get('public'),'depots':depots}
report={'primary_source':'Anonymous Valve SteamCMD app_info_print232370+320; actualexit0; noapp_update','metadata_log_sha256':hashlib.sha256((folder/'metadata.log').read_bytes()).hexdigest(),'metadata_only':True,'game_content_acquired':False,'installation_entitlement_verified':False,'apps':summary}
Path('artifacts/game-parity-20261029/hl2dm-wave10-primary-appinfo.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({key:{field:value for field,value in item.items() if field!='app_config'} for key,item in summary.items()}))
