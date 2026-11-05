import hashlib, importlib.util, json, os, pathlib, re, subprocess, sys, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/bedrock-arm-owner'
recipe='minecraft/bedrock/bedrock/egg-vanilla-bedrock-ARM64.json'
p=json.loads((OUT/'profile.pending.json').read_text(encoding='utf-8-sig'))[recipe]
script=p['egg']['scripts']['installation']['script']
with tempfile.TemporaryDirectory() as tmp:
    base=pathlib.Path(tmp); emitted=base/'emitted'; emitted.mkdir()
    for name,delimiter,source in re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2",script,re.S):
        (emitted/name).write_text(source,encoding='utf-8')
    # Fresh interpreter imports only the emitted module tree, never source aliases.
    probe=r'''
import importlib.util, pathlib, sys, tempfile
sys.path.insert(0,sys.argv[1])
import bedrock_arm_owner as owner
shared=owner.family()
# Windows offline fixture cannot verify Linux ownership syscalls.
if not hasattr(shared.os,'fchown'):shared.os.fchown=lambda *_:None
if not hasattr(shared.os,'chown'):shared.os.chown=lambda *_:None
with tempfile.TemporaryDirectory() as tmp:
 root=pathlib.Path(tmp)
 env={'BEDROCK_TERMS_ACCEPTED':'true','SERVER_PORT':'19132','SERVERNAME':'seed'}
 raw=b'\xef\xbb\xbf# operator\r\nserver-name=operator\r\nunknown=\xff\r\nonline-mode=false\r\n'
 (root/'server.properties').write_bytes(raw)
 for name in ['worlds/save','plugins/mod','permissions.json','allowlist.json']:
  path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'opaque secret [1,1]')
 def snapshot():return {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
 before=snapshot()
 for bad in [dict(env,BEDROCK_TERMS_ACCEPTED='false'),dict(env,BEDROCK_VERSION='../../bad'),dict(env,SERVER_PORT='0'),dict(env,ONLINE_MODE='oops')]:
  try:owner.preflight(root,bad,'install',shared)
  except ValueError:pass
  else:raise AssertionError('Expected refusal')
  assert snapshot()==before
 path,data=owner.plan(root,env,shared)
 assert raw in data and b'server-name=seed' not in data
 shared.write(path,data)
 assert owner.plan(root,dict(env,SERVERNAME='changed'),shared)[1]==data
 for name,value in before.items():
  if name!='server.properties':assert (root/name).read_bytes()==value
 for suffix in [b'server-name=duplicate\n', b'SERVER-NAME=alias\n']:
  path.write_bytes(raw+suffix);before=snapshot()
  try:owner.plan(root,env,shared)
  except ValueError:pass
  else:raise AssertionError('Expected ambiguity refusal')
  assert snapshot()==before
 # Simulate successful and failed child supervision without executing a game.
 path.write_bytes(raw)
 shared.platform.system=lambda:'Linux';shared.platform.machine=lambda:'aarch64'
 shared.shutil.which=lambda name:'/fixture/box64'
 binary=root/'bedrock_server';binary.write_bytes(b'\x7fELF\x02\x01'+b'\0'*12+b'\x3e\0')
 owner.family=lambda:shared
 for status in [0,37]:
  calls=[]
  def run(root,args,child,stop,**kw):
   calls.append((args,stop,kw));return status
  shared.run=run
  assert owner.main('run',root,env)==status
  assert calls[0][0][0]=='box64' and calls[0][1]=='stop'
  assert path.read_bytes().startswith(raw)
  for name,value in before.items():
   if name!='server.properties':assert (root/name).read_bytes()==value
 print('emitted imports, invalid controls, opaque bytes, seed-once, ambiguity, success/failure preservation and raw exit forwarding PASS')
'''
    result=subprocess.run([sys.executable,'-I','-B','-c',probe,str(emitted)],capture_output=True,text=True)
    (OUT/'test-result.json').write_text(json.dumps({'exit_code':result.returncode,'stdout':result.stdout,'stderr':result.stderr,'emitted_files':sorted(p.name for p in emitted.iterdir())},indent=2))
    print(result.stdout,result.stderr)
    sys.exit(result.returncode)

