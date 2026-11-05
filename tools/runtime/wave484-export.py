import pathlib,os,json,hashlib,tarfile,sys
r=pathlib.Path('/campaign/volumes')/sys.argv[1];out=pathlib.Path('/out');phase=sys.argv[2]
def rows():
 result=[]
 for p in sorted(r.rglob('*')):
  st=p.lstat();x={'path':str(p.relative_to(r)),'uid':st.st_uid,'gid':st.st_gid,'mode':st.st_mode,'mtime_ns':str(st.st_mtime_ns)}
  if p.is_symlink():x['link']=os.readlink(p)
  elif p.is_file():x['sha256']=hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
  result.append(x)
 return result
if phase=='base':
 p=r/'wave484-custom/maps/operator-marker.txt';p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'wave484 custom map directory retention only\n');os.chmod(p,0o640)
 result=rows();(out/'base-manifest.json').write_text(json.dumps(result));
 with tarfile.open(out/'base.tar','w') as t:t.add(r,arcname='payload')
else:
 result=rows();base={x['path']:x for x in json.loads((out/'base-manifest.json').read_text())};now={x['path']:x for x in result};changed=[];metadata=[]
 for name,x in now.items():
  b=base.get(name)
  if not b or any(x.get(k)!=b.get(k) for k in ['sha256','link']):changed.append(x)
  elif x!=b:metadata.append(x)
 deleted=[x for x in base if x not in now]
 with tarfile.open(out/'delta.tar','w') as t:
  for x in changed+metadata:t.add(r/x['path'],arcname=x['path'],recursive=False)
 protected=[x for x in base if x.startswith('wave484-custom/') or x.endswith('zandronum.ini') or x.endswith('voltra-server.cfg')]
 failures=[x for x in protected if x not in now or any(base[x].get(k)!=now[x].get(k) for k in ['sha256','link','uid','gid','mode'])]
 (out/'delta-manifest.json').write_text(json.dumps({'changed_new':changed,'metadata_only':metadata,'deleted':deleted,'protected':protected,'retention_failures':failures}));result={'files':len(result),'changed_new':len(changed),'metadata_only':len(metadata),'deleted':deleted,'retention_failures':failures}
print(json.dumps({'phase':phase,'result':result if phase!='base' else len(result),'archive_sha256':hashlib.file_digest((out/('base.tar' if phase=='base' else 'delta.tar')).open('rb'),'sha256').hexdigest()}))
