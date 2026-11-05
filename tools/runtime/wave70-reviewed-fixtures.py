"""Retained wave69 fixtures rerun in a disposable WSL source tree only."""
import importlib.util, json, pathlib, shutil, subprocess, sys, tempfile, hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave70-reviewed-consolidation'
def h(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    assert sys.platform=='linux'
    spec=importlib.util.spec_from_file_location('integration',ROOT/'tools/runtime/wave70-reviewed-consolidation.py')
    integration=importlib.util.module_from_spec(spec);spec.loader.exec_module(integration)
    packet=json.loads((OUT/'integration-packet.json').read_bytes())
    merged=json.loads((OUT/'canonical.pending.json').read_bytes())
    drivers=['gta-migration-stage','proton-publication-stage','srb2-target-stage-test','bedrock-arm-proof-run','rehlds-admission-test','gtac-ragecoop-proof-run','legacy-gta-writer-proof-run','cfx-writer-proof-run']
    results=[]
    with tempfile.TemporaryDirectory(prefix='voltra-wave70-') as temp:
        root=pathlib.Path(temp)
        paths=list((ROOT/'tools/runtime').glob('wave69-*.py'))+[ROOT/'tools/runtime/embedded-python.mjs']+list((ROOT/'internal/panel/game_library/scripts').rglob('*'))
        paths += [ROOT/'artifacts/game-parity-20261029/root-source-regression-wave68/source-before.json']
        paths += list((ROOT/'artifacts/game-parity-20261029/helper-copy-review-wave68').glob('review-*/report.json'))
        for p in paths:
            if not p.is_file(): continue
            dst=root/p.relative_to(ROOT);dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dst)
        cat=root/'internal/panel/game_library/overrides.json';cat.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(OUT/'canonical.before.json',cat)
        for driver in drivers:
            run=subprocess.run([sys.executable,'-I','-B',str(root/'tools/runtime'/('wave69-'+driver+'.py'))],capture_output=True,text=True,timeout=120)
            results.append(dict(driver=driver,exit_code=run.returncode,stdout=run.stdout,stderr=run.stderr))
            assert run.returncode==0, results[-1]
        # Match every regenerated selected emitted helper to the integrated body.
        matched=set()
        for p in (root/'artifacts/game-parity-20261029').glob('wave69-*/*.json'):
            if p.name=='report.json':continue
            proposals=json.loads(p.read_bytes())
            for recipe,profile in proposals.items():
                if recipe not in merged:continue
                bodies=integration.modules(integration.script(profile))
                for pin in packet['authority_pins']:
                    if pin['recipe']==recipe and hashlib.sha256(bodies[pin['helper']].encode()).hexdigest()==pin['after']:
                        actual=integration.modules(integration.script(merged[recipe]))[pin['helper']]
                        assert actual==bodies[pin['helper']]
                        matched.add((recipe,pin['helper']))
        assert len(matched)==24,len(matched)
        spec=importlib.util.spec_from_file_location('migration',root/'tools/runtime/wave69-gta-migration-tests.py')
        migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
        before=json.loads(cat.read_bytes());combined=[]
        for recipe in ['gta/altv/egg-alt--v.json','gta/ragemp/egg-rage--m-p.json','gta/samp/egg-s-a--m-p.json']:
            combined.extend(migration.run(recipe.split('/')[1],integration.modules(integration.script(before[recipe])),integration.modules(integration.script(merged[recipe]))))
        results.append(dict(driver='merged-migration-and-writer-bodies',passed=len(combined),exit_code=0))
    receipt=dict(fixtures=results,selected_helpers_matched=24,temporary_tree_removed=not root.exists(),boundary='Isolated WSL mocked emitted entrypoints; no shell installer, native game, acquisition, services, Docker, SSH or application build',failed_checks=[])
    (OUT/'fixture-results.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(dict(drivers=len(drivers),selected_helpers_matched=24,merged_migration_cases=len(combined),cleanup=not root.exists())))
if __name__=='__main__':main()
