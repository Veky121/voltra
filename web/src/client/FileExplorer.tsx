import {Feedback} from '../notifications';
import {CollectionSkeleton} from '../ui/CollectionSkeleton';
import {IconButton} from '../ui/IconButton';
import {Checkbox} from '../components/ui/checkbox';
import {memo,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {api,useAPI} from '../lib';
import {nextFileSort,searchFileTree,sortFiles} from './fileListing';
import type {FileSort} from './fileListing';
import {Icon} from '../Icons';
import {bytes,can,items,type RecordData} from './common';
import {plainFileClick,type FileEntry} from './fileManagerModel';
import {fileEntrySize,fileEntryType,fileModifiedDate} from './fileMetadata';
import './fileMetadata.css';

type Controls={selected:string[];onSelect:(path:string)=>void;onMenu:(path:string,anchor:HTMLButtonElement)=>void};
type SearchResult={term:string;entries:Map<string,FileEntry[]>;folders:Set<string>};
type ScanControls={sizes:Record<string,number>;setSize:(path:string,size:number|undefined)=>void};
type Shared={sort:FileSort;scan:ScanControls;searchResult:SearchResult;base:string;activeFile:string;activeDirectory?:string;refreshToken:string;dirty:boolean;filter:string;permissions:string[];onOpen:(path:string)=>void;onDirectory?:(path:string)=>void;onEntries?:(path:string,files:FileEntry[])=>void;controls?:Controls&{membership:ReadonlySet<string>}};
function EntryCheck({path,controls}:{path:string;controls?:Controls&{membership:ReadonlySet<string>}}){return controls&&<label className="explorer-check-target" title={`Select ${path}`}><Checkbox className="explorer-check" aria-label={`Select ${path}`} checked={controls.membership.has(path)} onCheckedChange={()=>controls.onSelect(path)}/></label>}
function EntryMenu({path,controls}:{path:string;controls?:Controls}){return controls&&<IconButton type="button" className="explorer-menu" aria-label={`Options for ${path}`} aria-haspopup="menu" onClick={event=>controls.onMenu(path,event.currentTarget)}><Icon name="more"/></IconButton>}
const modifiedFormat=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const modifiedTitleFormat=new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'medium'});
const EntryMetadata=memo(function EntryMetadata({entry,path,folderSize,folderError}:{entry:FileEntry;path?:string;folderSize?:number;folderError?:boolean}){
  const modified=fileModifiedDate(entry.modified_at),size=fileEntrySize(entry),type=fileEntryType(entry);
  return <span className="explorer-metadata"><span className="explorer-modified" title={modified?modifiedTitleFormat.format(modified):'Date modified unavailable'}>{modified?<time dateTime={modified.toISOString()}>{modifiedFormat.format(modified)}</time>:'—'}</span><span className="explorer-type" title={type}>{type}</span><span className="explorer-size" aria-label={path?`Folder size for ${path}`:undefined} title={folderError?'Folder size unavailable. Refresh to retry.':path?'Total nested file size, excluding symbolic links. Cached for one minute.':size===null?'Size unavailable':`${size.toLocaleString()} bytes`}>{!entry.is_file&&!entry.is_symlink&&path?folderError?'—':folderSize===undefined?'…':bytes(folderSize):size===null?'—':bytes(size)}</span></span>;
});

