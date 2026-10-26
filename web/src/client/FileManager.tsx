import './gameSwitch.css';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {getDroppedFiles} from '@uppy/core/utils';
import {api,Button,Field,Input,Modal} from '../lib';
import {Switch} from '../ui/Settings';
import {Icon,type IconName} from '../Icons';
import {bytes,can,date,json,PageError,useServer} from './common';
import FileTransfers,{type FileTransfersHandle} from './FileTransfers';
import FileDocument from './FileDocument';
import FileExplorer from './FileExplorer';
import FileStorageSummary from './FileStorageSummary';
import FileMenu from './FileMenu';
import {DropdownMenuItem} from '../components/ui/dropdown-menu';
import useFileNavigationGuard from './useFileNavigationGuard';
import {blocksFileNavigation,childPath,fileName,filePath,isArchive,newName,parentPath,type FileEntry} from './fileManagerModel';
import './fileManager.css';
import './fileWorkspace.css';
import './fileMenu.css';
import './files-ui.css';

type Dialog={kind:'folder'|'new'|'rename'|'move'|'chmod'|'delete'|'pull'|'details';paths:string[]};
export default function FileManager(){const {base,permissions}=useServer();return <Workspace key={base} base={base} permissions={permissions}/>}
function Workspace({base,permissions}:{base:string;permissions:string[]}){
  const [query,setQuery]=useSearchParams();
  const directory=filePath(query.get('directory')||'/'),opened=query.get('file');
  const [retainedFile,setRetainedFile]=useState(opened);
  // Keep the outgoing document just long enough to animate. Navigation has
  // already passed the draft/transfer guard before the URL changes.
  useEffect(()=>{
    if(opened){setRetainedFile(opened);return}
    const timer=window.setTimeout(()=>setRetainedFile(null),240);
    return()=>window.clearTimeout(timer);
  },[opened]);
  const displayedFile=opened||retainedFile;
  const [epoch,setEpoch]=useState(0),[selected,setSelected]=useState<string[]>([]),[count,setCount]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [documentDirty,setDocumentDirty]=useState(false),[pendingTransfers,setPendingTransfers]=useState(false);
  const [rowMenu,setRowMenu]=useState<{id:string;anchor:HTMLButtonElement}|null>(null);
  useEffect(()=>setRowMenu(null),[directory,opened,epoch]);
  const navigationGuard=useFileNavigationGuard(documentDirty||pendingTransfers,({currentLocation,nextLocation})=>blocksFileNavigation(documentDirty,pendingTransfers,currentLocation,nextLocation));
  const [dialog,setDialog]=useState<Dialog|null>(null),[name,setName]=useState(''),[url,setURL]=useState(''),[mode,setMode]=useState('644'),[useHeader,setUseHeader]=useState(false),[foreground,setForeground]=useState(false),[dragging,setDragging]=useState(false);
  const transfers=useRef<FileTransfersHandle>(null),folderInput=useRef<HTMLInputElement>(null),fileInput=useRef<HTMLInputElement>(null),records=useRef(new Map<string,FileEntry>()),directoryEntries=useRef(new Map<string,FileEntry[]>()),latest=useRef({directory,opened,query,permissions});
  latest.current={directory,opened,query,permissions};
  const busyRef=useRef(false);
  const allowed=(permission:string)=>can(latest.current.permissions,permission);
  const rememberEntries=useCallback((path:string,files:FileEntry[])=>{
    for(const old of directoryEntries.current.get(path)||[])records.current.delete(childPath(path,old.name));
    directoryEntries.current.set(path,files);
    for(const file of files)records.current.set(childPath(path,file.name),file);
    if(path===latest.current.directory)setCount(files.length);
  },[]);
  useEffect(()=>{setSelected([]);setCount(directoryEntries.current.get(directory)?.length||0)},[directory]);
  function navigate(path:string){const next=new URLSearchParams(latest.current.query);next.set('directory',filePath(path));next.delete('file');setQuery(next)}
  function open(path:string){if(!allowed('file.read-content'))return;const next=new URLSearchParams(latest.current.query);next.set('directory',parentPath(path));next.set('file',path);setQuery(next)}
  function openEntry(path:string){if(records.current.get(path)?.is_file)open(path);else navigate(path)}
  function refresh(){records.current.clear();directoryEntries.current.clear();setSelected([]);setCount(0);setEpoch(n=>n+1)}
  async function run(action:()=>Promise<unknown>,message:string){
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setNotice('');
    try{await action();setDialog(null);setNotice(message);refresh()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{busyRef.current=false;setBusy(false)}
  }
  function show(kind:Dialog['kind'],paths=selected){setDialog({kind,paths:[...paths]});setError('');setName(kind==='rename'?fileName(paths[0]):kind==='move'?directory:'');setMode(records.current.get(paths[0])?.mode_bits||'644');setURL('');setUseHeader(false);setForeground(false)}
  function nativeDownload(path:string){const link=document.createElement('a');link.href=`${base}/files/download-stream?file=${encodeURIComponent(path)}`;link.download=fileName(path);document.body.append(link);link.click();link.remove()}
  async function dropFiles(data:DataTransfer){
    const target=latest.current.directory;
    try{
      const files=await getDroppedFiles(data,{logDropError:()=>setError('Some dropped items could not be read by the browser. Try Upload folder for those items.')});
      if(files.length)await transfers.current?.addFiles(files,true,target);
      else setError('No readable files were found. Use Upload folder to select a directory.');
    }catch(e){setError(e instanceof Error?e.message:String(e))}
  }
  async function submit(){
    if(!dialog)return;const {kind,paths}=dialog;
    await run(async()=>{
      switch(kind){
        case 'folder':await api(`${base}/files/create-folder`,json('POST',{root:directory,name:newName(name)}));break;
        case 'new':{const path=childPath(directory,newName(name));await api(`${base}/files/write?file=${encodeURIComponent(path)}`,{method:'POST',headers:{'Content-Type':'text/plain'},body:''});open(path);break}
        case 'rename':await api(`${base}/files/rename`,json('PUT',{root:parentPath(paths[0]),files:[{from:fileName(paths[0]),to:newName(name)}]}));break;
        case 'move':{const target=filePath(name.startsWith('/')?name:`${directory}/${name}`);await api(`${base}/files/rename`,json('PUT',{root:'/',files:paths.map(path=>({from:path.slice(1),to:childPath(target,fileName(path)).slice(1)}))}));break}
        case 'chmod':await api(`${base}/files/chmod`,json('POST',{root:'/',files:paths.map(path=>({file:path.slice(1),mode}))}));break;
        case 'delete':await api(`${base}/files/delete`,json('POST',{root:'/',files:paths.map(path=>path.slice(1))}));break;
        case 'pull':await api(`${base}/files/pull`,json('POST',{url,directory,filename:name||undefined,use_header:useHeader,foreground}));break;
      }
    },kind==='pull'&&!foreground?'Remote download queued. Refresh to see completed files.':'Changes saved.');
  }
  const single=selected.length===1?records.current.get(selected[0]):undefined,detail=dialog?.paths[0]?records.current.get(dialog.paths[0]):undefined;
  const menuFile=rowMenu?records.current.get(rowMenu.id):undefined;
  function menuAction(label:string,icon:IconName,action:()=>void,danger=false){return <DropdownMenuItem className={`file-menu-item${danger?' is-danger':''}`} variant={danger?'destructive':'default'} disabled={busy} onClick={()=>{setRowMenu(null);action()}}><Icon name={icon}/>{label}</DropdownMenuItem>}
  const titles={folder:'Create folder',new:'Create file',rename:'Rename',move:'Move items',chmod:'Unix permissions',delete:'Delete items',pull:'Download from URL',details:'File details'};
  return <section className="fm-workspace" aria-label="File manager">
    <header className="fm-heading server-page-toolbar"><h1>Files</h1>
    <div className="fm-actions" role="toolbar" aria-label="File tools">
      <Button variant="secondary" disabled={busy} onClick={refresh}><Icon name="restart"/>Refresh</Button>
      {allowed('file.create')&&<><Button variant="secondary" disabled={busy} onClick={()=>show('folder',[])}><Icon name="folderPlus"/>New folder</Button><Button variant="secondary" disabled={busy} onClick={()=>show('new',[])}><Icon name="newFile"/>New file</Button><Button onClick={()=>fileInput.current?.click()}><Icon name="upload"/>Upload files</Button><Button variant="secondary" onClick={()=>folderInput.current?.click()}>Upload folder</Button><Button variant="secondary" disabled={busy} onClick={()=>show('pull',[])}><Icon name="download"/>From URL</Button></>}
      <input ref={fileInput} type="file" multiple hidden aria-label="Choose files to upload" onChange={e=>{void transfers.current?.addFiles(Array.from(e.target.files||[]));e.target.value=''}}/>
      <input ref={folderInput} type="file" multiple hidden {...{webkitdirectory:'',directory:''}} aria-label="Choose folder to upload" onChange={e=>{void transfers.current?.addFiles(Array.from(e.target.files||[]),true);e.target.value=''}}/>
    </div>
    </header>
    <FileStorageSummary/>
    <PageError error={error}/>{notice&&<p className="fm-notice" role="status">{notice}</p>}
    <div className={`fm-file-layout${opened?' is-editing':''}`} onDragOverCapture={event=>{if(allowed('file.create')&&event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopPropagation();setDragging(true)}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false)}} onDropCapture={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopPropagation();setDragging(false);if(allowed('file.create'))void dropFiles(event.dataTransfer)}}}>
      <FileExplorer base={base} activeFile={opened||''} activeDirectory={directory} dirty={documentDirty} permissions={permissions} onOpen={open} onBrowse={()=>navigate(directory)} onDirectory={navigate} refreshKey={epoch} onEntries={rememberEntries} controls={!opened?{selected,onSelect:path=>setSelected(current=>current.includes(path)?current.filter(id=>id!==path):[...current,path]),onMenu:(id,anchor)=>setRowMenu(current=>current?.id===id?null:{id,anchor})}:undefined}/>
      <div className="fm-file-content" aria-hidden={!opened||undefined} inert={!opened}>
        {displayedFile&&<div className={`fm-document-pane${!opened?' is-closing':''}`}><FileDocument key={`${base}:${displayedFile}`} base={base} path={displayedFile} permissions={permissions} onClose={()=>navigate(directory)} onDirtyChange={setDocumentDirty} navigationGuard={navigationGuard}/></div>}
      </div>
      {dragging&&<div className="fm-drop">Drop files to add them to the upload queue</div>}
    </div>
    {!opened&&<div className="fm-summary"><span role="status">{count.toLocaleString()} items{selected.length>0&&` · ${selected.length.toLocaleString()} selected`}</span><span>Click a file to open · Expand folders to browse</span><Button variant="secondary" disabled={busy} onClick={()=>setSelected((directoryEntries.current.get(directory)||[]).map(file=>childPath(directory,file.name)))}>Select all</Button></div>}
    {!opened&&selected.length>0&&<div className="fm-selection" role="toolbar" aria-label="Selected file actions">
      {single?.is_file&&allowed('file.read-content')&&<><Button variant="secondary" disabled={busy} onClick={()=>open(selected[0])}><Icon name="file"/>Open / preview</Button><Button variant="secondary" onClick={()=>nativeDownload(selected[0])}><Icon name="download"/>Download</Button></>}
      {selected.length===1&&allowed('file.update')&&<Button variant="secondary" disabled={busy} onClick={()=>show('rename')}>Rename</Button>}
      {allowed('file.update')&&<><Button variant="secondary" disabled={busy} onClick={()=>show('move')}>Move</Button><Button variant="secondary" disabled={busy} onClick={()=>show('chmod')}>Permissions</Button></>}
      {selected.every(path=>records.current.get(path)?.is_file)&&allowed('file.create')&&<Button variant="secondary" disabled={busy} onClick={()=>void run(async()=>{for(const path of selected)await api(`${base}/files/copy`,json('POST',{location:path}))},'Files duplicated.')}>Duplicate</Button>}
      {allowed('file.archive')&&<Button variant="secondary" disabled={busy} onClick={()=>void run(()=>api(`${base}/files/compress`,json('POST',{root:'/',files:selected.map(path=>path.slice(1))})),'Archive created.')}><Icon name="archive"/>Archive</Button>}
      {single&&isArchive(single)&&allowed('file.create')&&<Button variant="secondary" disabled={busy} onClick={()=>void run(()=>api(`${base}/files/decompress`,json('POST',{root:parentPath(selected[0]),file:fileName(selected[0])})),'Archive extracted.')}>Extract</Button>}
      {selected.length===1&&<Button variant="secondary" disabled={busy} onClick={()=>show('details')}>Details</Button>}
      {allowed('file.delete')&&<Button variant="danger" disabled={busy} onClick={()=>show('delete')}><Icon name="trash"/>Delete</Button>}
      <Button variant="secondary" onClick={()=>setSelected([])}>Clear selection</Button>
    </div>}
    {pendingTransfers&&!documentDirty&&navigationGuard.attention>0&&<div ref={navigationGuard.bar} tabIndex={-1} role="alert" className="fm-notice">Finish or cancel your queued transfers before leaving Files. Folder navigation remains available.</div>}
    {allowed('file.create')&&<FileTransfers ref={transfers} base={base} directory={directory} permissions={permissions} onComplete={refresh} onPendingChange={setPendingTransfers}/>}
    {rowMenu&&menuFile&&<FileMenu anchor={rowMenu.anchor} label={`Options for ${menuFile.name}`} onClose={restore=>{if(restore)rowMenu.anchor.focus();setRowMenu(null)}}>
      {(!menuFile.is_file||allowed('file.read-content'))&&menuAction(menuFile.is_file?'Open / preview':'Open folder',menuFile.is_file?'file':'files',()=>openEntry(rowMenu.id))}
      {menuFile.is_file&&allowed('file.read-content')&&menuAction('Download','download',()=>nativeDownload(rowMenu.id))}
      {allowed('file.update')&&<>{menuAction('Rename','edit',()=>show('rename',[rowMenu.id]))}{menuAction('Move','back',()=>show('move',[rowMenu.id]))}{menuAction('Permissions','lock',()=>show('chmod',[rowMenu.id]))}</>}
      {menuFile.is_file&&allowed('file.create')&&menuAction('Duplicate','copy',()=>{void run(()=>api(`${base}/files/copy`,json('POST',{location:rowMenu.id})),'File duplicated.')})}
      {allowed('file.archive')&&menuAction('Archive','archive',()=>{void run(()=>api(`${base}/files/compress`,json('POST',{root:parentPath(rowMenu.id),files:[fileName(rowMenu.id)]})),'Archive created.')})}
      {isArchive(menuFile)&&allowed('file.create')&&menuAction('Extract archive','archive',()=>{void run(()=>api(`${base}/files/decompress`,json('POST',{root:parentPath(rowMenu.id),file:fileName(rowMenu.id)})),'Archive extracted.')})}
      {menuAction('Details','info',()=>show('details',[rowMenu.id]))}
      {allowed('file.delete')&&<><div className="file-menu-separator" role="separator"/>{menuAction('Delete','trash',()=>show('delete',[rowMenu.id]),true)}</>}
    </FileMenu>}
    {dialog&&<Modal title={titles[dialog.kind]} onClose={()=>{if(!busy)setDialog(null)}}>
      <PageError error={error}/>
      {dialog.kind==='details'?<dl className="fm-details">{[['Name',detail?.name],['Path',dialog.paths[0]],['Size',detail?.is_file?bytes(Number(detail.size)):'Folder'],['MIME type',detail?.mimetype],['Permissions',detail?.mode_bits],['Symbolic link',detail?.is_symlink?'Yes':'No'],['Modified',date(detail?.modified_at)]].map(([label,text])=><div key={label}><dt>{label}</dt><dd>{String(text||'—')}</dd></div>)}</dl>:<form onSubmit={event=>{event.preventDefault();void submit()}}>
        {dialog.kind==='delete'?<><p>Delete {dialog.paths.length} selected {dialog.paths.length===1?'item':'items'}? This cannot be undone.</p><ul>{dialog.paths.slice(0,10).map(path=><li key={path}>{path}</li>)}</ul></>:dialog.kind==='chmod'?<Field label="Octal mode"><Input required pattern="[0-7]{3,4}" autoFocus value={mode} onChange={e=>setMode(e.target.value)}/></Field>:<>
          {dialog.kind==='pull'&&<Field label="Source URL"><Input required type="url" value={url} onChange={e=>setURL(e.target.value)}/></Field>}
          <Field label={dialog.kind==='move'?'Destination directory':dialog.kind==='pull'?'File name, optional':'Name'}><Input autoFocus required={dialog.kind!=='pull'} value={name} onChange={e=>setName(e.target.value)}/></Field>
          {dialog.kind==='pull'&&<><label className="fm-check"><Switch checked={useHeader} onCheckedChange={checked => setUseHeader(checked)}/>Use the source Content-Disposition filename</label><label className="fm-check"><Switch checked={foreground} onCheckedChange={checked => setForeground(checked)}/>Wait for download to finish</label></>}
        </>}
        <div className="actions"><Button variant="secondary" disabled={busy} onClick={()=>setDialog(null)}>Cancel</Button><Button type="submit" disabled={busy} variant={dialog.kind==='delete'?'danger':'default'}>{busy?'Working…':dialog.kind==='delete'?'Delete':dialog.kind==='pull'?'Download':'Save'}</Button></div>
      </form>}
    </Modal>}
  </section>;
}



