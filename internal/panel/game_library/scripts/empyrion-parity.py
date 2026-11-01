#!/usr/bin/env python3
"""Empyrion-only native YAML authority; reuse shared acquisition/console/processes."""
import importlib.util
import json
from pathlib import Path
import sys


spec = importlib.util.spec_from_file_location('empyrion_legacy', Path(__file__).with_name('space-survival.py'))
legacy = importlib.util.module_from_spec(spec); spec.loader.exec_module(legacy)
BASE_CONFIGURE, BASE_INSTALL, BASE_RUN = legacy.configure, legacy.install, legacy.run
FIELDS = {
    'ServerConfig': {'Srv_Name': 'SERVER_NAME', 'Srv_Description': 'SERVER_DESCRIPTION',
                     'Srv_MaxPlayers': 'MAX_PLAYERS', 'Srv_Public': 'SERVER_PUBLIC',
                     'Srv_Password': 'SERVER_PASSWORD', 'EACActive': 'EAC_ACTIVE',
                     'MaxAllowedSizeClass': 'MAX_ALLOWED_SIZE_CLASS', 'AllowedBlueprints': 'ALLOWED_BLUEPRINTS',
                     'HeartbeatServer': 'SERVER_HEARTBEAT', 'TimeoutBootingPfServer': 'TIMEOUT_BOOTING_PF_SERVER'},
    'GameConfig': {'Seed': 'GAME_SEED', 'GameName': 'GAME_NAME', 'Mode': 'GAME_MODE', 'CustomScenario': 'CUSTOM_SCENARIO'},
}


def preflight(root, env):
    """Reuse shared environment/port parsing, stopping before the YAML dependency."""
    legacy.identity('empyrion', env)
    legacy.engineering.choice(env, 'INSTALL_MODE', 'steam', ('steam', 'operator_files'))
    legacy.engineering.choice(env, 'VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'), ('0', '1'))
    class Parsed(Exception): pass
    previous = legacy.yaml_module
    def dependency_boundary(_): raise Parsed()
    legacy.yaml_module = dependency_boundary
    try:
        try: BASE_CONFIGURE(root, 'empyrion', env)
        except Parsed: return
        raise RuntimeError('Shared Empyrion preflight boundary changed')
    finally: legacy.yaml_module = previous


def preview(root, env):
    """Capture existing shared typed planning without publishing its config writes."""
    expected = legacy.shared.confined(root, Path(root)/'dedicated.yaml')
    captured = []; previous = legacy.shared.write_config
    def capture(base, target, content):
        if Path(base).resolve() != Path(root).resolve() or Path(target).resolve() != expected:
            raise ValueError('Unexpected shared Empyrion planning write')
        captured.append(content)
    legacy.shared.write_config = capture
    try: result = BASE_CONFIGURE(root, 'empyrion', env)
    finally: legacy.shared.write_config = previous
    if len(captured) != 1: raise ValueError('Expected one native YAML plan')
    return result, captured[0]


def plan(root, env, initial=False):
    root = Path(root).resolve(); preflight(root, env)
    target = legacy.shared.confined(root, root/'dedicated.yaml')
    previous = target.read_text(encoding='utf-8-sig') if target.exists() else ''
    result, proposed = preview(root, env)
    yaml = legacy.yaml_module(root)
    # Shared safe composition rejects aliases, duplicate keys and unsafe tags.
    legacy.patch_yaml(root, previous, {})
    old, wanted = yaml.safe_load(previous) or {}, yaml.safe_load(proposed)
    native_env = dict(env)
    for section, keys in FIELDS.items():
        existing = old.get(section, {})
        if not isinstance(existing, dict): raise ValueError('Native Empyrion section must be a mapping')
        if not initial:
            for key, environment in keys.items():
                if key in existing:
                    value = existing[key]
                    if type(value) is not type(wanted[section][key]):
                        raise ValueError('Native Empyrion control must retain its scalar type')
                    native_env[environment] = str(value).lower() if isinstance(value, bool) else str(value)
    if not initial:
        # Validate existing native controls with the SAME shared constraints.
        result, checked = preview(root, native_env)
        wanted = yaml.safe_load(checked)
    updates = {}
    for section, fields in wanted.items():
        if section not in ('ServerConfig', 'GameConfig'): continue
        existing = old.get(section, {})
        updates[section] = {key: value for key, value in fields.items()
                            if (initial or key not in existing) and existing.get(key) != value}
    # Only actual allocations/admin transport remain runtime-managed.
    runtime = {key: wanted['ServerConfig'][key] for key in ('Srv_Port', 'Tel_Enabled', 'Tel_Port')}
    runtime['Tel_Pwd'] = wanted['ServerConfig']['Tel_Pwd']
    updates.setdefault('ServerConfig', {}).update({key: value for key, value in runtime.items()
                                                  if old.get('ServerConfig', {}).get(key) != value})
    updated = legacy.patch_yaml(root, previous, {key: value for key, value in updates.items() if value})
    data = yaml.safe_load(updated)
    argv, _, cwd, log = result
    return target, updated, (argv, [data['ServerConfig'].get('Srv_Password', ''), data['ServerConfig']['Tel_Pwd']], cwd, log)


def configure(root, env, initial=False):
    target, content, result = plan(root, env, initial)
    legacy.shared.write_config(root, target, content)
    return result


def install(root, env):
    root = Path(root).resolve(); preflight(root, env)
    target = legacy.shared.confined(root, root/'dedicated.yaml')
    existed = target.exists()
    if existed: plan(root, env)
    BASE_INSTALL(root, 'empyrion', env)
    configure(root, env, initial=not existed)
    receipt = legacy.shared.confined(root, root/'.voltra/empyrion-parity/native-authority.json')
    legacy.native.private_write(receipt, json.dumps({'native_yaml_existed_before_install': existed,
                                'initial_controls_seeded': not existed, 'runtime_verified': False})+'\n')


def run(root, env):
    root = Path(root).resolve(); preflight(root, env)
    if (root/'dedicated.yaml').exists(): plan(root, env)
    previous_configure, previous_install = legacy.configure, legacy.install
    def scoped_configure(base, game, values):
        if game != 'empyrion': raise ValueError('Empyrion-only adapter')
        return configure(base, values)
    def scoped_install(base, game, values):
        if game != 'empyrion': raise ValueError('Empyrion-only adapter')
        return install(base, values)
    legacy.configure, legacy.install = scoped_configure, scoped_install
    try: return BASE_RUN(root, 'empyrion', env)
    finally: legacy.configure, legacy.install = previous_configure, previous_install


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['install']: install(Path.cwd(), dict(__import__('os').environ))
        elif not sys.argv[1:]: sys.exit(run(Path.cwd(), dict(__import__('os').environ)))
        else: raise ValueError('Unknown Empyrion action')
    except Exception:
        print('Empyrion setup refused; check native YAML, allocations and runtime prerequisites. No success inferred.', file=sys.stderr)
        sys.exit(1)
