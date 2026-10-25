import {lazy,Suspense,useEffect,useRef,useState,type ReactNode} from 'react';
import {useSearchParams} from 'react-router-dom';
import {api,useAPI,Button,Input,Field,Modal} from '../lib';
import {Icon,type IconName} from '../Icons';
import {bytes,can,date,download,items,json,Notice,PageError,useAction,useServer,value,type RecordData} from './common';
import FileMenu from './FileMenu';
import {DropdownMenuItem} from '../components/ui/dropdown-menu';
import FileExplorer from './FileExplorer';
import useFileNavigationGuard from './useFileNavigationGuard';
import {commitDraft,discardDraft,isDraftDirty,loadedDraft} from './fileDraft';
import './files.css';
import './fileWorkspace.css';
import './files-ui.css';
const FileEditor=lazy(()=>import('./FileEditor'));

function containerPath(path:string){
  const parts:string[]=[];
  for(const part of path.split('/')){
    if(!part||part==='.')continue;
    if(part==='..')parts.pop();else parts.push(part);
  }
  return parts.join('/');
}
const relative=new Intl.RelativeTimeFormat('en',{numeric:'auto'});
function modifiedAt(timestamp:string,now:number){
  const seconds=(Date.parse(timestamp)-now)/1000;
  if(!Number.isFinite(seconds))return '—';
  const units:[Intl.RelativeTimeFormatUnit,number][]=[['year',31536000],['month',2592000],['day',86400],['hour',3600],['minute',60]];
  const unit=units.find(([,length])=>Math.abs(seconds)>=length)||['second',1];
  return relative.format(Math.round(seconds/Number(unit[1])),unit[0] as Intl.RelativeTimeFormatUnit);
}
type OpenMenu={kind:'row'|'tools'|'selection';anchor:HTMLButtonElement;file?:RecordData};
function MenuItem({icon,children,onClick,danger=false,disabled=false}:{icon:IconName;children:ReactNode;onClick:()=>void;danger?:boolean;disabled?:boolean}){
  return <DropdownMenuItem className={`file-menu-item${danger?' is-danger':''}`} variant={danger?'destructive':'default'} onClick={onClick} disabled={disabled}><Icon name={icon}/><span>{children}</span></DropdownMenuItem>;
}

