"""Stage exactly one Canvas profile. Never modifies overrides or runtime."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEY = 'minecraft/java/canvas-mc/egg-canvas-mc.json'


def stage():
    profile = copy.deepcopy(json.loads((ROOT / 'internal/panel/game_library/overrides.json').read_text())[KEY])
    egg = profile['egg']
    original = json.loads((ROOT / 'tools/runtime/fixtures/canvasmc/original-controls.json').read_text())
    count = len(original['variables'])
    assert [v['env_variable'] for v in egg['variables'][:count]] == [v['env_variable'] for v in original['variables']]
    egg['variables'][:count] = original['variables']
    script = egg['scripts']['installation']['script']
    invocation = 'python3 .voltra/hybrid_java_install.py canvas 2>&1 | tee .voltra/hybrid-java-install.log'
    assert script.count(invocation) == 1
    helper = (ROOT / 'internal/panel/game_library/scripts/canvasmc-install.py').read_text()
    script = script.replace(invocation, "cat > .voltra/canvasmc_install.py <<'VOLTRA_CANVASMC_SOURCE'\n" + helper + "\nVOLTRA_CANVASMC_SOURCE\npython3 .voltra/canvasmc_install.py 2>&1 | tee .voltra/canvasmc-install.log")
    egg['scripts']['installation']['script'] = script
    # Every original variable row, including duplicates and permissions, is retained.
    egg['variables'].append(dict(name='Reviewed artifact SHA256', env_variable='DOWNLOAD_SHA256', default_value='', description='Required for non-pinned Canvas builds. Obtain and review independently before installation.', user_viewable=True, user_editable=True, rules='nullable|string|size:64', field_type='text'))
    egg['voltra']['java_config']['required_major'] = 25
    # Native properties become authoritative after first seed. No boot-time rewrite.
    egg['config']['files'] = '{}'
    profile['revision'] = 'canvasmc-parity-source-v2'
    profile['verification'] = 'not_verified'
    profile['detail'] = 'Source and offline fixtures only. Five native gates pending root integration and isolated acceptance.'
    profile['setup_steps'] += [
        'Current Canvas requires Java 25 and Folia-compatible plugins. Reload is disabled; restart after plugin/config changes.',
        'Latest defaults intentionally resolve to the reviewed 26.3 build 991 pin, not the newest publisher build. Other builds require reviewed DOWNLOAD_SHA256. Historical version/build identity must be checked against native bootstrap logs.',
        'server.properties is seeded once using SERVER_PORT; later settings are file-authoritative. Keep server-port aligned with allocations manually. Query and RCON remain opt-in and require additional explicit allocations and secret configuration.',
    ]
    output = ROOT / 'artifacts/game-parity-20261029/canvasmc-profile.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({KEY: profile}, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    stage()
