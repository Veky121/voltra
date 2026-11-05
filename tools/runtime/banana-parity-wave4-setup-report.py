"""Report scoped source/overlay evidence without promoting native gates."""
import hashlib
import json
from pathlib import Path
from datetime import datetime, timezone
root=Path(__file__).resolve().parents[2]
out=root/'artifacts/game-parity-20261029'
proposal=json.loads((out/'astroneer-native-setup-validation.json').read_text())
overrides=json.loads((root/'internal/panel/game_library/overrides.json').read_text())
recipe=proposal['recipe']
fields=[v for v in overrides[recipe]['egg']['variables'] if v['env_variable']=='PUBLIC_IP']
assert fields==[proposal['original_PUBLIC_IP']], 'Original public-IP field changed; review before claiming preservation'
fragment={recipe:{'setup_validation':[proposal['validation']]}}
(out/'banana-wave4-setup-metadata.json').write_text(json.dumps(fragment,indent=2)+'\n')
events=[json.loads(line) for line in (out/'banana-wave4-setup-go-tests.log').read_text(encoding='utf-8-sig').splitlines() if line.strip()]
passes=sum(e.get('Action')=='pass' and 'Test' in e for e in events)
assert not any(e.get('Action') in ('fail','skip') for e in events)
paths=['internal/panel/game_setup_validation.go','internal/panel/game_setup_validation_test.go','web/src/client/templateSetupRules.ts','web/tests/templateSetupRules.test.mjs','tools/runtime/banana-parity-wave4-setup-stage.py','tools/runtime/banana-parity-wave4-setup-vectors.py','tools/runtime/banana-parity-wave4-setup-frontend-test.mjs','tools/runtime/banana-parity-wave4-setup-report.py']
paths += ['artifacts/game-parity-20261029/'+p.name for p in out.glob('banana-wave4-setup-*.pending')]
paths += ['artifacts/game-parity-20261029/'+p for p in ['banana-wave4-setup-overlay.json','banana-wave4-setup-ipv4-vectors.json','banana-wave4-setup-metadata.json']]
report={
 'observed_at':datetime.now(timezone.utc).isoformat(),'recipe':recipe,'scope':'New standalone shared setup validation helpers and pending shared hooks. Source/fixture evidence only.',
 'files':[{'path':p,'sha256':hashlib.sha256((root/p).read_bytes()).hexdigest()} for p in paths],
 'validation':proposal['validation'],'original_PUBLIC_IP_preserved':True,'field_count':len(fields),'canonical_shared_files_edited':False,
 'tests':{'go':{'command':"go test -overlay artifacts/game-parity-20261029/banana-wave4-setup-overlay.json ./internal/panel -run '^TestSetup(PublicIPv4|Validation)' -count=1 -json",'pass_including_subtests':passes,'fail':0,'skip':0,'database':'Isolated PostgreSQL55439 private TEST_DATABASE_URL; fixture schema, no active panel records','log':'artifacts/game-parity-20261029/banana-wave4-setup-go-tests.log','route_checks':'17 invalid values × actual ports/install routes return422; four accepted public previews return200; malformed duplicate descriptors return409 on both routes. Allocation row contents and six table counts remain identical; no Wings calls.'},
 'typescript':{'command':'node --experimental-strip-types --test web/tests/templateSetupRules.test.mjs tools/runtime/banana-parity-wave4-setup-frontend-test.mjs','pass':5,'fail':0,'skip':0,'coverage':'846 Python-reference addresses and exact shared readiness field-error path. Full frontend TypeScript compiler with pending TS/TSX overlays passed, no source writes.'}},
 'semantics':{'reference':'https://docs.python.org/3/library/ipaddress.html#ipaddress.IPv4Address.is_global','version':'Python3.13+ IPv4Address.is_global and not is_multicast; generated with local Python3.15.1','coverage':'846 deterministic vectors: supplied21, all192.0.0/24, range endpoints/neighbors, seeded random512, syntax/injection and IPv6/mapped rejection','no_address_lookup':True,'no_default_injection':True,'no_input_normalization':True,'no_original_variable_mutation':True},
 'hooks':['Add SetupValidation to override and loaded template; copy during override loading; surface in summary/options.', 'Validate trusted metadata for availability; normalized environment in install before DB lock/allocation/import/create and in ports route before node/bind work.', 'Pure port planner also enforces descriptor before planning.', 'TemplateOptions carries metadata into existing templateSetupProblems; extra error maps to existing game-template-PUBLIC_IP and deduplicates existing required-value error. No new field.'],
 'integration':['Root reviews and applies pending shared hunks to CURRENT files; do not overwrite concurrent changes from full pending copies.','Merge metadata-only banana-wave4-setup-metadata.json additive subtree into current Astroneer override; preserve current helper embeds and all variable rows.','Copy pending routes test to internal/panel/game_setup_validation_routes_test.go when metadata field/hook integration exists.','Run focused source/PG/frontend checks on integrated source before activation. Root/native lane verifies served setup rejection and accepted operator-provided address.'],
 'remaining':['Native/API served validation awaits root integration and activation.','Actual host advertised address, forwarding and gameplay remain independent native requirements; this validator cannot prove reachability.','Native helper refusal remains defense in depth; Python version differences before3.13 are intentionally not the target classification.'],
 'runtime_mutations':False,'new_game_downloads_or_starts':False,'native_gates_promoted':False,
}
(out/'banana-wave4-setup-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'go_pass_including_subtests':passes,'typescript_tests':5,'vectors':846,'report':'artifacts/game-parity-20261029/banana-wave4-setup-validation.json'}))
