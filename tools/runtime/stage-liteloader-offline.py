"""Stage only this exact variant; never edit canonical overrides or execute installer."""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]
RECIPE = 'minecraft/bedrock/LiteLoader-bedrock/egg-LiteLoader-bedrock.json'
OUT = BASE / 'artifacts/game-parity-20261029/liteloader-bootstrap-followup'


def stage():
    catalog = json.loads((BASE / 'internal/panel/game_library/upstream/catalog.json').read_text())
    entry = next(e for e in catalog['entries'] if e['path'] == RECIPE)
    current = json.loads((BASE / 'internal/panel/game_library/overrides.json').read_text())[RECIPE]
    profile = json.loads(json.dumps(current))
    source = (BASE / 'internal/panel/game_library/scripts/liteloader-offline.py').read_text(encoding='utf-8-sig')
    # Preserve canonical Alpine installer image and ash. Bootstrap is emitted only;
    # offline tests never invoke package management or the native payload.
    installation = current['egg']['scripts']['installation']
    if installation['container'] != 'ghcr.io/ptero-eggs/installers:alpine' or installation['entrypoint'] != 'ash':
        raise ValueError('Canonical installer changed; review bootstrap before staging')
    script = "#!/bin/ash\nset -eu\n"
    script += "test -d /mnt/server\ntest -d /mnt/liteloader-payload\n"
    script += "if ! command -v python3 >/dev/null 2>&1; then\n  apk add --no-cache python3\nfi\n"
    script += "python3 - /mnt/server /mnt/liteloader-payload <<'VOLTRA_LITE'\n"
    script += source.split("if __name__ == '__main__':")[0]
    script += "\nimport sys\nprint(json.dumps(install(sys.argv[1], sys.argv[2], os.environ)))\nVOLTRA_LITE\n"
    profile['egg']['scripts']['installation'] = {**installation, 'script': script}
    profile['egg']['variables'] = [v for v in profile['egg']['variables'] if v['env_variable'] != 'BEDROCK_TERMS_ACCEPTED']
    profile['egg']['variables'].append({'name': 'Accept Minecraft terms', 'env_variable': 'BEDROCK_TERMS_ACCEPTED', 'default_value': 'false', 'rules': 'required|string|in:true,false', 'description': 'Explicitly accept https://www.minecraft.net/eula and https://www.minecraft.net/usage-guidelines before offline installation.', 'user_viewable': True, 'user_editable': True, 'field_type': 'text'})
    profile['revision'] = 'liteloader-offline-bootstrap-proposal-v2'
    profile['detail'] = 'Pending integration: preserves Alpine/ash and bootstraps Python3; requires separately reviewed payload mount and stopped-state enforcement. No native acceptance.'
    profile['upstream_sha256'] = entry['sha256']
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'profile.pending.json').write_text(json.dumps({RECIPE: profile}, indent=2) + '\n')
    return profile


if __name__ == '__main__':
    stage()
