"""Write the scoped source receipt; never touch campaign authority or runtime."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

directory = Path('artifacts/game-parity-20261029/iw4x-readiness-owner')
recipe = 'cod/iw4x/egg-iw4x-mw2.json'
def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
result = subprocess.run([sys.executable, '-B', 'tools/runtime/test-iw4x-native.py'], capture_output=True, text=True)
(directory/'tests.log').write_text(result.stdout+result.stderr, encoding='utf-8')
assert result.returncode == 0
prior = ['artifacts/game-parity-20261029/iw4x-owner/report.md',
         'artifacts/game-parity-20261029/iw4x-owner/embed-hashes.json',
         'artifacts/game-parity-20261029/iw4x-owner/profile.json',
         'artifacts/game-parity-20261029/iw4x-settings-owner/report.json',
         'artifacts/game-parity-20261029/iw4x-settings-owner/proposal.md',
         'artifacts/game-parity-20261029/root-source-regression-wave20-retry1/report.json']
changed = ['internal/panel/game_library/scripts/iw4x-native.py', 'tools/runtime/stage-iw4x-profile.mjs',
           'tools/runtime/test-iw4x-native.py', 'tools/runtime/receipt-iw4x-readiness.py']
helpers = ['internal/panel/game_library/scripts/'+p for p in read(directory/'embed-hashes.json')['helpers']]
helpers = [p.replace('/steam_template.py', '/steam-template.py') for p in helpers]
checks = []
for family, count in [('FACT',6), ('SETUP',4), ('INSTALL',4), ('CONSOLE',5), ('SETTINGS',6),
                      ('LIFE',4), ('FILES',2), ('SCHEDULE',2), ('DELIVERY',4)]:
    for n in range(1,count+1):
        key = f'{family}-{n}'
        status = 'blocked'
        evidence = 'Legitimate prepared payload, authorized integration and native/browser fixture remain prerequisites.'
        if family == 'FACT' or key == 'SETUP-1':
            status = 'reused'; evidence = prior[0]+'; source/doc review only, no native acceptance. Ordered variable equality checked again by stager.'
        if key in ('SETTINGS-5', 'DELIVERY-3'):
            status = 'pass'; evidence = str(directory/'tests.log')+'; source fixtures only. Native consumption and Linux safe publication not tested.'
        if key == 'DELIVERY-4':
            status = 'pass'; evidence = 'TemporaryDirectory fixtures removed by context managers; no live resources acquired or operations running.'
        checks.append(dict(id=key,status=status,evidence=evidence))
assert len(checks) == 37
report = dict(recipe=recipe, owner='iw4x-readiness-owner', outcome='partial; staged unapplied source candidate',
    prior_proofs={p:digest(p) for p in prior},
    campaign_row=next(row for row in read('artifacts/game-parity-20261029/CURRENT-PROGRESS.json')['rows'] if row['recipe']==recipe),
    changed_files=changed, hashes={p:digest(p) for p in set(changed+helpers)},
    fragment=dict(path=str(directory/'profile.json'),sha256=digest(directory/'profile.json'),revision='iw4x-local-query-v3',applied=False),
    sources=[dict(url='https://github.com/iw4x/iw4x-client/blob/main/src/Components/Modules/'+p,
                  retrieved='2026-10-30', lines=lines) for p,lines in [('Party.cpp','411-530'),('Network.cpp','173-219'),('Dedicated.cpp','30-34,58-72,152-166')]],
    implementation='Private IW4x supervisor child hook; pre-spawn UDP occupancy refusal, connected loopback UDP challenge, strict bounded infoResponse parser, IW4 identity, version/protocol presence, sv_running=1, matchtype=2, nonempty map/gametype, matching mod and live child before/after query. Emits only one verified-query marker. No timer, process-alive or heartbeat readiness. Existing supervisor controls and return values retained. Launcher update has no gate; preflight repeats before configure after update.',
    authority_impact='Canonical overrides and Go/shared helpers untouched. New profile/helper hashes invalidate prior helper pins for this candidate. Settings integrator must review current canonical authority and selectively merge this exact recipe fragment. Do not overwrite its in-flight settings changes or use historical pins as current authority.',
    config_authority='Emitted argv +exec server.cfg, empty fs_game verified structurally. Publisher documents userraw/server.cfg. Scoped preflight refuses mod-local server.cfg shadows. Representative seven scalar settings, unknown rows and CRLF retained byte-for-byte. Environment hostname/password authority unchanged. Arbitrary exec graphs, packed configs, autoexec and native file-resolution/readback remain unproven; editor integrator must retain its strict eligibility guards.',
    tests=dict(command='python -B tools/runtime/test-iw4x-native.py',exit=result.returncode,total=10,passed=9,skipped=1,
        skip_reason='Windows symlink creation privilege unavailable; prior owner Linux refusal proof retained, not rerun.',
        fixtures='Exact emitted helpers extracted to a temporary layout; payload validate and Linux safe publisher mocked. Mocked socket/child responses, dead child before and after query, malformed/wrong challenge/identity/mod, occupied port, raw 0/7/-2 returns; no actual protocol traffic or native execution.',
        earlier_failures=['Initial local symlink fixture WinError 1314; now explicit skip.', 'First new fixture exposed Linux-only os.O_DIRECTORY publisher and finite mock poll sequence; publisher explicitly mocked and mock sequence corrected.']),
    checks=checks, check_count=37,
    blockers=['Native listener/query validation pending on actual authorized integrated IW4x build.',
              'Legitimate operator-owned prepared payload and existing original credential/control prerequisites remain unmet; no binary acquisition.',
              'No browser, native readback, lifecycle, reinstall, schedules, player join or WAN acceptance.',
              'UDP occupancy refusal narrows stale-listener risk but does not atomically reserve native port through child bind; native port-to-child ownership validation remains pending.'],
    cleanup=dict(temporary_fixtures='removed', live_actions=False, operations_running=False, baseline_games_retested=False,
                 commits_builds_activation_publication=False, canonical_edits=False))
(directory/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('IW4x receipt: 37 statuses; 9 tests passed / 1 explicit skip; candidate unapplied')
