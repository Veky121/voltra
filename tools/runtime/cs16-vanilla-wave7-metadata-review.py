"""Read only publisher SteamCMD metadata; no entitlement or download assumptions."""
import json
from pathlib import Path
import re
import sys
sys.path.insert(0, str(Path(__file__).with_name('steam-game-cache-vendor')))
import vdf
folder=Path(sys.argv[1] if len(sys.argv)>1 else '.local/game-parity-20261029/runtime/cs16-vanilla-metadata-wave7')
raw=(folder/'metadata.log').read_text(errors='replace')
raw=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', raw)
apps={}
for appid in ('90','10','70'):
    match=re.search(r'(?m)^"'+appid+r'"\s*\n\{[\s\S]*?^\}',raw)
    if not match: raise ValueError('Missing complete primary Steam app '+appid)
    apps[appid]=vdf.loads(match[0])[appid]
    (folder/('app-'+appid+'.json')).write_text(json.dumps(apps[appid],indent=2)+'\n')
summary={}
for appid, app in apps.items():
    depots=[]
    for depotid, entry in app.get('depots',{}).items():
        if not depotid.isdecimal() or not isinstance(entry,dict):continue
        depots.append({'depot':depotid,'name':entry.get('name'),'config':entry.get('config',{}),'from_app':entry.get('depotfromapp'),'public':entry.get('manifests',{}).get('public')})
    summary[appid]={'name':app.get('common',{}).get('name'),'type':app.get('common',{}).get('type'),'oslist':app.get('common',{}).get('oslist'),'app_config':app.get('config',{}),'public_branch':app.get('depots',{}).get('branches',{}).get('public'),'depots':depots}
result={'primary_source':'Anonymous Valve SteamCMD app_info_print90/10/70; no app_update','attempt':str(folder),'metadata_only':True,'entitlement_verified':False,'game_content_acquired':False,'apps':summary}
Path('artifacts/game-parity-20261029/cs16-vanilla-wave7-primary-appinfo.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({appid:{'name':app['name'],'type':app['type'],'public_branch':app['public_branch'],'depots':app['depots']} for appid,app in summary.items()}))
