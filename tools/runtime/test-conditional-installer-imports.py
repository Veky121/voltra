import ast
import builtins
import contextlib
import hashlib
import importlib
import json
from pathlib import Path
import re
import sys
import tempfile
import types
import unittest
from unittest.mock import patch, Mock

ROOT=Path.cwd()
PROFILES=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())
AUDIT=json.loads((ROOT/'artifacts/game-profile-python-import-audit.json').read_text())
REVIEW=json.loads((ROOT/'artifacts/game-conditional-import-root-review.json').read_text())
COVERED={(x['recipe'],x['module'],x['missing_local_dependency']) for x in REVIEW['reviewed']}
ROWS=[x for x in AUDIT['conditional_dependencies_to_review'] if (x['recipe'],x['module'],x['missing_local_dependency']) not in COVERED]


def bundle(recipe):
    script=PROFILES[recipe]['egg']['scripts']['installation']['script']
    return {Path(name).name:source+'\n' for name,marker,source in re.findall(r"cat\s+>\s*([^\s]+)\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\2(?:\r?\n|$)",script)}


@contextlib.contextmanager
def embedded(recipe, module):
    files=bundle(recipe)
    names={Path(n).stem for n in files if n.endswith('.py')}
    saved={n:sys.modules.pop(n) for n in names if n in sys.modules}
    with tempfile.TemporaryDirectory() as directory:
        folder=Path(directory)
        for name,source in files.items():(folder/name).write_text(source)
        sys.path.insert(0,directory)
        try:yield importlib.import_module(module),folder
        finally:
            sys.path.remove(directory)
            for name in names:sys.modules.pop(name,None)
            sys.modules.update(saved)


def source_function(recipe,module,function,globals):
    source=bundle(recipe)[module+'.py']
    tree=ast.parse(source)
    node=next(n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name==function)
    exec(compile(ast.Module(body=[node],type_ignores=[]),module,'exec'),globals)
    return globals[function]


class ConditionalInstallers(unittest.TestCase):
    def test_barotrauma_actual_install_restores_operator_config_without_proton(self):
        with embedded('barotrauma/egg-barotrauma.json','additional_survival_install') as (module,folder):
            config=folder/'serversettings.xml';config.write_bytes(b'operator bytes');config.chmod(0o640)
            def update(*args,**kwargs):config.write_bytes(b'publisher replacement');return {'fixture_transport_only':True}
            with patch.object(module,'update',side_effect=update):
                self.assertEqual(module.install(folder,'barotrauma'),{'fixture_transport_only':True})
            self.assertEqual(config.read_bytes(),b'operator bytes');self.assertEqual(config.stat().st_mode&0o777,0o640)
            with self.assertRaisesRegex(ValueError,'Unknown reviewed'):module.install(folder,'not-supported')

    def test_survival_kind_guard_preserves_opposite_missing_dependency(self):
        cases=[('v_rising/v_rising_vanilla/egg-v-rising.json','vrising','private_nss'),('valheim/valheim_vanilla/egg-valheim.json','valheim','enshrouded_proton')]
        for recipe,kind,missing in cases:
            with self.subTest(recipe=recipe),embedded(recipe,'valheim_vrising_install') as (module,folder):
                real_import=builtins.__import__;seen=[]
                def guarded(name,*args,**kwargs):
                    seen.append(name)
                    if name==missing:raise AssertionError('Unsupported opposite-kind import reached')
                    if name in ('enshrouded_proton','private_nss'):return types.SimpleNamespace(provision=Mock(return_value={'fixture_only':True}))
                    return real_import(name,*args,**kwargs)
                with patch.object(module,'update',return_value=None),patch('builtins.__import__',side_effect=guarded):
                    module.install(folder,kind,{})
                self.assertNotIn(missing,seen)
                with self.assertRaisesRegex(ValueError,'Unknown survival'):module.install(folder,'starbound',{})

    def test_java_forks_defaults_and_valid_custom_choices_never_select_krypton_build(self):
        cases=[('glowstone',{}, {'VERSION':'custom'}),('magma',{}, {'MC_VERSION':'1.12.2','TAG_VERSION':'custom'}),('mohist',{}, {'PROJECT':'banner','MC_VERSION':'1.20.2','BUILD_NUMBER':'api:1'}),('spongeforge',{}, {'SF_MC_VERSION':'1.20.6-custom'})]
        for kind,default,custom in cases:
            recipe={'glowstone':'minecraft/java/glowstone/egg-glowstone.json','magma':'minecraft/java/magma/egg-magma.json','mohist':'minecraft/java/mohist/egg-mohist.json','spongeforge':'minecraft/java/spongeforge/egg-sponge-forge.json'}[kind]
            with self.subTest(kind=kind),embedded(recipe,'java_fork_install') as (module,folder):
                self.assertFalse(module.resolve(kind,default).get('source_build'))
                with patch.object(module,'github_release',return_value={'version':'fixture','url':'https://example.invalid/server.jar'}),patch.object(module,'mohist_release',return_value={'version':'fixture','url':'https://example.invalid/server.jar'}):
                    self.assertFalse(module.resolve(kind,custom).get('source_build'))

    def test_source_launch_fixed_app_rejects_other_game_before_side_effect(self):
        recipe='gmod/egg-garry-s-mod.json'
        launch=source_function(recipe,'source_next_runtime','launch',{'Path':Path,'re':re})
        for app in ('244311','222860','garbage'):
            with self.assertRaisesRegex(ValueError,'reviewed additional Source'):launch(Path('/unused'),{'SRCDS_APPID':app})
        for recipe in ('gmod/egg-garry-s-mod.json','sourcecoop/egg-source-coop.json','open_fortress/egg-open-fortress.json','contagion/egg-contagion.json'):
            var=next(x for x in PROFILES[recipe]['egg']['variables'] if x['env_variable']=='SRCDS_APPID')
            self.assertIn('in:'+var['default_value'],var['rules'])

    def test_java_shared_pack_helpers_work_without_unreachable_provider_imports(self):
        for recipe in ('minecraft/java/glowstone/egg-glowstone.json','minecraft/java/krypton/egg-krypton.json','minecraft/java/magma/egg-magma.json','minecraft/java/mohist/egg-mohist.json','minecraft/java/spongeforge/egg-sponge-forge.json'):
            with self.subTest(recipe=recipe),embedded(recipe,'minecraft_pack_install') as (module,folder):
                target=module.target(folder,'operator.txt');target.write_bytes(b'operator')
                self.assertEqual(module.digest(target),hashlib.sha256(b'operator').hexdigest())
                with self.assertRaises(ValueError):module.target(folder,'../escape')
                caller=bundle(recipe)['java_fork_install.py']
                self.assertIn('from minecraft_pack_install import target, publish, digest',caller)
                self.assertNotIn('minecraft_pack_install.acquire(',caller)


