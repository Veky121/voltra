"""STK source fixtures only. No game process, socket, HTTP, or lease."""
import importlib.util
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[2]
HELPERS = REPO / 'internal/panel/game_library/scripts'
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HELPERS / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
load('steam_template','steam-template.py')
load('native_console','native-console.py')
load('native_config','native-config.py')
load('small_games_family_runtime','small-games-family-runtime.py')
stk = load('stk_runtime','stk-runtime.py')
STOCK = b'''<?xml version="1.0"?>
<config>
<!-- operator and publisher comments retained -->
<network-ports server-discovery-port="2757" client-port="2758" server-port="2759" extra="keep"/>
<physics unknown="preserve" />
</config>
'''

class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root/'stk/data').mkdir(parents=True)
        (self.root/'stk/bin').mkdir()
        (self.root/'stk/bin/supertuxkart').write_bytes(b'not an executable, never launched')
        self.stock = self.root/'stk/data/stk_config.xml'
        self.stock.write_bytes(STOCK)
        self.operator = self.root/'config.xml'
        self.operator.write_bytes(b'operator server configuration remains untouched')
        self.environment = {'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,2757',
                            'DISCOVERY_PORT':'2757','SERVER_NAME':'STK literal "name"',
                            'MODE':'5','DIFFICULTY':'3','MAX_PLAYERS':'24','MOTD':'literal ; motd'}

    def tearDown(self):
        self.temp.cleanup()

    @property
    def generated(self):
        return self.root/'stk/data'/stk.GENERATED

    def test_original_controls_and_supported_config_override(self):
        cwd, argv, child, stop, _, ready = stk.configure(self.root,self.environment)
        self.assertEqual(cwd,self.root/'stk')
        for value in ['--port=28000','--lan-server=STK literal "name"','--mode=5',
                      '--difficulty=3','--max-players=24','--motd=literal ; motd',
                      '--no-graphics','--network-console','--stk-config='+stk.GENERATED]:
            self.assertIn(value,argv)
        self.assertEqual(child['SUPERTUXKART_DATADIR'],str(self.root/'stk/data'))
        self.assertEqual(stop,'quit');self.assertEqual(ready,'Available command:')
        self.assertEqual(self.stock.read_bytes(),STOCK)
        self.assertEqual(self.operator.read_bytes(),b'operator server configuration remains untouched')
        updated = self.generated.read_bytes()
        self.assertIn(b'server-discovery-port="2757"',updated)
        self.assertIn(b'server-port="28000"',updated)
        self.assertIn(b'client-port="2758"',updated)
        self.assertEqual(updated,STOCK.replace(b'server-port="2759"',b'server-port="28000"'))

    def test_auto_secondary_uses_selected_allocations_only(self):
        primary, discovery = stk.select_ports({**self.environment,'VOLTRA_ALLOCATED_PORTS':'28000,28100,28009','DISCOVERY_PORT':''})
        self.assertEqual((primary,discovery),(28000,28009))
        self.assertEqual(stk.select_ports({**self.environment,'VOLTRA_ALLOCATED_PORTS':'28000,28100,28009','DISCOVERY_PORT':'28100'}),(28000,28100))

    def test_custom_discovery_prints_actionable_client_warning(self):
        output=io.StringIO()
        with redirect_stdout(output):
            stk.configure(self.root,{**self.environment,'DISCOVERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001'})
        self.assertIn('custom discovery UDP port 28001',output.getvalue())
        self.assertIn('matching client discovery',output.getvalue())
        self.assertIn('not verified',output.getvalue())

    def test_allocation_conflicts_fail_before_writes(self):
        cases = [{'VOLTRA_ALLOCATED_PORTS':'28000'}, {'VOLTRA_ALLOCATED_PORTS':'28000,28000'},
                 {'DISCOVERY_PORT':'28000'}, {'DISCOVERY_PORT':'29000'}, {'DISCOVERY_PORT':'0'},
                 {'DISCOVERY_PORT':' 2757'}, {'SERVER_PORT':'028000'}, {'VOLTRA_ALLOCATED_PORTS':'28001,2757'}]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                stk.configure(self.root,{**self.environment,**changes})
            self.assertFalse(self.generated.exists())
            self.assertFalse((self.root/'.voltra').exists())

    def test_client_origin_port_unchanged_and_conflicting_listeners_refused(self):
        for primary, discovery in [(2758,28000),(28000,2758)]:
            with self.assertRaisesRegex(ValueError,'client-port'):
                stk.network_config(STOCK,primary,discovery)
        updated,values=stk.network_config(STOCK,28000,28001)
        self.assertEqual(values['client-port'],2758)
        self.assertIn(b'client-port="2758"',updated)

    def test_malformed_or_ambiguous_engine_xml_denied(self):
        for source in [b'<wrong/>',b'<config/>',STOCK.replace(b'</config>',b'<network-ports/></config>'),
                       STOCK.replace(b'client-port="2758"',b'client-port="2757"'),
                       b'<!DOCTYPE config><config/>',STOCK.replace(b'/>',b'>',1),b'x'*(stk.MAX_XML+1)]:
            with self.subTest(source=source[:40]), self.assertRaises(ValueError):
                stk.network_config(source,28000,2757)

    def test_config_filename_and_text_guards_precede_publication(self):
        for changes in [{'CONFIG_NAME':'../bad.xml'},{'SERVER_NAME':'bad\nname'},{'MAX_PLAYERS':'25'}]:
            with self.assertRaises(ValueError):
                stk.configure(self.root,{**self.environment,**changes})
            self.assertFalse(self.generated.exists())

    def test_unowned_or_modified_managed_config_not_overwritten(self):
        self.generated.write_bytes(b'operator file')
        with self.assertRaisesRegex(ValueError,'unowned'):
            stk.configure(self.root,self.environment)
        self.assertEqual(self.generated.read_bytes(),b'operator file')
        self.generated.unlink()
        stk.configure(self.root,self.environment)
        self.generated.write_bytes(b'modified generated file')
        with self.assertRaisesRegex(ValueError,'operator-modified'):
            stk.configure(self.root,self.environment)
        self.assertEqual(self.generated.read_bytes(),b'modified generated file')

    def test_idempotence_and_updated_ports_preserve_mode_ownership(self):
        stk.configure(self.root,self.environment)
        os.chmod(self.generated,0o640)
        before = self.generated.stat()
        stk.configure(self.root,self.environment)
        self.assertEqual(self.generated.stat().st_mtime_ns,before.st_mtime_ns)
        changed = {**self.environment,'VOLTRA_ALLOCATED_PORTS':'28000,28001','DISCOVERY_PORT':'28001'}
        stk.configure(self.root,changed)
        after = self.generated.stat()
        self.assertEqual(stat.S_IMODE(after.st_mode),stat.S_IMODE(before.st_mode))
        self.assertEqual((after.st_uid,after.st_gid),(before.st_uid,before.st_gid))
        self.assertIn(b'server-discovery-port="28001"',self.generated.read_bytes())
        self.assertEqual(self.stock.read_bytes(),STOCK)

    def test_publication_failure_rolls_back_both_managed_files(self):
        stk.configure(self.root,self.environment)
        receipt=self.root/'.voltra/stk-discovery.json'
        before=(self.generated.read_bytes(),receipt.read_bytes())
        original=stk.os.replace
        failed=False
        def replace(source,target):
            nonlocal failed
            if Path(target)==receipt and not failed:
                failed=True
                raise OSError('fixture receipt rename failed')
            return original(source,target)
        with patch.object(stk.os,'replace',side_effect=replace):
            with self.assertRaisesRegex(OSError,'receipt rename'):
                stk.configure(self.root,{**self.environment,'DISCOVERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001'})
        self.assertEqual((self.generated.read_bytes(),receipt.read_bytes()),before)

    def test_symlink_managed_leaf_denied_without_touching_destination(self):
        other=self.root/'operator.xml';other.write_bytes(b'operator bytes')
        try:self.generated.symlink_to(other)
        except OSError:self.skipTest('Windows host lacks symlink permission; Linux fixture pending')
        with self.assertRaisesRegex(ValueError,'symlinks'):
            stk.configure(self.root,self.environment)
        self.assertEqual(other.read_bytes(),b'operator bytes')

    def test_stage_preserves_current_shared_helpers_and_original_controls(self):
        program=r'''
import fs from 'node:fs';import assert from 'node:assert/strict';
import {stageStkProfile} from './tools/runtime/stage-stk-profile.mjs';
const key='SuperTuxKart/egg-super-tux-kart.json';
const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[key];
const profile=stageStkProfile(current),again=stageStkProfile(profile);
assert.deepEqual(profile,again);
assert.equal(profile.required_ports,2);
assert.equal(profile.defaults.port,2759);
assert.equal(profile.verification,current.verification);
assert.equal(profile.detail,'Uses separate game and LAN discovery ports. Native startup, discovery and clean shutdown are not yet verified.');
assert(![profile.detail,...profile.setup_steps].join('\n').includes('--stk-config'));
assert(![profile.detail,...profile.setup_steps].join('\n').includes('automatic review'));
assert.deepEqual(profile.egg.variables.filter(v=>v.env_variable!=='DISCOVERY_PORT'),current.egg.variables.filter(v=>v.env_variable!=='DISCOVERY_PORT'));
assert(profile.port_rules.some(rule=>rule.environment==='DISCOVERY_PORT'&&rule.allocated_value&&rule.auto_allocate&&rule.exclude_primary&&rule.count===2));
assert(profile.port_rules.some(rule=>rule.environment==='DISCOVERY_PORT'&&JSON.stringify(rule.exclude_ports)==='[2758]'));
assert.equal(profile.egg.variables.find(v=>v.env_variable==='DISCOVERY_PORT').default_value,'2757');
const script=profile.egg.scripts.installation.script;
assert(script.includes(fs.readFileSync('internal/panel/game_library/scripts/stk-runtime.py','utf8')));
assert(script.includes(fs.readFileSync('internal/panel/game_library/scripts/native-release.py','utf8')));
assert.equal(profile.egg.startup,'exec python3 .voltra/stk_runtime.py');
'''
        result=subprocess.run(['node','--input-type=module','-e',program],cwd=REPO,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__':unittest.main(verbosity=2)