export default function Files(){
  const {base,permissions,server}=useServer();
  const [query,setSearchQuery]=useSearchParams();
  const setQuery=(next:Record<string,string>)=>setSearchQuery({...next,manager:'v0'});
  const directory='/'+containerPath(query.get('directory')||'/'),file=query.get('file');
  const r=useAPI(file?null:`${base}/files/list?directory=${encodeURIComponent(directory)}`);
  const a=useAction();
  const [selected,setSelected]=useState<string[]>([]),[search,setSearch]=useState(''),[sort,setSort]=useState({key:'name',ascending:true});
  const [dialog,setDialog]=useState(''),[name,setName]=useState(''),[source,setSource]=useState(''),[mode,setMode]=useState('644'),[url,setURL]=useState('');
  const [draft,setDraft]=useState(()=>loadedDraft('','')),[editing,setEditing]=useState(false),[fileError,setFileError]=useState('');
  const dirty=!!file&&draft.path===file&&isDraftDirty(draft);
  const {attention,bar}=useFileNavigationGuard(dirty);
  const [menu,setMenu]=useState<OpenMenu|null>(null),[dragging,setDragging]=useState(false),[now,setNow]=useState(Date.now());
  const input=useRef<HTMLInputElement>(null),folderInput=useRef<HTMLInputElement>(null),selectAll=useRef<HTMLInputElement>(null),dragDepth=useRef(0);
  const entries=items(r.data);
  const selectedNames=new Set(selected);
  const visible=(r.loading?[]:entries).filter(f=>f.name.toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>{
    const folders=Number(a.is_file)-Number(b.is_file);
    if(folders)return folders;
    const order=sort.key==='name'?a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}):sort.key==='size'?Number(a.size||0)-Number(b.size||0):Date.parse(a.modified_at)-Date.parse(b.modified_at);
    return (sort.ascending?1:-1)*(order||a.name.localeCompare(b.name));
  });
  const allVisible=visible.length>0&&visible.every(f=>selectedNames.has(f.name));
  const someVisible=visible.some(f=>selectedNames.has(f.name));
  const full=(name:string)=>`${directory.replace(/\/$/,'')}/${name}`;
  const targets=source?[source]:selected;
  const detail=entries.find(f=>f.name===source);
  const writable=can(permissions,'file.update');
  const editable=can(permissions,'file.create');

  useEffect(()=>{setSelected([]);setSearch('');setMenu(null);setDragging(false);dragDepth.current=0},[base,directory]);
  useEffect(()=>{if(selectAll.current)selectAll.current.indeterminate=someVisible&&!allVisible},[someVisible,allVisible,file]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer)},[]);
  useEffect(()=>{if(!r.loading&&!file)setSelected(old=>old.filter(name=>entries.some(f=>f.name===name)))},[r.data,r.loading,file]);
  useEffect(()=>{
    if(!file){setDraft(loadedDraft('',''));setFileError('');setEditing(false);return}
    const abort=new AbortController();
    let active=true;
    setEditing(true);setFileError('');setMenu(null);setSelected([]);a.setSuccess('');
    void (async()=>{
      try{
        if(!can(permissions,'file.read-content'))throw new Error('You do not have permission to read this file.');
        const response=await fetch(`${base}/files/contents?file=${encodeURIComponent(file)}`,{signal:abort.signal});
        if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(body?.errors?.[0]?.detail||`Could not open file (${response.status})`)}
        const {decodeEditorFile}=await import('./editorLanguages');
        const text=decodeEditorFile(await response.arrayBuffer());
        if(active)setDraft(loadedDraft(file,text));
      }catch(error){if(active)setFileError(error instanceof Error?error.message:String(error))}
      finally{if(active)setEditing(false)}
    })();
    return()=>{active=false;abort.abort()};
  },[file,base]);

  function closeMenu(restoreFocus=false){
    if(restoreFocus&&menu?.anchor.isConnected)menu.anchor.focus();
    setMenu(null);
  }
  function openDir(path:string){
    setQuery({directory:'/'+containerPath(path)});setMenu(null);a.setSuccess('');
  }
  function openFile(path:string){
    if(!can(permissions,'file.read-content')||path===file)return;
    const next='/'+containerPath(path);
    setQuery({directory:next.split('/').slice(0,-1).join('/')||'/',file:next});setMenu(null);
  }
  function openDialog(kind:string,from=''){
    setMenu(null);setDialog(kind);setSource(from);setName(kind==='rename'?from:'');setURL('');
    if(kind==='chmod')setMode(entries.find(f=>f.name===from)?.mode_bits||'644');
    a.setSuccess('');
  }
  function action(path:string,body:unknown,method='POST',message='Changes saved.'){
    setMenu(null);
    return a.run(()=>api(`${base}/files/${path}`,json(method,body)),()=>{r.reload();setSelected([]);setDialog('');a.setSuccess(message)});
  }
  async function upload(list:FileList|null,folders=false){
    if(!list?.length||a.busy)return;
    const files=Array.from(list);
    await a.run(async()=>{
      // Wings strips paths from multipart filenames. Upload each directory separately.
      const groups=new Map<string,File[]>();
      for(const f of files){
        const relativePath=folders?containerPath(f.webkitRelativePath).split('/').slice(0,-1).join('/'):'';
        const group=groups.get(relativePath);if(group)group.push(f);else groups.set(relativePath,[f]);
      }
      for(const [relativePath,group] of groups){
        if(relativePath)await api(`${base}/files/create-folder`,json('POST',{root:directory,name:relativePath}));
        const d=value(await api(`${base}/files/upload`)),uploadURL=new URL(d.url,location.href);
        uploadURL.searchParams.set('directory',relativePath?full(relativePath):directory);
        const body=new FormData();for(const f of group)body.append('files',f,f.name);
        const response=await fetch(uploadURL,{method:'POST',body});
        if(!response.ok)throw new Error(`Upload failed (${response.status}): ${await response.text()}`);
      }
    },()=>a.setSuccess(`${files.length} ${files.length===1?'file':'files'} uploaded.`));
    r.reload();if(input.current)input.current.value='';if(folderInput.current)folderInput.current.value='';
  }
  function save(){
    if(!editable||!file||!dirty||a.busy)return;
    const path=file,text=draft.content;
    return a.run(()=>api(`${base}/files/write?file=${encodeURIComponent(path)}`,{method:'POST',headers:{'Content-Type':'text/plain'},body:text}),()=>{setDraft(current=>commitDraft(current,path,text));a.setSuccess('File saved.')});
  }
  function selectVisible(checked:boolean){
    setSelected(old=>checked?Array.from(new Set([...old,...visible.map(f=>f.name)])):old.filter(name=>!visible.some(f=>f.name===name)));
  }
  function changeSort(key:string){setSort(old=>({key,ascending:old.key===key?!old.ascending:true}));setMenu(null)}
  const breadcrumbDirectory=file?file.split('/').slice(0,-1).join('/')||'/':directory;
  const crumbs=breadcrumbDirectory.split('/').filter(Boolean);
  const titles:Record<string,string>={folder:'Create folder',new:'Create file',pull:'Download from URL',rename:'Rename file or folder',move:'Move selected items',chmod:'Change permissions',delete:`Delete ${targets.length===1?'item':'items'}`,details:'File details'};

  return <section aria-label="File manager" className={`file-browser${file?' is-editing':''}${selected.length&&!file?' has-selection':''}`} onDragEnter={event=>{
    if(!file&&!a.busy&&can(permissions,'file.create')&&event.dataTransfer.types.includes('Files')){event.preventDefault();dragDepth.current++;setDragging(true)}
  }} onDragLeave={()=>{dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false)}} onDragOver={event=>{
    if(event.dataTransfer.types.includes('Files'))event.preventDefault();
  }} onDrop={event=>{
    event.preventDefault();dragDepth.current=0;setDragging(false);
    if(!file&&can(permissions,'file.create'))void upload(event.dataTransfer.files);
  }}>
    <h1 className="sr-only">{file?'File editor':'Files'} · {server.name}</h1>
    <header className="files-toolbar">
      <div className="files-path">
        {!file&&<input ref={selectAll} type="checkbox" aria-label="Select all visible files" checked={allVisible} disabled={r.loading||a.busy||!visible.length} onChange={event=>selectVisible(event.target.checked)}/>}
        <nav aria-label="Directory breadcrumbs">
          <button type="button" onClick={()=>openDir('/')} aria-label="Container root">/ home / container /</button>
          {crumbs.map((part,index)=><span key={index}><button type="button" onClick={()=>openDir('/'+crumbs.slice(0,index+1).join('/'))}>{part}</button><span aria-hidden="true"> / </span></span>)}
          {file&&<span className="files-current-name" aria-current="page">{file.split('/').at(-1)}</span>}
        </nav>
      </div>
      <div className="files-controls">
        {file?<>
          <Button variant="secondary" onClick={()=>openDir(directory)}><Icon name="back"/>Back to files</Button>
        </>:<>
          <button type="button" className="file-icon-button file-tools-button" aria-label="File tools" title="File tools" aria-haspopup="menu" aria-expanded={menu?.kind==='tools'} onClick={event=>menu?.kind==='tools'?closeMenu():setMenu({kind:'tools',anchor:event.currentTarget})}><Icon name="wrench"/></button>
          {can(permissions,'file.create')&&<>
            <Button variant="secondary" onClick={()=>openDialog('folder')} disabled={a.busy}><Icon name="folderPlus"/>Create folder</Button>
            <Button onClick={()=>input.current?.click()} disabled={a.busy}><Icon name="upload"/>Upload</Button>
            <Button onClick={()=>folderInput.current?.click()} disabled={a.busy}><Icon name="files"/>Upload folder</Button>
            <Button onClick={()=>openDialog('new')} disabled={a.busy}><Icon name="newFile"/>New file</Button>
          </>}
        </>}
      </div>
      <input ref={input} hidden type="file" multiple aria-label="Upload files" onChange={event=>void upload(event.target.files)}/>
      <input ref={folderInput} hidden type="file" multiple {...{webkitdirectory:'',directory:''}} aria-label="Upload a folder" onChange={event=>void upload(event.target.files,true)}/>
    </header>
    <Notice action={a}/><PageError error={r.error}/>
    <div className={`files-workspace${file?' is-editing':''}`}>
    {file&&<FileExplorer key={base} base={base} activeFile={file} dirty={dirty} permissions={permissions} onOpen={openFile} onBrowse={()=>openDir(directory)}/>}
    {file?<div className={`file-editor-pane${dirty?' has-draft':''}`}>
      <div className="file-editor-panel">
        <div className="file-editor-title"><span><Icon name="file"/>{file.split('/').at(-1)}{dirty&&<i className="explorer-draft-dot" aria-label="Unsaved changes"/>}</span><button type="button" className="file-icon-button" aria-label="Close file editor" title="Close editor" onClick={()=>openDir(directory)}><Icon name="close"/></button></div>
        <PageError error={fileError}/>
        {editing||(!fileError&&draft.path!==file)?<p role="status">Loading file…</p>:draft.path===file&&!fileError?<Suspense fallback={<p role="status">Loading code editor…</p>}><FileEditor key={`${base}:${file}:${draft.revision}`} storageKey={base} path={file} content={draft.content} dirty={dirty} readOnly={!editable} onChange={content=>setDraft(current=>({...current,content}))} onSave={()=>void save()}/></Suspense>:<p className="muted">This file could not be loaded. Choose another file or return to the file browser.</p>}
      </div>
      {dirty&&<div key={attention} ref={bar} tabIndex={-1} className={`file-draft-bar${attention?' is-attention':''}`} role="region" aria-label="Unsaved file changes" data-attention={attention}>
        <div><Icon name="info"/><p role="status">{attention?'Save or discard your changes before leaving.':'You have unsaved changes.'}</p></div>
        <div className="actions"><Button variant="secondary" disabled={a.busy} onClick={()=>{setDraft(discardDraft);a.setError('');a.setSuccess('')}}>Discard</Button><Button className="draft-save" disabled={a.busy||!editable} onClick={()=>void save()}>{a.busy?'Saving…':'Save changes'}</Button></div>
      </div>}
    </div>:<>
      <div className="files-search"><Icon name="search"/><Input aria-label="Search files and folders" placeholder="Search files and folders…" value={search} onChange={event=>{setSearch(event.target.value);setMenu(null)}}/>{search&&<button type="button" className="file-icon-button" aria-label="Clear search" onClick={()=>setSearch('')}><Icon name="close"/></button>}</div>
      <div className="files-table-wrap" aria-busy={r.loading}>
        <table className="files-table" aria-label="Files and folders">
          <thead><tr><th className="file-select-column"><span className="sr-only">Selection</span></th>{[['name','Name'],['size','Size'],['modified','Modified']].map(([key,label])=><th key={key} className={`file-${key}-column`} scope="col" aria-sort={sort.key===key?sort.ascending?'ascending':'descending':'none'}><button type="button" className="file-sort" onClick={()=>changeSort(key)}>{label}{sort.key===key&&<span aria-hidden="true">{sort.ascending?'↑':'↓'}</span>}</button></th>)}<th className="file-menu-column"><span className="sr-only">File options</span></th></tr></thead>
          <tbody>
            {directory!=='/'&&<tr className="file-parent-row"><td/><td><button type="button" className="file-name-button" onClick={()=>openDir('/'+containerPath(directory.split('/').slice(0,-1).join('/')))}><Icon name="back"/><span>Parent directory</span></button></td><td className="file-size-column"/><td className="file-modified-column"/><td className="file-menu-column"/></tr>}
            {visible.map(f=><tr key={f.name} className={selectedNames.has(f.name)?'is-selected':''}>
              <td><input type="checkbox" aria-label={`Select ${f.name}`} checked={selectedNames.has(f.name)} disabled={a.busy} onChange={event=>setSelected(old=>event.target.checked?[...old,f.name]:old.filter(name=>name!==f.name))}/></td>
              <td><button type="button" className={`file-name-button${!f.is_file?' is-folder':''}`} title={f.name} disabled={editing||a.busy||(f.is_file&&!can(permissions,'file.read-content'))} onClick={()=>f.is_file?void openFile(full(f.name)):openDir(full(f.name))}><Icon name={f.is_file?'file':'files'}/><span>{f.name}</span>{f.is_symlink&&<span className="file-symlink" title="Symbolic link">↗</span>}</button></td>
              <td className="file-size-column">{f.is_file?bytes(f.size):'—'}</td>
              <td className="file-modified-column"><time dateTime={f.modified_at} title={date(f.modified_at)}>{modifiedAt(f.modified_at,now)}</time></td>
              <td className="file-menu-column"><button type="button" className="file-icon-button" aria-label={`More options for ${f.name}`} aria-haspopup="menu" aria-expanded={menu?.kind==='row'&&menu.file?.name===f.name} disabled={a.busy} onClick={event=>menu?.kind==='row'&&menu.file?.name===f.name?closeMenu():setMenu({kind:'row',file:f,anchor:event.currentTarget})}><Icon name="more"/></button></td>
            </tr>)}
          </tbody>
        </table>
        {!visible.length&&<div className="files-empty">{r.loading?<span role="status">Loading directory…</span>:r.error?'The file list could not be loaded. Use File tools to retry.':search?'No files or folders match your search.':<>This folder is empty.{can(permissions,'file.create')&&' Drop files here or use Upload.'}</>}</div>}
      </div>
      {!r.loading&&<p className="files-count">{search?`${visible.length} of ${entries.length} items`:`${entries.length} ${entries.length===1?'item':'items'}`}</p>}
      {selected.length>0&&<div className="file-selection-bar" role="toolbar" aria-label="Selected file actions"><span className="file-selection-count" role="status">{selected.length} selected</span>
        {writable&&<Button disabled={a.busy} onClick={()=>openDialog('move')}><Icon name="files"/>Move</Button>}
        {can(permissions,'file.archive')&&<Button disabled={a.busy} onClick={()=>void action('compress',{root:directory,files:selected},'POST','Archive created.')}><Icon name="archive"/>Archive</Button>}
        {can(permissions,'file.delete')&&<Button variant="danger" disabled={a.busy} onClick={()=>openDialog('delete')}><Icon name="trash"/>Delete</Button>}
        {writable&&<button type="button" className="file-icon-button" aria-label="More selection options" aria-haspopup="menu" aria-expanded={menu?.kind==='selection'} disabled={a.busy} onClick={event=>menu?.kind==='selection'?closeMenu():setMenu({kind:'selection',anchor:event.currentTarget})}><Icon name="more"/></button>}
        <button type="button" className="file-icon-button" aria-label="Clear selection" disabled={a.busy} onClick={()=>{setSelected([]);setMenu(null)}}><Icon name="close"/></button>
      </div>}
    </>}
    </div>
    {dragging&&<div className="file-drop-overlay"><Icon name="upload"/><strong>Drop files to upload</strong><span>Upload to /home/container{directory==='/'?'/':directory}</span></div>}
    {menu&&<FileMenu anchor={menu.anchor} label={menu.kind==='row'?`Options for ${menu.file!.name}`:menu.kind==='tools'?'File tools':'Selection options'} onClose={closeMenu}>
      {menu.kind==='tools'?<>
        <MenuItem icon="restart" onClick={()=>{closeMenu();r.reload()}}>Refresh files</MenuItem>
        {can(permissions,'file.create')&&<MenuItem icon="download" onClick={()=>openDialog('pull')}>Download from URL</MenuItem>}
      </>:menu.kind==='selection'?<MenuItem icon="lock" onClick={()=>openDialog('chmod')}>Change permissions</MenuItem>:<>
        {writable&&<MenuItem icon="edit" onClick={()=>openDialog('rename',menu.file!.name)}>Rename / move</MenuItem>}
        {menu.file!.is_file&&can(permissions,'file.read-content')&&<MenuItem icon="download" onClick={()=>{const path=full(menu.file!.name);closeMenu();void a.run(()=>download(`${base}/files/download?file=${encodeURIComponent(path)}`))}}>Download</MenuItem>}
        {menu.file!.is_file&&can(permissions,'file.create')&&<MenuItem icon="copy" onClick={()=>void action('copy',{location:full(menu.file!.name)},'POST','File duplicated.')}>Duplicate</MenuItem>}
        {can(permissions,'file.archive')&&<MenuItem icon="archive" onClick={()=>void action('compress',{root:directory,files:[menu.file!.name]},'POST','Archive created.')}>Archive</MenuItem>}
        {menu.file!.is_file&&/\.(zip|tar|gz|tgz|bz2|xz|rar|7z|br|lz|lz4|sz|zst)$/i.test(menu.file!.name)&&can(permissions,'file.create')&&<MenuItem icon="archive" onClick={()=>void action('decompress',{root:directory,file:menu.file!.name},'POST','Archive extracted.')}>Extract archive</MenuItem>}
        {writable&&<MenuItem icon="lock" onClick={()=>openDialog('chmod',menu.file!.name)}>Permissions</MenuItem>}
        <MenuItem icon="info" onClick={()=>openDialog('details',menu.file!.name)}>Details</MenuItem>
        {can(permissions,'file.delete')&&<><div className="file-menu-separator" role="separator"/><MenuItem icon="trash" danger onClick={()=>openDialog('delete',menu.file!.name)}>Delete</MenuItem></>}
      </>}
    </FileMenu>}
    {dialog&&<Modal title={titles[dialog]||dialog} onClose={()=>setDialog('')}>
      {dialog==='details'?<dl className="file-details">{[['Name',detail?.name],['Location',full(source)],['Type',detail?.is_symlink?'Symbolic link':detail?.is_file?'File':'Folder'],['Size',detail?.is_file?bytes(detail.size):'—'],['Permissions',detail?.mode_bits||detail?.mode],['Modified',date(detail?.modified_at)]].map(([label,text])=><div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>:<>
        <Notice action={a}/>
        <form onSubmit={event=>{
          event.preventDefault();
          if(dialog==='folder')void action('create-folder',{root:directory,name},'POST','Folder created.');
          if(dialog==='new')void a.run(()=>api(`${base}/files/write?file=${encodeURIComponent(full(name))}`,{method:'POST',headers:{'Content-Type':'text/plain'},body:''}),()=>{const path=full(name);setDialog('');setSelected([]);setQuery({directory,file:path})});
          if(dialog==='pull')void action('pull',{url,directory,filename:name||undefined,use_header:false,foreground:false},'POST','Download queued. Refresh the list to see the completed file.');
          if(dialog==='rename')void action('rename',{root:directory,files:[{from:source,to:name}]},'PUT','Item renamed.');
          if(dialog==='move')void action('rename',{root:'/',files:targets.map(from=>({from:containerPath(`${directory}/${from}`),to:containerPath(`${name.startsWith('/')?name:`${directory}/${name}`}/${from}`)}))},'PUT','Items moved.');
          if(dialog==='chmod')void action('chmod',{root:directory,files:targets.map(file=>({file,mode}))},'POST','Permissions updated.');
          if(dialog==='delete')void action('delete',{root:directory,files:targets},'POST',`${targets.length===1?'Item':'Items'} deleted.`);
        }}>
          {dialog==='delete'?<div className="file-delete-confirm"><p>Delete {targets.length} {targets.length===1?'file or folder':'files or folders'}? This cannot be undone.</p><ul>{targets.slice(0,6).map(name=><li key={name}>{name}</li>)}{targets.length>6&&<li>and {targets.length-6} more</li>}</ul></div>:<>
            {dialog==='pull'&&<Field label="Source URL"><Input type="url" required value={url} onChange={event=>setURL(event.target.value)}/></Field>}
            {dialog==='chmod'?<Field label="Unix permissions" hint="Use an octal mode, for example 644 or 755."><Input autoFocus required pattern="[0-7]{3,4}" value={mode} onChange={event=>setMode(event.target.value)}/></Field>:<Field label={dialog==='move'?'Destination directory':dialog==='rename'?'New name or relative path':dialog==='pull'?'File name (optional)':'Name'} hint={dialog==='move'?'Use / for the container root, an absolute directory, or a directory relative to the current location.':undefined}><Input autoFocus required={dialog!=='pull'} value={name} onChange={event=>setName(event.target.value)}/></Field>}
          </>}
          <div className="actions"><Button variant="secondary" disabled={a.busy} onClick={()=>setDialog('')}>Cancel</Button><Button type="submit" variant={dialog==='delete'?'danger':'default'} disabled={a.busy}>{a.busy?'Working…':dialog==='delete'?'Delete':dialog==='folder'?'Create folder':dialog==='new'?'Create file':dialog==='rename'?'Rename':dialog==='move'?'Move':dialog==='chmod'?'Save permissions':'Download'}</Button></div>
        </form>
      </>}
    </Modal>}
  </section>;
}
