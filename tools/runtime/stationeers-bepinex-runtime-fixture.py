"""Offline emitted-layout regression. No native binary is executed."""
from pathlib import Path
import os
import tempfile
from unittest.mock import patch
import stationeers_bepinex_owner as owner
import stationeers_wurm_starbound_runtime as runtime
import stationeers_console_compat as compat

env = {'VOLTRA_STATIONEERS_VARIANT': 'bepinex', 'STATIONEERS_MOD_FRAMEWORK': 'launchpad',
       'SERVER_PORT': '27016', 'UPDATE_PORT': '27014', 'VOLTRA_ALLOCATED_PORTS': '27014,27016'}
native = b'\xef\xbb\xbf<?xml version="1.0" encoding="utf-8"?>\r\n<SettingData><!-- keep -->\r\n<ServerName>Operator &amp; name</ServerName><ServerMaxPlayers>7</ServerMaxPlayers><AutoSave>false</AutoSave><SaveInterval>777</SaveInterval><ServerVisible>false</ServerVisible><AutoPauseServer>true</AutoPauseServer><UPNPEnabled>true</UPNPEnabled><ServerPassword>file-password</ServerPassword><ServerAuthSecret>admin-secret</ServerAuthSecret><Unknown><row>1</row><row>2</row></Unknown></SettingData>\r\n'
checks = []
with tempfile.TemporaryDirectory() as work:
    root = Path(work)
    for name in ('rocketstation_DedicatedServer.x86_64', 'libdoorstop.so', 'BepInEx/core/BepInEx.Preloader.dll'):
        path = root/name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'fixture only')
        path.chmod(0o700)
    settings = root/'setting.xml'
    # Only console shim verification is mocked. Real emitted configure builds argv.
    with patch.object(compat, 'native_preload', return_value='fixture-preload'):
        first = owner.configure(root, 'stationeers', env)[0]
        assert 'ServerName' in first and not settings.exists()
        settings.write_bytes(native)
        for edit in (native, native.replace(b'Operator &amp; name', b'Edited name').replace(b'777', b'888')):
            settings.write_bytes(edit)
            for boot in range(2):
                argv, environment, stop, credentials, options = owner.configure(root, 'stationeers', {
                    **env, 'SERVER_NAME': 'stale env', 'MAX_PLAYERS': '22', 'SAVE_INTERVAL': '300',
                    'SERVER_PASSWD': 'stale-password', 'AUTOSAVE': 'true', 'UPNP': 'false'})
                assert argv[argv.index('-settings')+1:] == ['StartLocalHost','true','GamePort','27016','UpdatePort','27014']
                assert argv[argv.index('-file'):argv.index('-settings')] == ['-file','start','stationeers_1','Lunar']
                assert settings.read_bytes() == edit
                assert 'file-password' in credentials and 'admin-secret' in credentials
                assert environment['DOORSTOP_ENABLED'] == '1' and stop == 'quit'
                assert options['ready_marker'] == b'World load complete'
        argv = owner.configure(root, 'stationeers', {**env,'WORLD_NAME':'','SAVE_NAME':'operator save','UPDATE_PORT':'12345'})[0]
        assert argv[argv.index('-file'):argv.index('-settings')] == ['-file','start','operator save']
        assert argv[-4:] == ['GamePort','27016','UpdatePort','27014']
        for bad in ({**env,'VOLTRA_ALLOCATED_PORTS':'27016'}, {**env,'SERVER_PORT':'9999'}):
            try: owner.configure(root, 'stationeers', bad)
            except ValueError: pass
            else: raise AssertionError('Unallocated launch accepted')
    checks.append('real emitted configure: first boot, repeated boots/operator edits, all seven managed scalar exclusions, ports/fallback, world/save selection, loader/supervisor preservation, secret redaction inputs')
    for name in ('saves/world.save','mods/operator.bin','BepInEx/config/plugin.cfg','modconfig.xml'):
        path=root/name; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(b'operator\x00bytes')
    protected = {str(p.relative_to(root)):p.read_bytes() for name in owner.PROTECTED for p in ([root/name] if (root/name).is_file() else (root/name).rglob('*')) if p.is_file()}
    for mode in ('update','reinstall'):
        for fail in (False, True):
            def acquisition(*args):
                settings.write_text('publisher overwrite')
                (root/'saves/world.save').write_text('overwrite')
                (root/'mods/new').write_text('new')
                (root/'BepInEx/config/plugin.cfg').unlink()
                if fail: raise RuntimeError('mock acquisition failure')
                return {'mock':mode}
            with patch.object(owner, 'shared_install', side_effect=acquisition):
                try: result=owner.install(root,{**env,'VALIDATE':str(mode=='reinstall').lower()})
                except RuntimeError: assert fail
                else: assert not fail and result == {'mock':mode}
            for name,data in protected.items(): assert (root/name).read_bytes()==data
            assert not (root/'mods/new').exists()
            assert not list((root/'.voltra/stationeers-bepinex').iterdir())
    checks.append('mocked update/reinstall success/failure restore exact protected bytes and clean backup')
    # Exercise the automatic-update entry point using the same emitted modules.
    previous_cwd = Path.cwd()
    os.chdir(root)
    try:
        with patch.dict(os.environ, {**env,'VOLTRA_NATIVE_FAMILY':'stationeers','VOLTRA_STEAM_AUTO_UPDATE':'1'}, clear=True), patch.object(owner,'install',return_value={'mock':True}) as update, patch.object(runtime,'main',return_value=17):
            assert owner.main() == 17 and update.call_count == 1
            assert os.environ['VOLTRA_STEAM_AUTO_UPDATE'] == '0'
        with patch.dict(os.environ, {**env,'VOLTRA_STEAM_AUTO_UPDATE':'1'}, clear=True), patch.object(owner,'install',side_effect=RuntimeError('mock update failure')), patch.object(runtime,'main') as supervisor:
            try: owner.main()
            except RuntimeError: pass
            else: raise AssertionError('Failed update reached launch')
            assert not supervisor.called
    finally:
        runtime.configure = owner._configure
        os.chdir(previous_cwd)
    checks.append('automatic update entry point installs once, disables shared duplicate update, returns supervisor result; failed update never launches')
    bad_xml = [b'<broken', b'<Settings/>', b'<!DOCTYPE a><SettingData/>',
               b'<SettingData><ServerName>a</ServerName><servername>b</servername></SettingData>',
               b'<SettingData><Other/><Other/></SettingData>',
               ('<SettingData/>').encode('utf-16'),
               b'<SettingData>'+b'<x>'*128+b'</x>'*128+b'</SettingData>',
               b'<SettingData a="1" a="2"/>', b'<SettingData/>trailing', b'\xff']
    for data in bad_xml:
        settings.write_bytes(data)
        with patch.object(owner,'shared_install',side_effect=AssertionError('acquisition before refusal')) as acquire:
            try: owner.install(root,env)
            except (ValueError,owner.ET.ParseError): pass
            else: raise AssertionError('Unsafe XML accepted')
            assert not acquire.called and settings.read_bytes()==data
    checks.append('wrong root, duplicate/case variant, malformed, DTD, UTF16, depth, duplicate attributes, trailing data and invalid UTF8 refuse before acquisition; bytes unchanged')
print('\n'.join('PASS '+check for check in checks))
