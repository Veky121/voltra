"""Stage only reviewed writer/wrapper embeds from current profiles, offline."""
import json
from pathlib import Path
import re

BASE = Path(__file__).resolve().parents[2]
SCRIPTS = BASE/'internal/panel/game_library/scripts'
OUT = BASE/'artifacts/game-parity-20261029'
overrides = json.loads((BASE/'internal/panel/game_library/overrides.json').read_text(encoding='utf-8'))
recipes = {
    'ark_survival_ascended/egg-ark-survival-ascended.json': ('arkascended', {'native_config.py': 'native-config.py', 'arkascended.py': 'arkascended.py'}),
    'astroneer/egg-astroneer-dedicated-server.json': ('astroneer', {'native-config.py': 'native-config.py', 'astroneer-parity.py': 'astroneer-parity.py'}),
}
for recipe, (name, sources) in recipes.items():
    profile = json.loads(json.dumps(overrides[recipe]))
    script = profile['egg']['scripts']['installation']['script']
    for installed, source in sources.items():
        pattern = r"(cat > \.voltra/" + re.escape(installed) + r" <<'([^']+)'\n)(.*?)(\n\2(?=\n|$))"
        text = (SCRIPTS/source).read_text(encoding='utf-8').rstrip('\n')
        def replace(match):
            if match[2] in text.splitlines():
                raise ValueError('Heredoc collision')
            return match[1] + text + match[4]
        script, count = re.subn(pattern, replace, script, flags=re.S)
        if count != 1:
            raise ValueError('Expected one embedded helper: ' + installed)
    profile['egg']['scripts']['installation']['script'] = script
    (OUT/(name+'-ini-profile.json')).write_text(json.dumps({recipe: profile}, indent=2)+'\n', encoding='utf-8')
old = sorted(k for k, p in overrides.items() if k not in recipes and
             re.search(r'def patch_ini\(content, sections\):', p.get('egg', {}).get('scripts', {}).get('installation', {}).get('script', '')))
(OUT/'ini-writer-old-embeds.json').write_text(json.dumps(old, indent=2)+'\n', encoding='utf-8')
print('Staged two current-profile fragments; other old embedded recipes:', len(old))
