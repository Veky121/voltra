import {lazy,Suspense,useEffect,useRef,useState,type RefObject} from 'react';
import {api,Button} from '../lib';
import {Icon} from '../Icons';
import {can} from './common';
import {decodeEditorFile,isBinaryText} from './editorLanguages';
import {commitDraft,discardDraft,isDraftDirty,loadedDraft} from './fileDraft';
import {EDIT_LIMIT,VIEW_CHUNK,mixedNewlines,previewKind,readBounded,responseSize} from './fileDocumentSupport';
import './fileDocument.css';
const FileEditor=lazy(()=>import('./FileEditor'));
type Props={base:string;path:string;permissions:string[];onClose:()=>void;onDirtyChange?:(dirty:boolean)=>void;navigationGuard:{attention:number;bar:RefObject<HTMLDivElement|null>}};

async function checkResponse(response:Response){
  if(response.ok)return;
  const body=await response.json().catch(()=>null);
  throw new Error(body?.errors?.[0]?.detail||`File request failed (${response.status}).`);
}

export default function FileDocument(props:Props){
  // A path change must create a fresh document, baseline, and pending-request lifetime.
  return <DocumentSession key={`${props.base}:${props.path}`} {...props}/>;
}

function DocumentSession({base,path,permissions,onClose,onDirtyChange,navigationGuard}:Props){
  const [draft,setDraft]=useState(()=>loadedDraft(path,''));
  const [loading,setLoading]=useState(true),[opened,setOpened]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [kind,setKind]=useState<'text'|'image'|'audio'|'video'|'pdf'|'binary'|'large'>(previewKind(path));
  const [conflict,setConflict]=useState<string|null>(null),[reload,setReload]=useState(0);
  const [chunk,setChunk]=useState(''),[offset,setOffset]=useState(0),[size,setSize]=useState<number|null>(null),[ranged,setRanged]=useState(false),[chunkBusy,setChunkBusy]=useState(false);
  const alive=useRef(true),draftRef=useRef(draft);draftRef.current=draft;
  const dirty=kind==='text'&&isDraftDirty(draft),{attention,bar}=navigationGuard;
  const readable=can(permissions,'file.read-content'),writable=can(permissions,'file.create');
  const preview=`${base}/files/preview?file=${encodeURIComponent(path)}`;
  const download=`${base}/files/download-stream?file=${encodeURIComponent(path)}`;
  const contents=`${base}/files/contents?file=${encodeURIComponent(path)}`;
  const mixed=kind==='text'&&mixedNewlines(draft.saved);
  useEffect(()=>{onDirtyChange?.(dirty)},[dirty,onDirtyChange]);
  useEffect(()=>()=>{onDirtyChange?.(false)},[onDirtyChange]);

  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  useEffect(()=>{
    const abort=new AbortController();let active=true;
    setLoading(true);setOpened(false);setError('');setConflict(null);setNotice('');
    void(async()=>{
      try{
        if(!readable)throw new Error('You do not have permission to read this file.');
        const initialKind=previewKind(path);setKind(initialKind);
        if(initialKind!=='text'){setOpened(true);return;}
        // Fetch inert bytes for text detection so custom game-config extensions
        // can be edited without requiring a browser MIME preview allowlist.
        const response=await fetch(download,{signal:abort.signal,headers:{Range:`bytes=0-${EDIT_LIMIT}`}});
        // HTTP byte ranges on a zero-byte file are unsatisfiable. It is still
        // a valid editable document, including a newly created empty file.
        if(response.status===416&&response.headers.get('Content-Range')==='bytes */0'){
          if(active){setDraft(loadedDraft(path,''));setSize(0);setOpened(true)}return;
        }
        await checkResponse(response);
        const total=responseSize(response);setSize(total);setRanged(response.status===206);
        const data=await readBounded(response,EDIT_LIMIT+1);
        if(!active)return;
        setOpened(true);
        if(data.truncated||data.buffer.byteLength>EDIT_LIMIT||(total!==null&&total>EDIT_LIMIT)){
          const sample=new TextDecoder().decode(data.buffer.slice(0,VIEW_CHUNK));
          if(isBinaryText(sample)){setKind('binary');setNotice('This file requires a compatible desktop application.');return}
          setKind('large');setChunk(sample);setOffset(0);return;
        }
        try{setDraft(loadedDraft(path,decodeEditorFile(data.buffer)))}
        catch(e){setKind('binary');setNotice(e instanceof Error?e.message:String(e))}
      }catch(e){if(active)setError(e instanceof Error?e.message:String(e))}
      finally{if(active)setLoading(false)}
    })();
    return()=>{active=false;abort.abort()};
  },[base,path,readable,reload]);

  async function save(forceBaseline?:string){
    if(busy||!writable||!dirty||mixed)return;
    const saving=draftRef.current,expected=forceBaseline??saving.saved;
    setBusy(true);setError('');setNotice('');
    try{
      const current=await fetch(contents);await checkResponse(current);
      const bounded=await readBounded(current,EDIT_LIMIT+1);
      if(bounded.truncated||bounded.buffer.byteLength>EDIT_LIMIT)throw new Error('The remote file grew beyond the editor limit. Download it before replacing its contents.');
      const remote=decodeEditorFile(bounded.buffer);
      if(remote!==expected){if(alive.current)setConflict(remote);return}
      await api(`${base}/files/write?file=${encodeURIComponent(path)}`,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:saving.content});
      if(alive.current){setDraft(current=>commitDraft(current,path,saving.content));setConflict(null);setNotice('File saved.');}
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:String(e))}
    finally{if(alive.current)setBusy(false)}
  }

  async function loadChunk(next:number){
    if(chunkBusy)return;setChunkBusy(true);setError('');
    try{
      const response=await fetch(download,{headers:{Range:`bytes=${next}-${next+VIEW_CHUNK-1}`}});await checkResponse(response);
      if(next>0&&response.status!==206){await response.body?.cancel();throw new Error('This node does not support partial downloads. Download the file to view the remaining contents.');}
      const data=await readBounded(response,VIEW_CHUNK);
      if(alive.current){setChunk(new TextDecoder().decode(data.buffer));setOffset(next);setSize(responseSize(response));setRanged(response.status===206)}
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:String(e))}
    finally{if(alive.current)setChunkBusy(false)}
  }

  function close(){if(!dirty)onClose();else bar.current?.focus()}
  return <section className="file-document" aria-label={`File: ${path}`}>
    <header className="file-document-toolbar"><strong title={path}>{path}</strong><div>
      {readable&&<a className="button secondary" href={download} download={path.split('/').at(-1)}>Download</a>}
      <Button variant="secondary" onClick={close}>Back to files</Button>
      <button type="button" className="file-document-close" aria-label="Close file" title="Close file" onClick={close}><Icon name="close"/></button>
    </div></header>
    <div className="file-document-content">
    {error&&<div role="alert" className="error">{error}<Button variant="secondary" disabled={dirty||busy} onClick={()=>setReload(n=>n+1)}>Retry opening</Button></div>}
    {notice&&<p role="status" className="file-document-notice">{notice}</p>}
    {loading?<p role="status">Opening file...</p>:opened&&readable&&<>
      {kind==='text'&&<>
        {mixed&&<p className="file-document-notice">This file mixes newline formats. Preview is read only to preserve its bytes. Download it to edit without converting line endings.</p>}
        <Suspense fallback={<p role="status">Loading editor...</p>}><FileEditor key={draft.revision} path={path} storageKey={base} content={draft.content} dirty={dirty} readOnly={!writable||mixed} onChange={content=>setDraft(current=>({...current,content}))} onSave={()=>void save()}/></Suspense>
      </>}
      {kind==='image'&&<div className="file-document-media"><img src={preview} alt={path.split('/').at(-1)} onError={()=>setNotice('Your browser could not display this image. Download it to open it in another application.')}/></div>}
      {kind==='audio'&&<audio className="file-document-player" controls preload="metadata" src={preview} onError={()=>setNotice('Your browser does not support this audio format. Download it to use another player.')}/>}
      {kind==='video'&&<video className="file-document-player" controls preload="metadata" src={preview} onError={()=>setNotice('Your browser does not support this video format. Download it to use another player.')}/>}
      {kind==='pdf'&&<><p className="file-document-notice">If your browser cannot display the PDF, use Download.</p><iframe className="file-document-pdf" title={`PDF preview: ${path}`} src={preview} sandbox="allow-same-origin"/></>}
      {kind==='binary'&&<div className="file-document-empty"><h2>Download to open this file</h2><p>Text editing is available for UTF-8 files. Images, PDFs, audio and video use your browser's supported formats.</p></div>}
      {kind==='large'&&<>
        <div className="file-document-range"><p>Large file preview, read only. Showing bytes {offset.toLocaleString()} through {(offset+new TextEncoder().encode(chunk).length).toLocaleString()}{size!==null&&` of ${size.toLocaleString()}`}. A chunk may start or end inside a character or line.</p><div>
          <Button variant="secondary" disabled={chunkBusy||offset===0||!ranged} onClick={()=>void loadChunk(Math.max(0,offset-VIEW_CHUNK))}>Previous</Button>
          <Button variant="secondary" disabled={chunkBusy||!ranged||(size!==null&&offset+VIEW_CHUNK>=size)} onClick={()=>void loadChunk(offset+VIEW_CHUNK)}>Next</Button>
          <Button variant="secondary" disabled={chunkBusy||!ranged||size===null} onClick={()=>void loadChunk(Math.max(0,(size||0)-VIEW_CHUNK))}>End of file</Button>
          <Button variant="secondary" disabled={chunkBusy} onClick={()=>void loadChunk(offset)}>Refresh</Button>
        </div>{!ranged&&<p>This node only supports the first preview chunk. Use Download to read the complete file.</p>}</div>
        <pre className="file-document-log" aria-busy={chunkBusy} tabIndex={0}>{chunk}</pre>
      </>}
    </>}
    {conflict!==null&&<div className="file-document-conflict" role="alert"><h2>The file changed on the server</h2><p>Your draft is still here. Download the current server file before replacing it, or reload to use the server version.</p><div>
      <Button variant="secondary" disabled={busy} onClick={()=>{if(window.confirm('Discard your draft and load the current server file?')){setDraft(current=>({...loadedDraft(path,conflict),revision:current.revision+1}));setConflict(null)}}}>Use server version</Button>
      <Button variant="danger" disabled={busy} onClick={()=>void save(conflict)}>Replace server version with my draft</Button>
    </div></div>}
    </div>
    {dirty&&<div ref={bar} tabIndex={-1} className="file-document-draft" role="region" aria-label="Unsaved file changes" data-attention={attention}>
      <span>{attention?'Save or discard your changes before leaving.':'You have unsaved changes.'}</span><div>
        <Button variant="secondary" disabled={busy} onClick={()=>{setDraft(discardDraft);setConflict(null);setError('')}}>Discard changes</Button>
        <Button disabled={busy||!writable} onClick={()=>void save()}>{busy?'Saving...':'Save changes'}</Button>
      </div>
    </div>}
  </section>;
}
