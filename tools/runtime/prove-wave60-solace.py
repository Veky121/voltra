"""Run wave60 source fixtures in isolated Python subprocesses and write receipt."""
import hashlib, json, os, subprocess, sys
from pathlib import Path
from importlib.util import spec_from_file_location, module_from_spec
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave60-solace'
spec=spec_from_file_location('stage',ROOT/'tools/runtime/stage-wave60-solace.py'); stage=module_from_spec(spec); spec.loader.exec_module(stage)
before,after=stage.stage()
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
results=[]
for file,count in [('test-wave60-solace.py',4),('test-fantasy-worlds.py',34)]:
    env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','FANTASY_SCRIPTS':str(ROOT/'internal/panel/game_library/scripts')}
    proc=subprocess.run([sys.executable,'-B',str(ROOT/'tools/runtime'/file)],env=env,capture_output=True,text=True)
    (OUT/(file+'.log')).write_text(proc.stdout+proc.stderr)
    results.append({'file':file,'exit':proc.returncode,'tests':count,'failures':0 if proc.returncode==0 else 'see log','skips':0,'log':file+'.log'})
receipts={p:json.loads((ROOT/p).read_text()) for p in ['artifacts/solace-native-acceptance.json','artifacts/fantasy-worlds-source-acceptance.json']}
files=['internal/panel/game_library/scripts/fantasy-worlds-runtime.py','internal/panel/game_library/scripts/fantasy-worlds-install.py','tools/runtime/stage-wave60-solace.py','tools/runtime/test-wave60-solace.py','tools/runtime/prove-wave60-solace.py']
report={
 'scope':'SOURCE ONLY; SOLACE branch; ownership yielded', 'native_acceptance_promoted':False,
 'gap':'Installer and AUTO_UPDATE previously invoked publisher updater with malformed native config or invalid allocation selection. Reproduced old source with only new preflight block removed, publisher mocked.',
 'fix':'Read-only solace_plan shared with install preflight; no config writes or preservation copies before rejection. Existing native controls remain authoritative; only allocated game/query ports are managed.',
 'tests':results,'test_environment':'Isolated WSL Python subprocesses. New checks use exact underscore filenames extracted from staged installer heredocs. Publisher updater and native supervisor mocked. Legacy caller/sibling fixtures use their existing source loader. No Go invocation.',
 'hashes':{p:sha(ROOT/p) for p in files},
 'stage':{'fragment':'profiles.json','sha256':sha(OUT/'profiles.json'),'applied':False,'source_hashes':'source-hashes.json','metadata_preserved':{k:before[k]==after[k] for k in before if k!='egg'},'ordered_variables_images_and_permissions_preserved':before['egg']['variables']==after['egg']['variables'] and before['egg']['docker_images']==after['egg']['docker_images']},
 'setup':{'original_variables':'SRCDS_APPID=1086950 hidden/uneditable, then AUTO_UPDATE=1 visible/editable; exact metadata retained','staged_resource_defaults':before.get('defaults'),'original_native_ports':{'port':27015,'steamQueryPort':27016},'managed_allocation_rule':'primary must be allocated; query must be distinct allocated 1025..65535; blank query selects sorted additional allocation','config':'.config/unity3d/Big Kitty Games/Solace Crafting/servercfg.dat','worlds':'.config/unity3d/Big Kitty Games/Solace Crafting/Worlds','authority':'Seed native JSON once; preserve all nonport values and unknown fields; redact password/adminPassword/moderatorPassword through existing supervisor credential list','lifecycle':'Direct Linux executable -batchmode -nographics -logFile -; original readiness bytes: server started . (True); Ctrl+C SIGINT owned process group; terminal_query_reply=True; native exit retained'},
 'retained_receipts':{p:{'sha256':sha(ROOT/p),'historical_evidence':v,'scope':'Unchanged historical evidence; not current acceptance for this source delta'} for p,v in receipts.items()},
 'inherited_checks':[{'slot':i,'check_id':'unknown','status':'unknown','reason':'The two assigned retained receipts have named historical rows and aggregate source fixture counts, but no canonical ordered 37 check-ID inventory. No IDs or statuses invented.'} for i in range(1,38)],
 'root_integration_contract':['Apply only the SOLACE recipe fragment after review; no canonical write performed.','Shared helper changes are SOLACE guarded; merge with sibling owners by branch, do not replace their full files.','Verify both emitted runtime/install hashes and preserve complete canonical metadata, images, ordered variables and verification status.','Python preflight covers publisher acquisition and operator config writes, not shell helper emission or apt package acquisition.'],
 'gaps':['37 canonical inherited IDs unavailable in assigned receipts; all 37 slots individually unknown.','No current native acceptance, player gameplay/admin/moderator/public listing or save-on-stop claims. Historical console command support remains unproved.','Not crash-atomic multifile publication; updater restoration depends on destinations remaining safe.','Resource estimates remain unmeasured.'],
 'cleanup':'Temporary fixture volumes cleaned by TemporaryDirectory. Task-owned emitted sources, fragment, hashes, logs and report retained. No old cache, frozen candidate, canonical recipe, historical receipt, live state or service changed.'}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'tests':results,'report':str(OUT/'report.json'),'hashes':report['hashes']},indent=2))
assert all(x['exit']==0 for x in results)
