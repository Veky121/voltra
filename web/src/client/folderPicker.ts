type FileHandle={kind:'file';name:string;getFile:()=>Promise<File>};
export type DirectoryHandle={kind:'directory';name:string;values:()=>AsyncIterable<FileHandle|DirectoryHandle>};
export type DirectoryPickerWindow={showDirectoryPicker?:(options:{mode:'read'})=>Promise<DirectoryHandle>};

// Keep paths compatible with the transfer queue without reading file bytes into memory.
export async function pickUploadFolder(target:DirectoryPickerWindow):Promise<File[]|null>{
 if(!target.showDirectoryPicker)return null;
 let root:DirectoryHandle;
 try{root=await target.showDirectoryPicker({mode:'read'})}catch(error){
  if(error instanceof Error&&error.name==='AbortError')return [];
  throw error;
 }
 const files:File[]=[];
 async function visit(directory:DirectoryHandle,path:string):Promise<void>{
  for await(const entry of directory.values()){
   const relativePath=`${path}/${entry.name}`;
   if(entry.kind==='directory')await visit(entry,relativePath);
   else files.push(Object.assign(await entry.getFile(),{relativePath}));
  }
 }
 await visit(root,root.name);
 return files;
}
