#!/usr/bin/env python3
"""MIT. Bounded disk preservation; failed restores retain private recovery copies."""
import contextlib,importlib.util,json,os,shutil,sys,tempfile
from pathlib import Path

def helper(name):
 path=Path(__file__).with_name(name+'.py')
 if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name.replace('-','_')]=module;spec.loader.exec_module(module);return module
shared=sys.modules.get('steam_native_next') or helper('steam-native-next');steam=shared.steam

def path(root,name):return shared.confined(root,root/name)

@contextlib.contextmanager
def preserve(root,paths):
 # Stream saves to bounded private disk staging, not RAM; retain exact metadata.
 folder=Path(tempfile.mkdtemp(prefix='.wasteland-preserve-',dir=root));identity=folder.stat();retain=False
 try:
  saved={};total=0
  for relative in paths:
   origin=path(root,relative)
   if not origin.exists():continue
   for parent,dirs,files in os.walk(origin,followlinks=False):
    for name in dirs+files:shared.confined(root,Path(parent)/name)
    for name in files:
     source=Path(parent)/name;relative=str(source.relative_to(root))
     if relative in saved:continue
     metadata=source.stat();total+=metadata.st_size
     if total>32*1024**3:raise ValueError('Save/config preservation exceeds 32GiB; make an external backup first')
     backup=Path(folder)/str(len(saved));shutil.copyfile(source,backup);saved[relative]=(backup,metadata)
  try:yield
  finally:
   errors=[]
   for relative,(backup,metadata) in saved.items():
    try:
     shared.confined(root,root/relative)
     def restore(output,backup=backup):
      with backup.open('rb') as source:shutil.copyfileobj(source,output)
     steam._publish(root,relative,restore,metadata.st_mode&0o777)
     with steam._publication_parent(root,relative) as (parent,leaf,volume):
      descriptor=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
      try:
       current=os.fstat(descriptor)
       if (current.st_uid,current.st_gid)!=(metadata.st_uid,metadata.st_gid):os.fchown(descriptor,metadata.st_uid,metadata.st_gid)
       os.fchmod(descriptor,metadata.st_mode&0o777)
      finally:os.close(descriptor)
    except (ValueError,OSError) as error:errors.append(relative)
   if errors:
    retain=True
    manifest={relative:{'backup':backup.name,'mode':metadata.st_mode&0o777,'uid':metadata.st_uid,'gid':metadata.st_gid} for relative,(backup,metadata) in saved.items()}
    (folder/'recovery.json').write_text(json.dumps({'failed_paths':errors,'files':manifest},indent=2)+'\n')
    raise RuntimeError('Save/config restoration incomplete; recovery copies retained in '+folder.name)
 finally:
  if not retain:
   current=folder.lstat()
   if folder.is_symlink() or folder.resolve().parent!=root or (current.st_dev,current.st_ino)!=(identity.st_dev,identity.st_ino):raise ValueError('Private preservation directory changed; cleanup refused')
   shutil.rmtree(folder)

