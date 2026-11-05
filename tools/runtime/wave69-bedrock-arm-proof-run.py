"""Source-only emitted ARM publication proof. Run with WSL python3 -I -B."""
import hashlib, importlib.util, json, os, pathlib, re, shutil, socket, subprocess, sys, tempfile, urllib.request, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave69-bedrock-arm-proof'
KEY='minecraft/bedrock/bedrock/egg-vanilla-bedrock-ARM64.json'
def digest(b): return hashlib.sha256(b).hexdigest()
catalog=ROOT/'internal/panel/game_library/overrides.json'
before_bytes=catalog.read_bytes(); profiles=json.loads(before_bytes); profile=profiles[KEY]
checkpoint=json.loads((ROOT/'artifacts/game-parity-20261029/root-source-regression-wave68/source-before.json').read_text())
expected={x['path']:x['sha256'] for x in checkpoint}
inputs=['internal/panel/game_library/overrides.json','tools/runtime/embedded-python.mjs','internal/panel/game_library/scripts/small-native-install.py','internal/panel/game_library/scripts/native-release.py','internal/panel/game_library/scripts/bedrock-family.py','internal/panel/game_library/scripts/bedrock-arm-owner.py']
hashes={p:{'before':digest((ROOT/p).read_bytes()),'checkpoint':expected.get(p)} for p in inputs}
assert all(x['before']==x['checkpoint'] for x in hashes.values()), hashes
script=profile['egg']['scripts']['installation']['script']
pattern=r'''cat\s+>\s*(?:"([^"\r\n]+\.py)"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)'''
modules={pathlib.PurePosixPath(a or b or c).name:(body+'\n').encode() for a,b,c,_,body in re.findall(pattern,script)}
assert 'bedrock_arm_owner.py' in modules
old=modules['small-native-install.py'].decode()
assert 'def preserve_identity(' in modules['native-release.py'].decode()
needle="backup=previous/name;backup.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dst,backup)"
assert old.count(needle)==1
new=old.replace(needle,needle+'\n                release.preserve_identity(backup,dst);release.preserve_identity(src,dst)')
tests=[]; blocked=[]
def deny(*a,**k):
    blocked.append('forbidden boundary'); raise AssertionError('network/process boundary forbidden')
socket.socket=deny; socket.create_connection=deny; urllib.request.urlopen=deny
subprocess.Popen=deny; subprocess.run=deny; subprocess.call=deny; os.system=deny
def audit(event,args):
    if event in ('os.exec','os.posix_spawn','os.fork','subprocess.Popen','socket.connect','socket.__new__'): deny()