// Keep unchanged file rows out of selection, draft and parent status updates.
const FileRow=memo(function FileRow({entry,path,depth,selected,active,dirty,compact,readable,onOpen,onSelect,onMenu}:{entry:FileEntry;path:string;depth:number;selected:boolean;active:boolean;dirty:boolean;compact:boolean;readable:boolean;onOpen:Shared['onOpen'];onSelect?:Controls['onSelect'];onMenu?:Controls['onMenu']}){
  return <li className={`explorer-file-row${selected?' is-selected':''}`}>
    {onSelect&&<label className="explorer-check-target" title={`Select ${path}`}><Checkbox className="explorer-check" aria-label={`Select ${path}`} checked={selected} onCheckedChange={()=>onSelect(path)}/></label>}
    <button type="button" className={`explorer-row explorer-file${active?' is-active':''}`} style={{paddingLeft:30+depth*14}} aria-label={`Open ${path}`} aria-current={active?'page':undefined} disabled={!readable} title={path} onClick={event=>{if(onSelect&&!plainFileClick(event)){onSelect(path);return}onOpen(path)}}><Icon name="file"/><span>{entry.name}</span>{active&&dirty&&<i className="explorer-draft-dot" aria-label="Unsaved changes"/>}</button>
    {!compact&&<EntryMetadata entry={entry}/>}
    {onMenu&&<IconButton type="button" className="explorer-menu" aria-label={`Options for ${path}`} aria-haspopup="menu" onClick={event=>onMenu(path,event.currentTarget)}><Icon name="more"/></IconButton>}
  </li>;
});
function Folder({path,label,entry,depth=0,...shared}:Shared&{path:string;label:string;entry?:FileEntry;depth?:number}){
  const activePath=shared.activeFile||shared.activeDirectory||'/';
  const containsActive=path==='/'||activePath===path||activePath.startsWith(path+'/');
  const [expanded,setExpanded]=useState(containsActive);
  const searching=!!shared.filter.trim();
  const open=expanded||searching;
  useEffect(()=>{if(containsActive)setExpanded(true)},[activePath,containsActive]);
  const listing=useAPI(expanded&&!searching?`${shared.base}/files/list?directory=${encodeURIComponent(path)}`:null);
  const sizePath=entry&&!entry.is_symlink&&!shared.activeFile?`${shared.base}/files/folder-size?directory=${encodeURIComponent(path)}`:null;
  const folderSize=useAPI(sizePath);
  const total=folderSize.error?undefined:folderSize.data?.attributes?.size;
  useEffect(()=>{if(typeof total==='number'||folderSize.error)shared.scan.setSize(path,total)},[total,folderSize.error,path,shared.scan.setSize]);
  const sizeRefresh=useRef(shared.refreshToken);
  useEffect(()=>{if(sizeRefresh.current===shared.refreshToken)return;sizeRefresh.current=shared.refreshToken;if(sizePath)folderSize.reload()},[shared.refreshToken,sizePath,folderSize.reload]);

  // Refresh expanded listings in place so rows and nested expansion survive.
  const refreshed=useRef(shared.refreshToken);
  useEffect(()=>{
    if(!expanded||refreshed.current===shared.refreshToken)return;
    refreshed.current=shared.refreshToken;
    listing.reload();
  },[expanded,shared.refreshToken,listing.reload]);
  const searchReady=searching&&shared.searchResult.term===shared.filter.trim().toLocaleLowerCase();
  const entries=useMemo(()=>searching?(searchReady?shared.searchResult.entries.get(path)||[]:[]):items(listing.data) as FileEntry[],[searching,searchReady,shared.searchResult,path,listing.data]);
  useEffect(()=>{if(entries.length||listing.data||searchReady)shared.onEntries?.(path,entries)},[entries,path,shared.onEntries,listing.data,searchReady]);
  const visible=useMemo(()=>{
    const filter=shared.filter.trim().toLocaleLowerCase();
    const sizes=Object.fromEntries(entries.map(entry=>[entry.name,shared.scan.sizes[`${path==='/'?'':path}/${entry.name}`]]));
    return sortFiles(entries.filter(entry=>!filter||(entry.is_file?entry.name.toLocaleLowerCase().includes(filter):searchReady&&shared.searchResult.folders.has(`${path==='/'?'':path}/${entry.name}`))),shared.sort,sizes);
  },[entries,shared.filter,shared.sort,shared.scan.sizes,shared.searchResult,searchReady,path]);
  return <li className="explorer-folder">
    <Feedback tone="error" message={folderSize.error?`Could not load the size of ${path}. Refresh to retry.`:''}/>
    <div className={`explorer-folder-row${shared.activeDirectory===path&&!shared.activeFile?' is-current':''}${shared.controls?.membership.has(path)?' is-selected':''}`}>
      {path!=='/'&&<EntryCheck path={path} controls={shared.controls}/>}
      {shared.onDirectory&&<button type="button" className="explorer-toggle" style={{left:10+depth*14+(shared.controls&&path!=='/'?40:0)}} aria-expanded={expanded} aria-label={`${expanded?'Collapse':'Expand'} ${path}`} onClick={()=>setExpanded(v=>!v)}><span className={`explorer-chevron${expanded?' is-expanded':''}`} aria-hidden="true">›</span></button>}
      <button type="button" className={`explorer-row explorer-folder-button${path==='/'?' explorer-root':''}`} aria-expanded={shared.onDirectory?undefined:expanded} aria-label={shared.onDirectory?`Browse ${path}`:`${expanded?'Collapse':'Expand'} ${path}`} aria-current={shared.activeDirectory===path&&!shared.activeFile?'page':undefined} style={{paddingLeft:shared.onDirectory?28+depth*14:10+depth*14}} title={path} onClick={event=>{if(shared.controls&&!plainFileClick(event)&&path!=='/'){shared.controls.onSelect(path);return}if(shared.onDirectory){setExpanded(value=>shared.activeDirectory===path?!value:true);shared.onDirectory(path)}else setExpanded(v=>!v)}}>
        {!shared.onDirectory&&<span className={`explorer-chevron${expanded?' is-expanded':''}`} aria-hidden="true">›</span>}<Icon name="files"/><span>{label}</span>
      </button>
      {entry&&!shared.activeFile&&<EntryMetadata entry={entry} path={path} folderSize={total} folderError={!!folderSize.error}/>}
      {path!=='/'&&<EntryMenu path={path} controls={shared.controls}/>}
    </div>
    {open&&<ul>
      {!searching&&listing.loading&&!listing.data?<li><CollectionSkeleton layout="files" label="Loading folder" count={5}/></li>:!searching&&!listing.data&&listing.error?<><Feedback tone="error" message={<>Could not load this folder.</>}/><button type="button" onClick={listing.reload}>Retry</button></>:<>
          {!searching&&listing.loading&&<li className="button-feedback-sr" role="status">Refreshing folder…</li>}

        {!searching&&listing.error&&<><Feedback tone="error" message={<>Could not refresh this folder.</>}/><button type="button" onClick={listing.reload}>Retry</button></>}
        {visible.map(entry=>{
          const entryPath=`${path==='/'?'':path}/${entry.name}`;
          return entry.is_file||entry.is_symlink||depth>=32?<FileRow key={entry.name} entry={entry as FileEntry} path={entryPath} depth={depth+1} selected={shared.controls?.membership.has(entryPath)||false} active={shared.activeFile===entryPath} dirty={shared.activeFile===entryPath&&shared.dirty} compact={!!shared.activeFile} readable={can(shared.permissions,'file.read-content')} onOpen={shared.onOpen} onSelect={shared.controls?.onSelect} onMenu={shared.controls?.onMenu}/>:<Folder key={entry.name} {...shared} path={entryPath} label={entry.name} entry={entry as FileEntry} depth={depth+1}/>;
        })}
        {!visible.length&&<li className="explorer-message">{shared.filter?'No matching files':'Empty folder'}</li>}
      </>}
    </ul>}
  </li>;
}

