"""Repeatable exact-recipe source integration. Never executes installers."""
import copy, difflib, hashlib, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'artifacts/game-parity-20261029/root-wave15-source-integration'
BASE = ROOT/'artifacts/game-parity-20261029'
CANON = ROOT/'internal/panel/game_library/overrides.json'
INPUTS = [('stay-in-tarkov','profile.pending.json','stay_in_tarkov'),
          ('league-sandbox','profile.json','league_sandbox'),
          ('modiverse','profile.pending.json','modiverse_owner'),
          ('no-love-lost','integration-profile.pending.json','no_love_lost_owner'),
          ('bedrock-arm','profile.pending.json','bedrock_arm_owner')]
PATTERN = r"cat > (\S+) <<'([^']+)'\n(.*?)\n\2(?:\n|$)"

def digest(data): return hashlib.sha256(data).hexdigest()

def prepare():
    before = json.loads(CANON.read_text(encoding='utf-8-sig'))
    result = copy.deepcopy(before)
    records = []
    for owner, filename, module in INPUTS:
        path = BASE/(owner+'-owner')/filename
        recipe, pending = next(iter(json.loads(path.read_text(encoding='utf-8-sig')).items()))
        old = before[recipe]
        assert pending['egg']['variables'] == old['egg']['variables'], recipe
        assert pending.get('defaults') == old.get('defaults'), recipe
        assert pending['egg']['docker_images'] == old['egg']['docker_images'], recipe
        script = pending['egg']['scripts']['installation']['script']
        payloads = {}
        for target, marker, body in re.findall(PATTERN, script, re.S):
            name = target.strip('"').rsplit('/',1)[-1]
            assert re.fullmatch(r'[A-Za-z0-9_.-]+', name), name
            source = ROOT/'internal/panel/game_library/scripts'/name.replace('_','-')
            payloads[name] = source.read_text(encoding='utf-8-sig') if source.is_file() else body
        assert module+'.py' in payloads
        if owner == 'no-love-lost':
            payloads['installer_gate.py'] = (BASE/'no-love-lost-owner/installer-preflight.py').read_text()
        # Keep the canonical metadata, controls, permissions and all other egg fields.
        merged = copy.deepcopy(old)
        merged['egg']['startup'] = pending['egg']['startup']
        merged['revision'] = 'wave15-'+owner+'-source-v1'
        shell = '#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\n'
        shell += 'if ! command -v python3 >/dev/null; then\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\nfi\n'
        shell += 'work=$(mktemp -d)\ntrap \'rm -rf -- "$work"\' EXIT\n'
        for name, body in payloads.items():
            assert 'VOLTRA_WAVE15_SOURCE' not in body.splitlines()
            shell += f'cat > "$work/{name}" <<\'VOLTRA_WAVE15_SOURCE\'\n'+body.rstrip('\n')+'\nVOLTRA_WAVE15_SOURCE\n'
        code = 'import sys,os;from pathlib import Path;sys.path.insert(0,sys.argv[1]);import '+module+' as g;root=Path.cwd().resolve();env=dict(os.environ);'
        if owner == 'bedrock-arm': code += 'g.preflight(root,env,"install",g.family())'
        elif owner == 'modiverse': code += 'g.plan(root,env);g.steam_template.arguments(root,1549820,env,True,platform="linux");assert g.platform.system()=="Linux" and g.platform.machine().lower() in ("amd64","x86_64")'
        else: code += 'g.preflight(root,env)'
        if owner == 'no-love-lost': code += ';import installer_gate;installer_gate.check(env)'
        if owner == 'stay-in-tarkov':
            code += ';identity=g.legacy.sit_identity(env);local=env.get("SIT_ARCHIVE_PATH","");p=g.legacy.confined(root,local) if local else None;assert p is None or (p.is_file() and g.legacy.release.sha256(p)==identity["sha256"] and (not identity.get("bytes") or p.stat().st_size==identity["bytes"]))'
        shell += "python3 - \"$work\" <<'VOLTRA_WAVE15_PREFLIGHT'\n"+code+'\nVOLTRA_WAVE15_PREFLIGHT\n'
        # Native libraries only after full adapter admission, as in SCUMv3.
        packages = re.findall(r'^apt-get install [^\n]+', script, re.M)
        if packages: shell += 'apt-get update\n'+'\n'.join(dict.fromkeys(packages))+'\n'
        shell += 'mkdir -p .voltra\ncp -- "$work/"* .voltra/\n'
        if 'bundle_debian_python.py' in payloads: shell += 'python3 .voltra/bundle_debian_python.py\n'
        shell += 'python3 .voltra/'+module+'.py install\n'
        merged['egg']['scripts']['installation']['script'] = shell
        result[recipe] = merged
        records.append(dict(recipe=recipe,owner=owner,candidate=str(path.relative_to(ROOT)),candidate_sha256=digest(path.read_bytes()),emitted={n:digest(b.rstrip('\n').encode()) for n,b in payloads.items()},ordered_controls_preserved=True,defaults_images_permissions_preserved=True))
    return before,result,records

if __name__ == '__main__':
    import sys
    OUT.mkdir(parents=True,exist_ok=True)
    before,result,records=prepare()
    snapshot=OUT/'baseline-overrides.json'
    if not snapshot.exists(): snapshot.write_bytes(CANON.read_bytes())
    for row in records:
        recipe=row['recipe']; label=row['owner']
        original=json.loads(snapshot.read_text(encoding='utf-8-sig'))[recipe]
        (OUT/(label+'-exact.diff')).write_text(''.join(difflib.unified_diff(json.dumps(original,indent=2).splitlines(True),json.dumps(result[recipe],indent=2).splitlines(True),fromfile='before/'+recipe,tofile='after/'+recipe)),encoding='utf-8')
    if '--apply' in sys.argv:
        assert json.loads(CANON.read_text(encoding='utf-8-sig')) == before
        CANON.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    (OUT/'integration.json').write_text(json.dumps(records,indent=2)+'\n')
    print('Prepared five exact profiles; applied:', '--apply' in sys.argv, 'changed:',sum(before[k]!=result[k] for k in before))
