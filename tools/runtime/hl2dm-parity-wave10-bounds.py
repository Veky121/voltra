"""Conservative public Linux depot bounds from the guarded Valve receipt."""
import json
from pathlib import Path

folder=Path('.local/game-parity-20261029/runtime/hl2dm-metadata-wave10')
apps={appid:json.loads((folder/('app-'+appid+'.json')).read_text()) for appid in ('232370','320')}
selected=[];excluded=[];unresolved=[]
for depotid,entry in apps['232370'].get('depots',{}).items():
    if not depotid.isdecimal() or not isinstance(entry,dict):continue
    current,source,config,seen=entry,'232370',dict(entry.get('config',{})),set()
    while not isinstance(current.get('manifests',{}).get('public'),dict):
        parent=str(current.get('depotfromapp',''))
        if parent not in apps or (parent,depotid) in seen:
            unresolved.append({'depot':depotid,'from_app':parent or None});current=None;break
        seen.add((parent,depotid));current=apps[parent].get('depots',{}).get(depotid)
        if not isinstance(current,dict):unresolved.append({'depot':depotid,'from_app':parent});current=None;break
        config={**current.get('config',{}),**config};source=parent
    if current is None:continue
    if config.get('oslist') and 'linux' not in config['oslist'].split(','):
        excluded.append({'depot':depotid,'reason':'non-Linux','config':config});continue
    if config.get('language') and config['language']!='english':
        excluded.append({'depot':depotid,'reason':'non-default language','config':config});continue
    manifest=current['manifests']['public']
    if not all(key in manifest for key in ('gid','size','download')):
        unresolved.append({'depot':depotid,'reason':'missing public manifest bounds'});continue
    selected.append({'depot':depotid,'metadata_app':source,'config':config,'manifest':manifest['gid'],'installed_bytes':int(manifest['size']),'download_bytes':int(manifest['download'])})
installed=sum(x['installed_bytes'] for x in selected);downloaded=sum(x['download_bytes'] for x in selected);peak=2*installed+1024**3
result={'receipt':'hl2dm-wave10-metadata-utility.json','app_id':232370,'publisher_name':apps['232370']['common']['name'],'publisher_type':apps['232370']['common']['type'],'public_branch':apps['232370']['depots']['branches']['public'],'client_app_id':320,'client_publisher_name':apps['320']['common']['name'],'client_primary_game_directory':apps['320'].get('extended',{}).get('gamedir'),'server_primary_gamedir_note':'Tool extended.gamedir is ValveTestApp232370; hl2mp is corroborated by client app320 and existing variant registration. Installed gameinfo/maps still require native validation.','selected_depots':selected,'excluded_depots':excluded,'unresolved_depots':unresolved,'installed_bytes':installed,'download_bytes':downloaded,'conservative_staging_bytes':peak,'staging_formula':'Two installed copies plus1GiB for Steam/bootstrap/config preservation; explicit bound, not measured peak.','catalog_defaults':{'memory_mib':4096,'disk_mib':8192,'ports':3,'cpu_percent':100,'extra_swap_mib':0},'fits_catalog_disk':bool(selected) and not unresolved and peak<=8192*1024**2,'metadata_only':True,'game_content_acquired':False,'installation_entitlement_verified':False,'private_credentials_supplied':False,'source_ready_scope':'Pending-only pure preflight candidate has6 Linux fixtures; original shared Source launcher and15 controls retained. No typed CFG declaration before native schema/authority evidence.','historical_evidence_not_promoted':'artifacts/hl2dm-live-acceptance.json is prior node202 evidence, not this campaign.'}
Path('artifacts/game-parity-20261029/hl2dm-wave10-publisher-bounds.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({key:result[key] for key in ('app_id','publisher_name','public_branch','client_primary_game_directory','installed_bytes','download_bytes','conservative_staging_bytes','fits_catalog_disk','unresolved_depots','catalog_defaults')}))
if not result['fits_catalog_disk'] or result['client_primary_game_directory']!='hl2mp':raise SystemExit('Primary bounds/game identity gate not satisfied')
