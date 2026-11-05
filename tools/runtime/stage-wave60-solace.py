"""Wave60 SOLACE-only unapplied fragment. No native processes or downloads."""
import hashlib, json, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/wave60-solace'
KEY = 'solace_crafting/egg-solace-crafting.json'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def stage():
    OUT.mkdir(parents=True, exist_ok=True)
    canonical = ROOT / 'internal/panel/game_library/overrides.json'
    profile = json.loads(canonical.read_text())[KEY]
    original = json.loads(json.dumps(profile))
    script = profile['egg']['scripts']['installation']['script']
    emitted = OUT / 'emitted'
    emitted.mkdir(exist_ok=True)
    hashes = {}
    for name in ('fantasy-worlds-runtime.py', 'fantasy-worlds-install.py'):
        source = ROOT / 'internal/panel/game_library/scripts' / name
        target = name.replace('-', '_')
        pattern = r"(cat > .voltra/" + re.escape(target) + r" <<'VOLTRA_FANTASY_SOURCE'\n)[\s\S]*?(\nVOLTRA_FANTASY_SOURCE\n)"
        script, count = re.subn(pattern, lambda m: m[1] + source.read_text() + m[2], script)
        assert count == 1, name
        hashes[str(source.relative_to(ROOT))] = sha(source)
    profile['egg']['scripts']['installation']['script'] = script
    for name, content in re.findall(r"cat > .voltra/([^\s]+) <<'VOLTRA_FANTASY_SOURCE'\n([\s\S]*?)\nVOLTRA_FANTASY_SOURCE", script):
        assert '/' not in name
        (emitted / name).write_text(content)
    assert profile['egg']['variables'] == original['egg']['variables']
    fragment = OUT / 'profiles.json'
    fragment.write_text(json.dumps({KEY:profile}, indent=2)+'\n')
    hashes['canonical_input'] = sha(canonical)
    hashes['profiles.json'] = sha(fragment)
    (OUT / 'source-hashes.json').write_text(json.dumps(hashes, indent=2)+'\n')
    return original, profile
if __name__ == '__main__': stage()
