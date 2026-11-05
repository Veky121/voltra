"""Record this source-only handoff without touching the campaign ledger."""
import datetime
import hashlib
import json
from pathlib import Path

BASE = Path('artifacts/game-parity-20261029')
OUT = BASE/'stationeers-bepinex-runtime'
def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
prior_paths = [BASE/f'{name}/receipt.json' for name in (
    'stationeers-bepinex-authority', 'stationeers-bepinex-settings', 'stationeers-bepinex-owner')]
prior_paths += [Path('artifacts/stationeers-runtime-partial.json'), Path('artifacts/stationeers-publisher-inputs.json')]
prior = json.loads(prior_paths[0].read_text())
recipe = prior['recipe']
canonical_path = Path('internal/panel/game_library/overrides.json')
current = json.loads(canonical_path.read_text())[recipe]
fragment = json.loads((OUT/'profile-proposal.json').read_text())[recipe]
comparison = json.loads(json.dumps(fragment))
comparison['egg']['startup'] = current['egg']['startup']
comparison['egg']['scripts']['installation']['script'] = current['egg']['scripts']['installation']['script']
assert comparison == current
hashes = json.loads((OUT/'emitted-hashes.json').read_text())
checks = prior['check_results']
assert len(checks) == 37
for row in checks:
    if row['id'] == 'DELIVERY-3':
        row.update(status='pass', evidence=str(OUT/'test-result.json'), limitation='Scoped emitted-layout source fixtures only; no native/browser/gameplay acceptance.')
    if row['id'] in ('SETTINGS-2', 'SETTINGS-5'):
        row.update(evidence=str(OUT/'test-result.json'), limitation='Runtime byte preservation/refusal and mocked acquisition verified. Native/API/browser consumption remains unverified.')
sources = [Path('internal/panel/game_library/scripts/stationeers-bepinex-owner.py')]
sources += list(Path('tools/runtime').glob('stationeers-bepinex-runtime-*.py'))
receipt = {
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'recipe': recipe,
    'outcome': 'partial; scoped source fix verified; fragment staged unapplied',
    'prior_proofs': [{'path':str(p),'sha256':sha(p)} for p in prior_paths],
    'prior_scope': 'Historical vanilla investigation is never current BepInEx proof. Prior parser and authority tests retained without rerunning Go or baseline games.',
    'fixes': ['Reject wrong-root, duplicate/case-variant direct keys, non-UTF8 and overdeep XML before configure/acquisition. No serializer introduced.', 'Include documented file-owned ServerAuthSecret in existing redactor inputs.'],
    'changed_files': [str(p) for p in sources],
    'exact_fragment': {'path':str(OUT/'profile-proposal.json'),'sha256':sha(OUT/'profile-proposal.json'),'applied':False,'all_other_profile_fields_controls_order_defaults_permissions_unchanged':True},
    'source_tests': json.loads((OUT/'test-result.json').read_text()),
    'emitted_helper_hashes': hashes,
    'authority_impact': {
        'previous_owner_sha256':prior['hashes']['internal/panel/game_library/scripts/stationeers-bepinex-owner.py'],
        'revised_emitted_owner_sha256':hashes['stationeers_bepinex_owner.py'],
        'runtime_sha256':hashes['stationeers_wurm_starbound_runtime.py'],
        'integration': 'Review fragment and update exact helper authority pins together. Unchanged current Go pin refuses revised helper. Recompare concurrent canonical snapshot before merging. No Go/shared/canonical edits made.'},
    'precedence': {
        'scope':'Exact emitted Python source authority; current native mod-build consumption remains unverified.',
        'existing_file_owns':['ServerName','ServerMaxPlayers','SaveInterval','AutoSave','ServerVisible','AutoPauseServer','UPNPEnabled','ServerPassword','ServerAuthSecret'],
        'cli_retained':{'StartLocalHost':'true','GamePort':'SERVER_PORT must be allocated','UpdatePort':'UPDATE_PORT when distinct and allocated; otherwise lowest distinct allocated port, or refuse'},
        'env':'Legacy scalar env still validates but is omitted from -settings for existing XML. No generic env-to-native injection.',
        'missing_file':'Canonical env/default scalar CLI retained for first native boot; no XML seeded. AutoPauseServer never emitted.',
        'world':'Always -file start SAVE_NAME plus mapped WORLD_NAME fallback. Empty fallback omits world token. World/save selection remains launch-owned.',
        'bytes':'Python never rewrites XML. Native may rewrite it at boot; unverified.',
        'path':'No settingspath emitted. Custom launchers/paths outside exact authority. Native SavePath remains opaque.'},
    'primary_research':[{'url':'https://github.com/rocket2guns/StationeersDedicatedServerGuide/blob/main/README.md','retrieved':'2026-10-30','scope':'Publisher documents settings key/value CLI, root setting.xml, StartLocalHost, ServerAuthSecret and settingspath. Command table names older build 0.2.3649.17688; not proof of current -file start or mod-build consumption.'}],
    'check_results':checks,
    'skipped':['Go/shared regression unchanged, prior proofs reused.','Native, browser, gameplay, current mod schema excluded.','No build, activation/restart retry/bypass, downloads, Docker/service/live actions, SSH/server, publication, commits, nested agents or checkout creation.'],
    'blockers':['Current modded schema/consumption and loader compatibility unverified.','Integrator owns authority hash update and fragment integration.','API/revisions/stopped-state/RBAC/browser retain prior unverified boundary.'],
    'cleanup':{'temporary_layouts':'TemporaryDirectory fixtures removed on exit','resources_acquired':[],'running_operations':[],'live_mutations':False,'shared_canonical_edits':False},
    'hashes':{str(p):sha(p) for p in sources+[canonical_path,Path('internal/panel/game_settings_stationeers_bepinex.go'),Path('internal/panel/game_settings_stationeers_bepinex_authority.go')]}}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('37 statuses; fragment consistency verified; receipt saved:', OUT/'receipt.json')
