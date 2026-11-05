"""Assess app90 Linux+cstrike public depots from fresh primary Valve metadata."""
import json
from pathlib import Path
folder=Path('.local/game-parity-20261029/runtime/cs16-vanilla-metadata-wave7-retry1')
apps={appid:json.loads((folder/('app-'+appid+'.json')).read_text()) for appid in ('90','10','70')}
selected=[];excluded=[];unresolved=[]
for depotid, entry in apps['90'].get('depots',{}).items():
    if not depotid.isdecimal() or not isinstance(entry,dict):continue
    config=dict(entry.get('config',{}))
    if config.get('mod') and config['mod']!='cstrike':
        excluded.append({'depot':depotid,'reason':'different selected mod','config':config});continue
    if config.get('oslist') and 'linux' not in config['oslist'].split(','):
        excluded.append({'depot':depotid,'reason':'non-Linux','config':config});continue
    if config.get('language') and config['language']!='english':
        excluded.append({'depot':depotid,'reason':'non-default language','config':config});continue
    current=entry;source='90';visited=set()
    while not isinstance(current.get('manifests',{}).get('public'),dict):
        parent=str(current.get('depotfromapp',''));identity=(parent,depotid)
        if not parent or parent not in apps or identity in visited:
            unresolved.append({'depot':depotid,'from_app':parent or None});current=None;break
        visited.add(identity);current=apps[parent].get('depots',{}).get(depotid)
        if not isinstance(current,dict):unresolved.append({'depot':depotid,'from_app':parent});current=None;break
        config={**current.get('config',{}),**config};source=parent
    if current is None:continue
    manifest=current['manifests']['public']
    if not all(k in manifest for k in ('gid','size','download')):
        unresolved.append({'depot':depotid,'reason':'missing public bounds'});continue
    selected.append({'depot':depotid,'metadata_app':source,'manifest':manifest['gid'],'config':config,'installed_bytes':int(manifest['size']),'download_bytes':int(manifest['download'])})
installed=sum(x['installed_bytes'] for x in selected);downloaded=sum(x['download_bytes'] for x in selected);peak=2*installed+1024**3
result={'at_utility_receipt':'cs16-vanilla-wave7-metadata-retry1-utility.json','appid':90,'publisher_name':apps['90']['common']['name'],'publisher_type':apps['90']['common']['type'],'public_branch':apps['90']['depots']['branches']['public'],'selected_mod':'cstrike','client_appid':10,'client_publisher_name':apps['10']['common']['name'],'client_primary_gamedir':apps['10'].get('extended',{}).get('gamedir'),'mod_selection_evidence':'App90 selects Counter-Strike depot11 from app10; other mod-specific depots explicitly excluded by their Valve config.mod selectors. Installer explicitly app_set_config90modcstrike before app_update90. Native installed mod still requires verification.','selected_depots':selected,'excluded_depots':excluded,'unresolved_depots':unresolved,'installed_bytes':installed,'download_bytes':downloaded,'conservative_staging_bytes':peak,'catalog_disk_mib':4096,'fits_catalog_disk':bool(selected) and not unresolved and peak<=4096*1024**2,'requested_game_bounds':{'memory_mib':1024,'disk_mib':4096,'ports':2,'cpu_percent':100,'extra_swap_mib':0},'metadata_only':True,'game_content_downloaded':False,'installation_entitlement_verified':False,'private_credentials_supplied':False,'primary_source':'Anonymous Valve SteamCMD app_info_print90/10/70 under immutable-image bounded utility, actualexit0.'}
Path('artifacts/game-parity-20261029/cs16-vanilla-wave7-publisher-bounds.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['appid','publisher_name','publisher_type','public_branch','selected_mod','client_primary_gamedir','installed_bytes','download_bytes','conservative_staging_bytes','fits_catalog_disk','unresolved_depots','requested_game_bounds']}))
if not result['fits_catalog_disk'] or result['client_primary_gamedir']!='cstrike':raise SystemExit('Primary bounds/mod identity gate not satisfied')
