"""Stage only the two owned helper substitutions into a new output directory."""
import argparse
import hashlib
import json
from pathlib import Path
import re

root=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args()
out=Path(args.output).resolve()
if out.exists() and any(p.name not in ('d2k-recipe.pending.json','cnc-recipe.pending.json','report.json') for p in out.iterdir()):
    raise ValueError('Refuse output directory containing unrelated files')
out.mkdir(parents=True,exist_ok=True)
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
profiles_path=root/'internal/panel/game_library/overrides.json'
profiles=json.loads(profiles_path.read_text())
helper=root/'internal/panel/game_library/scripts/openra-family.py'
code=helper.read_text().rstrip()+'\n'
checks={ 'FACT':6,'SETUP':4,'INSTALL':4,'CONSOLE':5,'SETTINGS':6,'LIFE':4,'FILES':2,'SCHEDULE':2,'DELIVERY':4 }
variants=[]
for mod,variant,file in [('d2k','openra_dune2000','egg-open-r-a--dune2000.json'),('cnc','openra_tiberian_dawn','egg-open-r-a--tiberian-dawn.json')]:
    recipe=f'openra/{variant}/{file}'
    base=profiles[recipe];profile=json.loads(json.dumps(base))
    script=base['egg']['scripts']['installation']['script']
    pattern=r"(cat > \.voltra/openra-family\.py <<'([^']+)'\n).*?(\n\2\n)"
    assert len(list(re.finditer(pattern,script,re.S)))==1
    profile['egg']['scripts']['installation']['script']=re.sub(pattern,lambda m:m[1]+code.rstrip()+m[3],script,flags=re.S)
    reverted=json.loads(json.dumps(profile));reverted['egg']['scripts']['installation']['script']=script;assert reverted==base
    staged=out/f'{mod}-recipe.pending.json';staged.write_text(json.dumps({recipe:profile},indent=2)+'\n')
    prior_path=root/f'artifacts/openra-{mod}-native-acceptance.json';prior=json.loads(prior_path.read_text())
    statuses=[]
    for family,count in checks.items():
        for i in range(1,count+1):
            id=f'{family}-{i}'
            statuses.append({'id':id,'status':'pass' if id=='DELIVERY-3' else 'pending','scope':'source fixtures only' if id=='DELIVERY-3' else 'Individual current checklist result unknown; historical aggregate proof is not promoted','evidence':'tools/runtime/test-openra-variants-wave58.py' if id=='DELIVERY-3' else str(prior_path.relative_to(root))})
    variants.append({'recipe':recipe,'mod':mod,'outcome':'partial','staged_unapplied':str(staged.relative_to(root)),'staged_sha256':digest(staged),'prior_proof':{'path':str(prior_path.relative_to(root)),'sha256':digest(prior_path),'inherited_profile_status':base.get('verification'),'aggregate_scope':prior['scope'],'native_stop':prior['native_stop'],'cleanup':prior['cleanup'],'individual_statuses':'unknown: historical proof is aggregate, not all37 checklist results','changed_helper_invalidates_current_native_equivalence':True},'publisher_pin':prior['release'],'resources':base.get('defaults'),'images':base['egg']['docker_images'],'startup':base['egg']['startup'],'readiness':base['egg']['config']['startup'],'stop':base['egg']['config']['stop'],'ordered_controls':base['egg']['variables'],'environment_authority':{'always_applied':{'SERVER_NAME':'Server.Name','SERVER_PORT':'Server.ListenPort allocation-owned','PASSWORD':'Server.Password','PUBLIC':'Server.AdvertiseOnline','SINGLEPLAYER':'Server.EnableSingleplayer','AUTH':'Server.RequireAuthentication','GEOIP':'Server.EnableGeoIP','ANONYMOUS':'Server.ShareAnonymizedIPs','RECORD_REPLAYS':'Server.RecordReplays','SERVER_MAP':'Server.Map only when nonempty'},'seed_only':{},'VERSION':'installation selection; not applied at each start','secret_metadata':'existing PASSWORD metadata preserved verbatim; no schema inferred'},'native_files':['OpenRAData/settings.yaml',f'OpenRAData/maps/{mod}/<version>/*.oramap','OpenRAData/Logs','OpenRAData/Replays'],'licences':{'engine':'OpenRA GPLv3; historical observed publisher artifacts, no new licence audit','commercial_media':'Not bundled or downloaded by dedicated recipe; clients supply required original game assets; no new entitlement gate invented'},'checks':statuses})
report={'wave':58,'scope':'SOURCE ONLY; no native promotion','outcome':'partial','changes':['D2K/CNC validate startup controls without support-directory creation before publisher resolution/acquisition','D2K/CNC resolve version before migration and defer legacy support migration until archive extraction and validation succeed','RA branch retains previous ordering and settings authority'],'verification':{'commands':[{'command':'python -B tools/runtime/test-openra-variants-wave58.py','result':'pass: 3 tests, both variants, mocked network/process/publisher publication'},{'command':'python -B tools/runtime/openra-parity-wave8-tests.py','result':'pass: 5 tests'},{'command':'python -B tools/runtime/test-openra-td-wave10.py','result':'pass: 7 tests'}],'positive_fixture_boundary':'Synthetic archive and extracted publisher files, SHA1 check and publisher.publish mocked; exact emitted helper filenames imported; not native installation or integrity acceptance','go':'skipped: no Go changes; no app build','failures':['Initial rg Windows wildcard path syntax rejected; search narrowed to explicit files. First stager attempt failed on relative output path after writing owned D2K fragment; fixed by resolving output path and safely reran. No test failures.']},'integration_gaps':['Root must integrate only the two staged recipe fragments; canonical overrides were not edited','D2K/CNC still use existing direct launcher/readiness; shared RA runtime/native-console are outside grant. No console/readiness rewrite staged','Shared Go settings eligibility currently grants RA exact recipe/startup only; D2K/CNC typed API integration remains root-owned','Installer OS bootstrap apt-get and helper emission precede Python validation. Guarantee is no game acquisition/config migration for invalid controls/version, not side-effect-free OS bootstrap','Acquisition failure can leave .voltra/openra state directory; temporary payload fixture is cleaned. Support/config files stay untouched','Support migration/publication is not crash-atomic; shared publisher remains outside grant'],'cleanup':{'fixtures':'TemporaryDirectory fixtures removed automatically','native_resources':'none created or accessed; historical receipts say prior fixtures removed, not reverified','operations_running':False,'untouched':['canonical overrides','shared Go','RA runtime','native-console','small-native-install','greenwave55','latest','historical proofs','cache outputs','reference checkout']},'identities':{str(path.relative_to(root)):digest(path) for path in [helper,profiles_path,root/'internal/panel/game_library/scripts/native-release.py',root/'internal/panel/game_library/scripts/small-native-install.py',root/'internal/panel/game_library/scripts/openra-ra-runtime.py',root/'internal/panel/game_settings_openra.go',root/'tools/runtime/test-openra-variants-wave58.py']},'variants':variants,'source_links':['https://github.com/OpenRA/OpenRA/releases/tag/release-20250330','https://www.openra.net/'],'publisher_documentation':'No live lookup needed; pins and claims copied from exact prior native receipts, not claimed current publisher recommendations','boundaries':'No activation, build, services, game process, payload downloads, Docker, SSH, commit, nested agents, browser, player join, WAN or new native acceptance.'}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'report':str(out/'report.json'),'variants':len(variants),'checks_each':len(variants[0]['checks'])}))