sys.addaudithook(audit)
def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
with tempfile.TemporaryDirectory(prefix='wave69-arm-') as temporary:
    base=pathlib.Path(temporary); emitted=base/'emitted'; emitted.mkdir()
    for name,data in modules.items():
        compile(data,name,'exec'); (emitted/name).write_bytes(data)
    # Exact non-Python emitted release table, extracted inertly.
    match=re.search(r"cat\s+>\s+\S*bedrock-family-releases.json\"?\s+<<'([^']+)'\n(.*?)\n\1",script,re.S)
    assert match, 'release table emitter missing'
    (emitted/'bedrock-family-releases.json').write_text(match[2]+'\n')
    sys.path.insert(0,str(emitted))
    owner=load(emitted/'bedrock_arm_owner.py','proof_owner'); family=owner.family()
    owner.family=lambda:family
    family.platform.system=lambda:'Linux'; family.platform.machine=lambda:'aarch64'
    # No EULA acceptance: replace the gate with a fixture observer, never supply acceptance.
    gates=[]; family.require_terms=lambda game,env:gates.append(game)
    family.selected=lambda *a:dict(game='bds_arm',version='synthetic',sha256='fixture')
    elf=b'\x7fELF\x02\x01'+bytes(12)+b'\x3e\0'+b'synthetic-only'
    archive_members={'bedrock_server':elf,'libfixture.so':b'new library','server.properties':b'server-name=publisher\n','permissions.json':b'[]','allowlist.json':b'[]','whitelist.json':b'[]','worlds/new.dat':b'publisher','config/new.cfg':b'publisher','plugins/new.py':b'publisher'}
    current_payload=dict(archive_members)
    def download(identity,path):
        with zipfile.ZipFile(path,'w') as z:
            for n,b in current_payload.items(): z.writestr(n,b)
    family.release.download=download
    env={'SERVER_PORT':'19132','BEDROCK_VERSION':'1.2.3'}
    def snap(root):
        return {str(p.relative_to(root)):{'sha256':digest(p.read_bytes()),'mode':oct(p.stat().st_mode&0o7777),'uid':p.stat().st_uid,'gid':p.stat().st_gid} for p in sorted(root.rglob('*')) if p.is_file()}
    original_publish=family.publisher.publish
    retained=[]
    def observe(*args):
        retained.append(sorted(str(p.relative_to(args[1])) for p in args[1].rglob('*') if p.is_file()))
        return original_publish(*args)
    family.publisher.publish=observe
    def case(label,patched=False,conflict=False,owner_paths=True):
        root=base/label;root.mkdir()
        if patched:
            (emitted/'small-native-install.py').write_text(new)
            candidate=load(emitted/'small-native-install.py','candidate_'+label)
            family.publisher=candidate
            # Its release module is separate; download remains mocked on family.release.
        else: family.publisher.publish=observe
        if owner_paths:
            for n in ('server.properties','permissions.json','allowlist.json','whitelist.json','worlds/save.dat','config/operator.cfg','plugins/operator.py'):
                p=root/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'operator\n' if n=='server.properties' else b'opaque\xff')
        binary=root/'bedrock_server';binary.write_bytes(b'old synthetic');binary.chmod(0o750)
        alternate=next(g for g in os.getgroups() if g!=os.getgid());os.chown(binary,-1,alternate)
        if conflict:(root/'libfixture.so').mkdir()
        before=snap(root); error=None
        try: owner.main('install',root,env)
        except Exception as ex:error=type(ex).__name__+': '+str(ex)
        after=snap(root)
        receipt=root/'.voltra/bds_arm/release.json'
        result={'name':label,'error':error,'before':before,'after':after,'receipt':json.loads(receipt.read_text()) if receipt.exists() else None}
        if conflict:
            assert error and binary.read_bytes()==b'old synthetic'
            result['rollback_bytes_preserved']=True
        else:
            assert not error,error
            assert binary.read_bytes()==elf
            assert after['bedrock_server']['mode']==('0o750' if patched else '0o755')
            assert after['bedrock_server']['gid']==(alternate if patched else os.getgid())
            for n in before:
                if n!='bedrock_server' and n!='server.properties':assert before[n]==after[n]
            if owner_paths:
                assert retained[0]==['bedrock_server','libfixture.so']
                assert 'worlds/new.dat' not in after
                # configure executes after publication and edits managed properties by design.
                assert (root/'server.properties').read_bytes().startswith(b'operator\n')
        tests.append(result)
    case('original-owned-paths')
    case('original-directory-conflict',conflict=True)
    case('candidate-owned-paths',patched=True)
    case('candidate-first-adoption',patched=True,owner_paths=False)
    # Candidate negative input: extraction traversal must refuse before publication.
    current_payload={'../escape':b'bad','bedrock_server':elf}
    root=base/'traversal';root.mkdir()
    try:owner.main('install',root,env)
    except ValueError as ex:tests.append({'name':'candidate-traversal-refusal','error':str(ex)} )
    else:raise AssertionError('Traversal accepted')
    assert not (base/'escape').exists()
    current_payload=dict(archive_members)
    root=base/'symlink';root.mkdir(); outside=base/'outside';outside.write_bytes(b'owner')
    (root/'bedrock_server').symlink_to(outside)
    try:owner.main('install',root,env)
    except ValueError as ex:tests.append({'name':'candidate-symlink-refusal','error':str(ex)})
    else:raise AssertionError('Symlink accepted')
    assert outside.read_bytes()==b'owner'
    assert not list(base.rglob('.install-*'))
    assert gates and not blocked
OUT.mkdir(parents=True,exist_ok=True)
candidate_profile=json.loads(json.dumps(profile))
# Replace exactly the original captured module body including its emitted LF.
assert script.count(old.rstrip('\n'))==1
candidate_profile['egg']['scripts']['installation']['script']=script.replace(old.rstrip('\n'),new.rstrip('\n'),1)
candidate_modules={pathlib.PurePosixPath(a or b or c).name:(body+'\n').encode() for a,b,c,_,body in re.findall(pattern,candidate_profile['egg']['scripts']['installation']['script'])}
assert candidate_modules['small-native-install.py']==new.encode()
assert all(candidate_modules[n]==b for n,b in modules.items() if n!='small-native-install.py')
left=json.loads(json.dumps(profile));right=json.loads(json.dumps(candidate_profile))
left['egg']['scripts']['installation'].pop('script');right['egg']['scripts']['installation'].pop('script')
assert left==right
for p in inputs:
    hashes[p]['after']=digest((ROOT/p).read_bytes());assert hashes[p]['after']==hashes[p]['before']
