import type {FileEntry} from './fileManagerModel';

export function fileEntryType(entry:FileEntry):string {
  if(entry.is_symlink)return 'Symbolic link';
  if(!entry.is_file)return 'Folder';
  const extension=entry.name.match(/\.([a-z0-9]{1,16})$/i)?.[1];
  return extension&&entry.name!==`.${extension}`?`${extension.toUpperCase()} file`:'File';
}

// A directory's stat size describes its directory entry, not its contents.
export function fileEntrySize(entry:FileEntry):number|null {
  return entry.is_file&&!entry.is_symlink&&typeof entry.size==='number'&&Number.isFinite(entry.size)&&entry.size>=0?entry.size:null;
}

export function fileModifiedDate(value:unknown):Date|null {
  if(typeof value!=='string'||!value)return null;
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date:null;
}

export function reportedStorage(resources:Record<string,unknown>,updated:number,error:string):number|null {
  const size=resources.disk_bytes;
  return updated>0&&!error&&typeof size==='number'&&Number.isFinite(size)&&size>=0?size:null;
}
