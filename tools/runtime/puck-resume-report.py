"""Write the bounded source receipt without runtime or shared-ledger mutation."""
import ast
import hashlib
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parents[2]
out = root / 'artifacts/game-parity-20261029/puck-resume-source'
recipe = 'puck/egg-puck.json'
canonical = json.loads((root / 'internal/panel/game_library/overrides.json').read_text())[recipe]
fragment = json.loads((out / 'profiles.fragment.json').read_text())
assert list(fragment) == [recipe]
candidate = fragment[recipe]
assert canonical['egg']['variables'] == candidate['egg']['variables']
assert canonical['egg']['startup'] == candidate['egg']['startup']
assert canonical['egg']['config'] == candidate['egg']['config']
script = candidate['egg']['scripts']['installation']['script']
sources = re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2", script, re.S)
for name, _, source in sources:
    if name.endswith('.py'):
        ast.parse(source, filename=name)
assert any(name == 'puck_readiness.py' for name, _, _ in sources)
runtime = next(source for name, _, source in sources if name == 'light_games_next_runtime.py')
assert 'observer=StrictPuckObserver(environment)' in runtime
historical = json.loads((root / 'artifacts/puck-native-acceptance.json').read_text())
hashes = {}
for name, prior in historical['source']['hashes'].items():
    path = root / 'internal/panel/game_library/scripts' / name
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    hashes[name] = dict(current=digest, historical=prior, unchanged=digest == prior)
files = ['internal/panel/game_library/scripts/puck-readiness.py', 'tools/runtime/stage-puck-readiness.mjs',
         'tools/runtime/test-puck-readiness.py', 'tools/runtime/puck-resume-report.py',
         'artifacts/game-parity-20261029/puck-resume-source/profiles.fragment.json']
groups = {'FACT':6, 'SETUP':4, 'INSTALL':4, 'CONSOLE':5, 'SETTINGS':6, 'LIFE':4, 'FILES':2, 'SCHEDULE':2, 'DELIVERY':4}
checks = []
reused = {'INSTALL-1','INSTALL-2','INSTALL-3','INSTALL-4','LIFE-1','LIFE-2','LIFE-3','SETTINGS-4','SETTINGS-5'}
for group, count in groups.items():
    for number in range(1, count+1):
        key = f'{group}-{number}'
        status = 'reused' if key in reused else 'blocked'
        evidence = 'artifacts/puck-native-acceptance.json' if status == 'reused' else 'artifacts/game-parity-20261029/SHARED-PLATFORM-BASELINE.json'
        limit = 'Historical build 24731491 only; no current candidate/native promotion.' if status == 'reused' else 'No current game fixture or candidate activation; shared platform proof alone is insufficient.'
        if status == 'reused' and not all(v['unchanged'] for v in hashes.values()):
            status = 'blocked'
            limit = 'Historical success retained for build 24731491, but current helper hashes differ. No current-source reuse or candidate acceptance inferred.'
        if group == 'FACT':
            status, evidence, limit = 'pending', 'manifest in this report', 'Historical artifact facts retained; current dedicated-server release/licensing and complete field authority not fully reverified.'
        if key == 'SETUP-1':
            status, evidence, limit = 'pass', 'puck-resume-report.py structural assertions', 'Source only: all nine ordered variable objects, defaults and permissions exactly retained.'
        if key == 'DELIVERY-3':
            status, evidence, limit = 'pass', 'test-puck-readiness.py and puck-resume-report.py', 'Five parser tests pass; all staged Python sources parse and exact-game/unchanged-controls assertions pass. Windows Python, no native claim.'
        if key == 'DELIVERY-4':
            status, evidence, limit = 'pass', 'artifacts/light-games-next-puck-cleanup.json', 'No resources, lease, payload, schedules or running operations created this turn; historical cleanup is not a fresh inventory.'
        checks.append(dict(id=key,status=status,evidence=evidence,limitation=limit))
report = dict(recipe=recipe, owner='Puck implementation sub-agent', outcome='partial',
    historical_source_comparison=hashes,
    identities={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in files},
    known_served_identity=dict(pid=45220, source_fingerprint='647bfff32f167b6670715d8c73180454fea5ecde406bdd5fdb6638b680f5c8ac', scope='Dispatch/baseline receipt, not freshly queried'),
    manifest=dict(publisher='NS7', client_app=2994020, dedicated_app=3481440,
        tested_release=historical['release'], platform='Linux amd64 in Windows Docker only',
        resources=dict(memory_GB=1,disk_GB=4,observed_native_memory_MiB='266-281',basis='Existing fixture defaults, not publisher dedicated-server recommendations'),
        ports='Allocated primary TCP/UDP; distinct allocated additional native TCP preview. Legacy query default 7778 is refused when unallocated.',
        files=['server_configuration.json legacy API','server_config.json current native','public_game_mode_config.json','admin_steam_ids.json','banned_steam_ids.json','Plugins','Logs/Puck.log'],
        controls='All nine ordered upstream controls unchanged; exact objects in fragment. Existing legacy-to-native authority remains; no new editor.',
        save='Session hockey. No background world-save command established by reviewed artifacts/docs. Do not invent scheduled save support; persistent config/admin lists differ from match state.',
        prerequisites='Historical anonymous app acquisition only. No new acquisition authorized here; current entitlement/licence preconditions and publisher binary identity must be checked before future download. MIT plugin does not license publisher binaries.',
        pinned_sdk=historical.get('pinned_sdk_image'),
        sources=[dict(url='https://store.steampowered.com/app/2994020/Puck/',retrieved='2026-10-30',supports='NS7 identity; client requirements are not dedicated-server recommendations'),
                 dict(url='https://puck.gitbook.io/modding/getting-started/testing-your-mod',retrieved='2026-10-30',supports='Local Plugins loader and Logs/Puck.log; does not establish world-save absence')]),
    changes='Strict Puck-only readiness parser rejects NaN/infinity, wrong scalar types, duplicate keys and plugin failures; per-line bound supports large complete-line batches. Exact-game installer fragment embeds parser and switches only its observer.',
    checks=checks,
    blocker_packet=dict(blocker='Candidate is unserved and panel activation rejected; no retry or alternate activation attempted.',
        proposed_fix='Root may review exact-game fragment and integrate in a separately authorized future activation. Revalidate only strict readiness and affected transitions then. Game-specific mounted files, scheduler consumption, browser and restricted-settings acceptance remain gaps.',
        power_boundary='operations.go FS25 save-before-power delta is excluded from historical power acceptance; other-thread FS25 work untouched.'),
    cleanup=dict(created_runtime_resources=0,acquired_payloads=0,leases=0,running_operations=0,service_restarts=0,commits=0,publication=0),
    exclusions=['Player join/gameplay','Real kicked-player/client packet cadence','WAN','Current release update','New candidate native acceptance','Background world-save absence not proven'])
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'checks':len(checks),'embedded_sources_parsed':len(sources),'historical_source_matches':sum(v['unchanged'] for v in hashes.values()),'report':str(out/'report.json')}))