def review_row(row):
    recipe,module,dependency=row['recipe'],row['module'],row['missing_local_dependency'];files=bundle(recipe);source=files[module+'.py'];tree=ast.parse(source)
    guards=[]
    def walk(node,stack=(),function=None):
        if isinstance(node,ast.FunctionDef):function=node.name
        if isinstance(node,ast.If):
            for child in node.body:walk(child,stack+(ast.unparse(node.test),),function)
            for child in node.orelse:walk(child,stack+('NOT ('+ast.unparse(node.test)+')',),function)
            return
        imported=isinstance(node,ast.ImportFrom) and node.module==dependency or isinstance(node,ast.Import) and any(x.name==dependency for x in node.names)
        if imported:guards.append({'function':function,'line':node.lineno,'guards':list(stack)})
        for child in ast.iter_child_nodes(node):walk(child,stack,function)
    walk(tree)
    if module=='additional_survival_install':reason='Only install(game=enshrouded) imports Proton. This recipe calls another fixed entrypoint, or Barotrauma with game=barotrauma; shared private_bytes imports do not call install.'
    elif module=='valheim_vrising_install':reason='Install accepts only valheim/vrising. Missing dependency belongs to opposite game kind, or module is an unused shared embed under stationeers/wurm/starbound fixed entrypoint. Variant choice does not change game kind.'
    elif module=='source_next_runtime':reason='Missing import is guarded by a different fixed SRCDS_APPID (244310 OpenFortress or293030 Contagion Windows); recipe appid validation is a singleton. Default and valid choices cannot change app identity.'
    elif module=='java_fork_install':reason='source_build is returned only by resolve(kind=krypton,repaired_source); this fixed glowstone/magma/mohist/spongeforge entrypoint selects downloadable publisher release, including its supported custom versions.'
    elif module=='minecraft_pack_install':reason='Java fork caller imports only target/publish/digest and defines its own acquire. Missing native download/extract imports belong to unused pack-provider functions, not Java fork execution.'
    else:raise AssertionError('Unreviewed family '+module)
    script=PROFILES[recipe]['egg']['scripts']['installation']['script'];tail=script.rsplit('VOLTRA_',1)[-1]
    return {**row,'classification':'not_reachable_via_reviewed_recipe_entrypoint','reason':reason,'import_guards':guards,'installer_call_lines':[l for l in script.splitlines() if l.startswith(('python3 ','PYTHONPATH='))][-5:],'module_sha256':hashlib.sha256(source.encode()).hexdigest(),'missing_dependency_still_absent':not any(Path(n).stem==dependency for n in files),'limitation':'Offline guard/caller review and bounded fixtures; not exhaustive arbitrary environment/code tampering, network installation or native success.'}


if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ConditionalInstallers))
    reviewed=[review_row(row) for row in ROWS]
    report={'scope':'Exact current embedded module/caller/guard review excluding root13rows. External Steam/provision boundaries are mocked only in explicit offline fixtures; no native/game success inferred.','audit_sha256':hashlib.sha256((ROOT/'artifacts/game-profile-python-import-audit.json').read_bytes()).hexdigest(),'reviewed_rows':len(reviewed),'fixtures_run':result.testsRun,'fixture_failures':len(result.failures),'fixture_errors':len(result.errors),'confirmed_reachable_missing_dependency_bugs':[],'reviewed':reviewed}
    print('CONDITIONAL_IMPORT_REPORT='+json.dumps(report))
    sys.exit(0 if result.wasSuccessful() else 1)
