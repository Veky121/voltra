export type FileEntry = {name:string;is_file:boolean;size:number;modified_at:string;mimetype?:string;is_symlink?:boolean;mode_bits?:string;[key:string]:unknown};
export function filePath(path:string):string {
  if(path.includes('\0'))throw new Error('Paths cannot contain a null character.');
  const parts:string[]=[];
  for(const part of path.split('/')){
    if(!part||part==='.')continue;
    if(part==='..'){parts.pop();continue}
    parts.push(part);
  }
  return '/'+parts.join('/');
}
export const parentPath=(path:string)=>filePath(path).split('/').slice(0,-1).join('/')||'/';
export const fileName=(path:string)=>filePath(path).split('/').at(-1)||'/';
export const childPath=(directory:string,name:string)=>filePath(`${directory}/${name}`);
// SVAR string IDs have one leading colon. Never URL-decode Linux file names.
export const managerDOMPath=(value:string|null)=>value?.startsWith(':/')?value.slice(1):null;
export const plainFileClick=(event:{button:number;ctrlKey:boolean;metaKey:boolean;shiftKey:boolean;altKey:boolean})=>event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey;
export function newName(name:string){
  if(!name||name==='.'||name==='..'||name.includes('/')||name.includes('\0'))throw new Error('Enter a file or folder name without a slash.');
  return name;
}
const archiveMimes=new Set(['application/vnd.rar','application/x-rar-compressed','application/x-tar','application/x-br','application/x-bzip2','application/gzip','application/x-gzip','application/x-lzip','application/x-sz','application/x-xz','application/zstd','application/zip','application/x-7z-compressed']);
export function isArchive(file:FileEntry){return file.is_file&&(archiveMimes.has(file.mimetype||'')||/\.(?:zip|tar|gz|tgz|bz2|tbz2?|xz|txz|rar|7z|br|lz|lz4|sz|zst|zstd)$/i.test(file.name))}
export function managerEntries(directory:string,files:FileEntry[]){
  return files.map(file=>({...file,id:childPath(directory,file.name),type:file.is_file?'file' as const:'folder' as const,date:new Date(file.modified_at),lazy:!file.is_file}));
}
export function ancestorFolders(path:string){
  const folders=[{id:'/',type:'folder' as const,lazy:true}];let current='';
  for(const part of filePath(path).split('/').filter(Boolean)){current+='/'+part;folders.push({id:current,type:'folder',lazy:true})}
  return folders;
}
export function blocksFileNavigation(dirty:boolean,uploads:boolean,current:{pathname:string;search:string},next:{pathname:string;search:string}){
  if(dirty)return current.pathname!==next.pathname||current.search!==next.search;
  return uploads&&(current.pathname!==next.pathname||new URLSearchParams(current.search).get('manager')!==new URLSearchParams(next.search).get('manager'));
}
