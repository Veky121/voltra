#!/usr/bin/env python3
"""MIT. Confined bounded native-file log relay; no historical ready replay."""
import os,stat

class NativeLog:
 def __init__(self,root,name,credentials,steam):
  self.root,self.name,self.steam=root,name,steam;self.redactor=steam.Redactor(credentials);self.identity=None;self.offset=0;self.initial=True
  self.scan(lambda _:None)
 def scan(self,emit):
  with self.steam._publication_parent(self.root,self.name) as (parent,name,volume):
   if parent is None:self.initial=False;return
   try:descriptor=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
   except FileNotFoundError:self.initial=False;return
   with os.fdopen(descriptor,'rb') as stream:
    metadata=os.fstat(stream.fileno())
    if not stat.S_ISREG(metadata.st_mode):raise ValueError('Native log must be regular')
    identity=(metadata.st_dev,metadata.st_ino)
    if self.initial:self.identity=identity;self.offset=metadata.st_size;self.initial=False;return
    if identity!=self.identity or metadata.st_size<self.offset:self.identity=identity;self.offset=0
    stream.seek(self.offset)
    for unused in range(16):
     data=stream.read(65536)
     if not data:break
     self.offset+=len(data);emit(self.redactor.feed(data,final=data.endswith(b'\n')))