assert catalog.read_bytes()==before_bytes
(OUT/'profile.pending.json').write_text(json.dumps({KEY:candidate_profile},indent=2)+'\n')
(OUT/'small-native-install.py').write_bytes(new.encode())
report={'outcome':'concrete_source_identity_loss_candidate_staged','recipe':KEY,'startup':profile['egg']['startup'],'profile_sha256':digest(json.dumps(profile,sort_keys=True).encode()),'installation_sha256':digest(script.encode()),'module_hashes':{n:{'before':digest(b),'after':digest(candidate_modules[n])} for n,b in modules.items()},'source_hashes':hashes,'tests':tests,'retained_archive_members_at_publish':retained,'archive_members':list(archive_members),'boundary':'WSL isolated temporary roots; synthetic ZIP/ELF only; terms gate observed and mocked, no acceptance; architecture mocked; network/process denied; no native or ABI claim','original37statuses':'unchanged by this tool; historical status locations not inferred','cleanup':{'temporary_directory_removed':not base.exists(),'installer_staging_removed':True,'forbidden_boundary_calls':blocked},'candidate_contract':'Only embedded small-native-install.py gains two existing release.preserve_identity calls at overwrite backup. All other emitted helper bytes and nonscript metadata unchanged. Root must review and adopt with exact hash guards; no canonical mutation. Not crash atomic.','known_limitations':['Family configure intentionally edits managed properties after install; opaque invalid UTF-8 configure is outside this publication proof.','Destination directory conflict raises IsADirectoryError after a prior binary replacement, then rolls back bytes. This is not a supported payload defect proof.','No actual publisher archive membership or native ARM runtime evidence; synthetic fixture proves reachable owner/group/mode loss for ordinary executable overwrite.','No current publisher, box64, EULA, networking, ABI or gameplay acceptance.'],'remaining_gaps':['Actual selected publisher ZIP inventory and distribution history','Native ARM64 box64/runtime acceptance by authorized owner','Root adoption and broader source regression after integration']}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
report['trace']={'startup':'egg.startup -> bedrock_arm_owner.py main(run) -> preflight -> shared.launch with configure suppressed; not executed in this proof','install':'installer preflight -> bedrock_arm_owner.py main(install) -> preflight -> bedrock_family.install(root,bds_arm,env) -> release.download fixture -> publisher.extract_zip -> remove seven existing owner paths -> publisher.publish(root,ready,root,identity,bedrock_server) -> family.configure','publication_trigger':'Existing bedrock_server bytes differ from synthetic archive executable. Executable always overwrites even without old receipt. Old publisher copy2 backs up metadata but os.replace installs staged 0755/install-group file without preserving destination identity. Candidate invokes existing release.preserve_identity on backup and prepared replacement only.','scope':'Normal regular-file executable update; no malformed archive, receipt corruption, or native binary execution needed.'}
report['validation']={'passed':6,'failed':0,'skipped':0,'development_failures':['Initial inert release-table regex omitted quoted target suffix; assertion refused before imports or tests; corrected parser, final six-case run passed.'],'not_measured':['uid transfer to a different account requires privileges; same uid and alternate supplementary gid exercised','candidate rollback after directory conflict not separately rerun; original rollback bytes recorded','actual publisher ZIP member inventory unknown; archive inventory in report is explicitly synthetic'],'nonscript_metadata_equal':True,'other_helper_bytes_equal':True,'final_newline':'Exact captured source plus LF; candidate re-extracted and byte-compared, all original trailing newlines retained.'}
report['adoption_hashes']={'catalog_required':digest(before_bytes),'old_emitted_publisher':digest(modules['small-native-install.py']),'candidate_emitted_publisher':digest(new.encode()),'pending_fragment':digest((OUT/'profile.pending.json').read_bytes())}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'outcome':report['outcome'],'cases':len(tests),'report':str(OUT/'report.json')}))
