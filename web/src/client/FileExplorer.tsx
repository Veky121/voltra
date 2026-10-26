import {useEffect,useState} from 'react';
import {useAPI} from '../lib';
import {Icon} from '../Icons';
import {bytes,can,items,type RecordData} from './common';
import {plainFileClick,type FileEntry} from './fileManagerModel';
import {fileEntrySize,fileEntryType,fileModifiedDate} from './fileMetadata';
import './fileMetadata.css';

type Controls={selected:string[];onSelect:(path:string)=>void;onMenu:(path:string,anchor:HTMLButtonElement)=>void};
type Shared={base:string;activeFile:string;activeDirectory?:string;dirty:boolean;filter:string;permissions:string[];onOpen:(path:string)=>void;onDirectory?:(path:string)=>void;onEntries?:(path:string,files:FileEntry[])=>void;controls?:Controls};
function EntryCheck({path,controls}:{path:string;controls?:Controls}){return controls&&<label className="explorer-check-target" title={`Select ${path}`}><input type="checkbox" className="explorer-check" aria-label={`Select ${path}`} checked={controls.selected.includes(path)} onChange={()=>controls.onSelect(path)}/></label>}
function EntryMenu({path,controls}:{path:string;controls?:Controls}){return controls&&<button type="button" className="explorer-menu" aria-label={`Options for ${path}`} aria-haspopup="menu" onClick={event=>controls.onMenu(path,event.currentTarget)}><Icon name="more"/></button>}
function EntryMetadata({entry}:{entry:FileEntry}){
  const modified=fileModifiedDate(entry.modified_at),size=fileEntrySize(entry),type=fileEntryType(entry);
  return <span className="explorer-metadata"><span className="explorer-modified" title={modified?.toLocaleString()||'Date modified unavailable'}>{modified?<time dateTime={modified.toISOString()}>{modified.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>:'—'}</span><span className="explorer-type" title={type}>{type}</span><span className="explorer-size" title={size===null?entry.is_file?'Size unavailable':'Folder contents are not included in directory listing sizes':`${size.toLocaleString()} bytes`}>{size===null?'—':bytes(size)}</span></span>;
}
function Folder({path,label,entry,depth=0,...shared}:Shared&{path:string;label:string;entry?:FileEntry;depth?:number}){
  const activePath=shared.activeFile||shared.activeDirectory||'/';
  const containsActive=path==='/'||activePath===path||activePath.startsWith(path+'/');
  const [expanded,setExpanded]=useState(containsActive);
  useEffect(()=>{if(containsActive)setExpanded(true)},[activePath,containsActive]);
  const listing=useAPI(expanded?`${shared.base}/files/list?directory=${encodeURIComponent(path)}`:null);
  useEffect(()=>{if(listing.data)shared.onEntries?.(path,items(listing.data) as FileEntry[])},[listing.data,path,shared.onEntries]);
  const entries:RecordData[]=items(listing.data).sort((a,b)=>Number(a.is_file)-Number(b.is_file)||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
  const visible=entries.filter(entry=>!entry.is_file||entry.name.toLowerCase().includes(shared.filter.toLowerCase()));
  return <li className="explorer-folder">
    <div className={`explorer-folder-row${shared.activeDirectory===path&&!shared.activeFile?' is-current':''}${shared.controls?.selected.includes(path)?' is-selected':''}`}>
      {path!=='/'&&<EntryCheck path={path} controls={shared.controls}/>}
      {shared.onDirectory&&<button type="button" className="explorer-toggle" style={{left:10+depth*14+(shared.controls&&path!=='/'?40:0)}} aria-expanded={expanded} aria-label={`${expanded?'Collapse':'Expand'} ${path}`} onClick={()=>setExpanded(v=>!v)}><span className={`explorer-chevron${expanded?' is-expanded':''}`} aria-hidden="true">›</span></button>}
      <button type="button" className={`explorer-row explorer-folder-button${path==='/'?' explorer-root':''}`} aria-expanded={shared.onDirectory?undefined:expanded} aria-label={shared.onDirectory?`Browse ${path}`:`${expanded?'Collapse':'Expand'} ${path}`} aria-current={shared.activeDirectory===path&&!shared.activeFile?'page':undefined} style={{paddingLeft:shared.onDirectory?28+depth*14:10+depth*14}} title={path} onClick={event=>{if(shared.controls&&!plainFileClick(event)&&path!=='/'){shared.controls.onSelect(path);return}if(shared.onDirectory){setExpanded(value=>shared.activeDirectory===path?!value:true);shared.onDirectory(path)}else setExpanded(v=>!v)}}>
        {!shared.onDirectory&&<span className={`explorer-chevron${expanded?' is-expanded':''}`} aria-hidden="true">›</span>}<Icon name="files"/><span>{label}</span>
      </button>
      {entry&&<EntryMetadata entry={entry}/>}
      {path!=='/'&&<EntryMenu path={path} controls={shared.controls}/>}
    </div>
    {expanded&&<ul>
      {listing.loading?<li className="explorer-message" role="status">Loading…</li>:listing.error?<li className="explorer-message is-error">Could not load this folder.<button type="button" onClick={listing.reload}>Retry</button></li>:<>
        {visible.map(entry=>{
          const entryPath=`${path==='/'?'':path}/${entry.name}`;
          return entry.is_file||depth>=32?<li key={entry.name} className={`explorer-file-row${shared.controls?.selected.includes(entryPath)?' is-selected':''}`}><EntryCheck path={entryPath} controls={shared.controls}/><button type="button" className={`explorer-row explorer-file${shared.activeFile===entryPath?' is-active':''}`} style={{paddingLeft:30+(depth+1)*14}} aria-label={`Open ${entryPath}`} aria-current={shared.activeFile===entryPath?'page':undefined} disabled={!can(shared.permissions,'file.read-content')} title={entryPath} onClick={event=>{if(shared.controls&&!plainFileClick(event)){shared.controls.onSelect(entryPath);return}shared.onOpen(entryPath)}}><Icon name="file"/><span>{entry.name}</span>{shared.activeFile===entryPath&&shared.dirty&&<i className="explorer-draft-dot" aria-label="Unsaved changes"/>}</button><EntryMetadata entry={entry as FileEntry}/><EntryMenu path={entryPath} controls={shared.controls}/></li>:<Folder key={entry.name} {...shared} path={entryPath} label={entry.name} entry={entry as FileEntry} depth={depth+1}/>;
        })}
        {!visible.length&&<li className="explorer-message">{shared.filter?'No matching files':'Empty folder'}</li>}
      </>}
    </ul>}
  </li>;
}

export default function FileExplorer({base,activeFile,activeDirectory,dirty,permissions,onOpen,onBrowse,onDirectory,refreshKey=0,onEntries,controls}:{base:string;activeFile:string;activeDirectory?:string;dirty:boolean;permissions:string[];onOpen:(path:string)=>void;onBrowse:()=>void;onDirectory?:(path:string)=>void;refreshKey?:number;onEntries?:Shared['onEntries'];controls?:Controls}){
  const [filter,setFilter]=useState(''),[version,setVersion]=useState(0);
  return <aside className={`file-explorer ${activeFile?'is-compact':'has-metadata'}`} aria-label="File explorer">
    <div className="file-explorer-header"><span>Explorer</span><div><button type="button" className="file-icon-button" aria-label="Refresh file explorer" title="Refresh files" onClick={()=>setVersion(v=>v+1)}><Icon name="restart"/></button><button type="button" className="file-icon-button" aria-label="Open full file browser" title="Open full file browser" onClick={onBrowse}><Icon name="files"/></button></div></div>
    <div className="file-explorer-search"><Icon name="search"/><input type="search" aria-label="Filter explorer files" placeholder="Filter files…" value={filter} onChange={event=>setFilter(event.target.value)}/></div>
    <nav aria-label="Server files" className="file-explorer-tree"><div className="explorer-columns"><span>Name</span><span className="explorer-metadata"><span>Date modified</span><span>Type</span><span className="explorer-size">Size</span></span><span className="explorer-action-space"/></div><ul><Folder key={`${base}:${version}:${refreshKey}`} path="/" label="/ home / container" base={base} activeFile={activeFile} activeDirectory={activeDirectory} dirty={dirty} filter={filter} permissions={permissions} onOpen={onOpen} onDirectory={onDirectory} onEntries={onEntries} controls={controls}/></ul></nav>
  </aside>;
}
