"""Offline tests of exact generated installer and operator-only publication."""
import importlib.util,json,os,subprocess,sys,tempfile,hashlib,shutil
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('stage',ROOT/'tools/runtime/hogwarp-followup-stage.py');stage=importlib.util.module_from_spec(spec);spec.loader.exec_module(stage)
a,b,modules=stage.emit()
assert a['defaults']==b['defaults'] and a['egg']['variables']==b['egg']['variables'] and a['egg']['docker_images']==b['egg']['docker_images']
assert a['egg']['config']==b['egg']['config']
with tempfile.TemporaryDirectory() as td:
    td=Path(td); emitted=td/'emitted';emitted.mkdir()
    for n,data in modules.items():(emitted/n).write_bytes(data)
    sys.path.insert(0,str(emitted));import hogwarp_owner as h,steam_template
    root=td/'server';root.mkdir()
    pe=bytearray(80);pe[:2]=b'MZ';pe[60:64]=(64).to_bytes(4,'little');pe[64:70]=b'PE\0\0\x64\x86'
    (root/'Server.Loader.exe').write_bytes(pe)
    cfg=b'{"ApiKey":"fixture-secret","Port":11778,"Name":"native","MaxPlayer":4,"Description":"", "IconUrl":""}'
    (root/'config.json').write_bytes(cfg)
    (root/'world.operator').write_bytes(b'world');(root/'mods').mkdir();(root/'mods/operator').write_bytes(b'mod')
    env={**os.environ,'ACQUISITION_MODE':'operator','SERVER_PORT':'11778','VOLTRA_ALLOCATED_PORTS':'11778','VOLTRA_HOGWARP_ROOT':str(root)}
    script=stage.OUT/'install-emitted.sh'
    def snapshot():return {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
    before=snapshot()
    for changes in ({'ACQUISITION_MODE':'publisher'},{'OPERATOR_ARCHIVE':'payload.zip'},{'SERVER_PORT':'42'}):
        result=subprocess.run(['bash',str(script)],env=env|changes,capture_output=True)
        assert result.returncode and snapshot()==before,(result.stderr,changes)
    result=subprocess.run(['bash',str(script)],env=env,capture_output=True)
    assert result.returncode==0,result.stderr
    assert all((root/'.voltra'/n).read_bytes()==data for n,data in modules.items())
    first=snapshot()
    result=subprocess.run(['bash',str(script)],env=env,capture_output=True)
    assert result.returncode==0 and snapshot()==first,result.stderr
    # Full startup syntax and actual import path, missing payload must refuse.
    command=b['egg']['startup'].replace('/home/container/.voltra',str(root/'.voltra'))
    (root/'Server.Loader.exe').unlink();unchanged=snapshot()
    result=subprocess.run(['bash','-c',command],cwd=root,env=env,capture_output=True)
    assert result.returncode and b'SyntaxError' not in result.stderr and snapshot()==unchanged,result.stderr
    (root/'Server.Loader.exe').write_bytes(pe)
    # Inject a single write failure after another helper was replaced. Restore
    # old helper and remove new destination; payload stays byte-identical.
    previous=snapshot();real=steam_template._publish;calls=[0]
    def fail_once(*args,**kwargs):
        calls[0]+=1
        if calls[0]==2:raise OSError('injected publication error')
        return real(*args,**kwargs)
    with patch.object(steam_template,'_publish',side_effect=fail_once):
        try:h.install(root,env,{'aaa.py':b'new','hogwarp_owner.py':b'changed'});raise AssertionError('failure not raised')
        except OSError:pass
    assert snapshot()==previous
    # Symlink module/config destinations are refused before publication.
    (root/'.voltra/aaa.py').symlink_to(root/'world.operator');previous=snapshot()
    try:h.install(root,env,{'aaa.py':b'bad'});raise AssertionError('symlink accepted')
    except ValueError:pass
    assert snapshot()==previous
print('PASS: exact emitted shell imports/installer success; publisher/archive/port refusal without writes; helper repeatability; actual startup import and payload refusal; injected publication rollback; symlink refusal; canonical controls/defaults/image/config unchanged. Synthetic PE only, no native acceptance.')