const FileExplorer=memo(function FileExplorer({base,activeFile,activeDirectory,dirty,permissions,onOpen,onBrowse,onDirectory,refreshKey=0,onEntries,controls}:{base:string;activeFile:string;activeDirectory?:string;dirty:boolean;permissions:string[];onOpen:(path:string)=>void;onBrowse:()=>void;onDirectory?:(path:string)=>void;refreshKey?:number;onEntries?:Shared['onEntries'];controls?:Controls}){
  const membership=useMemo(()=>new Set(controls?.selected),[controls?.selected]);
  const treeControls=useMemo(()=>controls?{...controls,membership}:undefined,[controls,membership]);
  const [filter,setFilter]=useState(''),[version,setVersion]=useState(0);
  const [sort,setSort]=useState<FileSort>(null),[sizes,setSizes]=useState<Record<string,number>>({});
  const [searchResult,setSearchResult]=useState<SearchResult>({term:'',entries:new Map(),folders:new Set()}),[searching,setSearching]=useState(false),[searchError,setSearchError]=useState('');
  const setSize=useCallback((path:string,size:number|undefined)=>setSizes(old=>{
    if(old[path]===size)return old;
    const next={...old};if(size===undefined)delete next[path];else next[path]=size;return next;
  }),[]);
  useEffect(()=>{setSizes(old=>Object.keys(old).length?{}:old)},[base,version,refreshKey]);
  const list=async(path:string,signal:AbortSignal)=>items(await api(`${base}/files/list?directory=${encodeURIComponent(path)}`,{signal})) as FileEntry[];
  useEffect(()=>{
    const controller=new AbortController(),term=filter.trim().toLocaleLowerCase();
    setSearchError('');setSearching(!!term);
    if(!term){setSearchResult(old=>old.term?{term:'',entries:new Map(),folders:new Set()}:old);return()=>controller.abort()}
    const timer=globalThis.setTimeout(async()=>{
      try{
        const result=await searchFileTree('/',term,list,controller.signal);
        if(!controller.signal.aborted){setSearchResult({term,entries:result.entries as Map<string,FileEntry[]>,folders:result.folders});setSearchError(result.errors.length?`Search is incomplete. ${result.errors.slice(0,3).join(' ')}`:'')}
      }catch{if(!controller.signal.aborted)setSearchError('Could not search folders. Refresh and try again.')}
      finally{if(!controller.signal.aborted)setSearching(false)}
    },300);
    return()=>{globalThis.clearTimeout(timer);controller.abort()};
  },[base,filter,version,refreshKey]);
  const scan:ScanControls={sizes,setSize};
  const header=(key:NonNullable<FileSort>['key'],label:string)=><button type="button" className="explorer-sort" onClick={()=>setSort(nextFileSort(sort,key))} aria-label={`${label}: ${sort?.key===key?sort.direction==='asc'?'ascending':'descending':'default order'}. Click to change sorting.`} title="Cycle ascending, descending and default order">{label}{sort?.key===key?sort.direction==='asc'?' ↑':' ↓':''}</button>;

  return <aside className={`file-explorer ${activeFile?'is-compact':'has-metadata'}`} aria-label="File explorer">
    <div className="file-explorer-header"><span>Explorer</span><div><button type="button" className="file-icon-button" aria-label="Refresh file explorer" title="Refresh files" onClick={()=>setVersion(v=>v+1)}><Icon name="restart"/></button><button type="button" className="file-icon-button" aria-label="Open full file browser" title="Open full file browser" onClick={onBrowse}><Icon name="files"/></button></div></div>
    <div className="file-explorer-search"><Icon name="search"/><input type="search" aria-label="Filter explorer files" placeholder="Filter files…" value={filter} onChange={event=>setFilter(event.target.value)}/></div>
    <Feedback tone="error" message={searchError}/>
    {searching&&<p className="explorer-message" role="status">Searching inside folders…</p>}
    {filter.trim()&&<p className="explorer-message">Matching files and their folders. Symbolic links are not searched.</p>}
    <nav aria-label="Server files" className="file-explorer-tree"><div className="explorer-columns"><span>{header("name","Name")}</span><span className="explorer-metadata"><span>{header("modified_at","Date modified")}</span><span>Type</span><span className="explorer-size">{header("size","Size")}</span></span><span className="explorer-action-space"/></div><ul><Folder key={base} sort={sort} scan={scan} searchResult={searchResult} refreshToken={`${version}:${refreshKey}`} path="/" label="/ home / container" base={base} activeFile={activeFile} activeDirectory={activeDirectory} dirty={dirty} filter={filter} permissions={permissions} onOpen={onOpen} onDirectory={onDirectory} onEntries={onEntries} controls={treeControls}/></ul></nav>
  </aside>;
});
export default FileExplorer;
