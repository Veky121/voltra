"""Reconcile publisher app-info depots; never infer installation entitlement."""
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).with_name('steam-game-cache-vendor')))
import vdf

directory = Path('.local/game-parity-20261029/runtime/css-metadata-wave7-retry1')
raw = (directory / 'metadata.log').read_text(errors='replace')
raw = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', raw)
apps = {}
for appid in ('232330', '240'):
    match = re.search(r'(?m)^"' + appid + r'"\s*\n\{[\s\S]*?^\}', raw)
    if not match:
        raise ValueError('Missing complete publisher app metadata: ' + appid)
    apps[appid] = vdf.loads(match[0])[appid]
    (directory / ('app-' + appid + '.json')).write_text(json.dumps(apps[appid], indent=2) + '\n')

selected, excluded, unresolved = [], [], []
for depotid, original in apps['232330'].get('depots', {}).items():
    if not depotid.isdecimal() or not isinstance(original, dict):
        continue
    current, appid, visited = original, '232330', set()
    config = dict(original.get('config', {}))
    if config.get('oslist') and 'linux' not in config['oslist'].split(','):
        excluded.append({'depot': depotid, 'reason': 'non-Linux', 'config': config})
        continue
    if config.get('language') and config['language'] != 'english':
        excluded.append({'depot': depotid, 'reason': 'non-default language', 'config': config})
        continue
    while 'public' not in current.get('manifests', {}):
        source = str(current.get('depotfromapp', ''))
        identity = (source, depotid)
        if not source or identity in visited or source not in apps:
            unresolved.append({'depot': depotid, 'from_app': source or None})
            current = None
            break
        visited.add(identity)
        inherited = apps[source].get('depots', {}).get(depotid)
        if not isinstance(inherited, dict):
            unresolved.append({'depot': depotid, 'from_app': source})
            current = None
            break
        config = {**inherited.get('config', {}), **config}
        current, appid = inherited, source
    if current is None:
        continue
    systems = config.get('oslist', '').split(',')
    if config.get('oslist') and 'linux' not in systems:
        excluded.append({'depot': depotid, 'reason': 'non-Linux', 'config': config})
        continue
    if config.get('language') and config['language'] != 'english':
        excluded.append({'depot': depotid, 'reason': 'non-default language', 'config': config})
        continue
    manifest = current['manifests']['public']
    if not isinstance(manifest, dict) or not all(key in manifest for key in ('gid', 'size', 'download')):
        unresolved.append({'depot': depotid, 'from_app': appid, 'reason': 'missing public sizes'})
        continue
    selected.append({'depot': depotid, 'metadata_app': appid, 'manifest': manifest['gid'], 'installed_bytes': int(manifest['size']), 'download_bytes': int(manifest['download']), 'config': config})

installed = sum(d['installed_bytes'] for d in selected)
downloaded = sum(d['download_bytes'] for d in selected)
app = apps['232330']
result = {
    'appid': 232330, 'client_appid': 240,
    'publisher_name': app.get('common', {}).get('name'),
    'publisher_type': app.get('common', {}).get('type'),
    'oslist': app.get('common', {}).get('oslist'),
    'public_branch': app.get('depots', {}).get('branches', {}).get('public'),
    'linux_or_shared_depots': selected, 'excluded_depots': excluded,
    'unresolved_depots': unresolved, 'installed_bytes': installed,
    'download_bytes': downloaded,
    'conservative_staging_bytes': 2 * installed + 1024**3,
    'fits_catalog_8192mib': bool(selected) and not unresolved and 2 * installed + 1024**3 <= 8192 * 1024**2,
    'metadata_only': True, 'installation_entitlement_verified': False,
    'game_content_downloaded': False, 'private_credentials_supplied': False,
    'source': 'Anonymous Valve SteamCMD app_info_print232330/240, no app_update',
}
(directory / 'assessment.json').write_text(json.dumps(result, indent=2) + '\n')
Path('artifacts/game-parity-20261029/css-wave7-publisher-metadata.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({key: result[key] for key in ('appid', 'publisher_name', 'publisher_type', 'public_branch', 'installed_bytes', 'download_bytes', 'conservative_staging_bytes', 'fits_catalog_8192mib', 'unresolved_depots')}))
