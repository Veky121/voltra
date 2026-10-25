"""Read public app metadata with the existing pinned ValvePython reader."""
import json
from pathlib import Path
import re
import sys
sys.path.insert(0, str(Path(__file__).with_name('steam-game-cache-vendor')))
import vdf

directory = Path('.local/kf2-metadata')
raw = (directory / 'metadata.log').read_text()
match = re.search(r'(?m)^"232130"\s*\n\{[\s\S]*?^\}', raw)
if not match:
    raise ValueError('Missing complete KF2 app metadata')
app = vdf.loads(match[0])['232130']
depots, unresolved = [], []
for name, depot in app.get('depots', {}).items():
    if not name.isdecimal() or not isinstance(depot, dict):
        continue
    config = depot.get('config', {})
    if config.get('oslist') and 'linux' not in config['oslist'].split(','):
        continue
    if config.get('osarch') and config['osarch'] != '64':
        continue
    manifest = depot.get('manifests', {}).get('public')
    if not isinstance(manifest, dict):
        unresolved.append({'depot': name, 'from_app': depot.get('depotfromapp'), 'shared_install': depot.get('sharedinstall')})
        continue
    depots.append({'depot': name, 'manifest': manifest['gid'], 'installed_bytes': int(manifest['size']), 'download_bytes': int(manifest['download']), 'oslist': config.get('oslist', 'shared'), 'architecture': config.get('osarch', 'unspecified')})
expanded = sum(d['installed_bytes'] for d in depots)
result = {'appid': 232130, 'publisher_name': app.get('common', {}).get('name'), 'common': app.get('common', {}),
          'all_branches': app.get('depots', {}).get('branches', {}), 'all_depots': app.get('depots', {}), 'public_branch': app.get('depots', {}).get('branches', {}).get('public'), 'launch': app.get('config', {}).get('launch'), 'all_config': app.get('config', {}),
          'extended': app.get('extended', {}), 'ufs': app.get('ufs', {}), 'linux_or_shared_depots': depots,
          'unresolved_depots': unresolved, 'installed_bytes': expanded, 'download_bytes': sum(d['download_bytes'] for d in depots),
          'game_memory_mib': 4096, 'game_disk_mib': 65536, 'conservative_staging_bytes': 2 * expanded + 1024**3,
          'fits_64gib_with_one_duplicate_plus_1gib': bool(depots) and not unresolved and 2 * expanded + 1024**3 <= 65536 * 1024**2,
          'metadata_only': True, 'installation_entitlement_verified': False, 'game_content_downloaded': False, 'terms_accepted': False}
(directory / 'app-232130.json').write_text(json.dumps(app, indent=2) + '\n')
(directory / 'assessment.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'build': (result['public_branch'] or {}).get('buildid'), 'depots': depots, 'installed_bytes': expanded, 'download_bytes': result['download_bytes'], 'fits_64gib': result['fits_64gib_with_one_duplicate_plus_1gib']}))
