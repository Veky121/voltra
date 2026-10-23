import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import Dashboard from '@uppy/react/dashboard';
import {api} from '../lib';
import {can} from './common';
import {transferIdentity,uploadTarget} from './fileTransferPaths';
import '@uppy/core/css/style.min.css';
import '@uppy/dashboard/css/style.min.css';
import './fileTransfers.css';

type TransferMeta={name:string;type?:string;filename?:string;directory?:string;relativePath?:string|null;filetype?:string;scope?:string};
type TransferBody=Record<string,unknown>;
type Queue=Uppy<TransferMeta,TransferBody>;
type Finalization={id:string;name:string;directory:string;url:string;state:'saving'|'failed'|'complete';error?:string};
export type FileTransfersHandle={addFiles:(files:File[],folder?:boolean,targetDirectory?:string)=>Promise<void>};
export type FileTransfersProps={base:string;directory:string;permissions:string[];onComplete:()=>void;onPendingChange?:(pending:boolean)=>void};

const FileTransfers=forwardRef<FileTransfersHandle,FileTransfersProps>(function FileTransfers(props,ref){
  const current=useRef(props);current.current=props;
  const [uppy,setUppy]=useState<Queue|null>(null),[error,setError]=useState(''),[expanded,setExpanded]=useState(false),[count,setCount]=useState(0);
  const [finalizations,setFinalizations]=useState<Record<string,Finalization>>({});
  const records=useRef<Record<string,Finalization>>({});
  const finalizeRef=useRef<(entry:Finalization)=>Promise<void>>(async()=>{});
  useEffect(()=>{
    let mounted=true;
    records.current={};setFinalizations({});
    const reportPending=()=>current.current.onPendingChange?.(queue.getFiles().some(f=>!f.progress.uploadComplete)||Object.values(records.current).some(f=>f.state!=='complete'));
    const update=(entry:Finalization)=>{records.current={...records.current,[entry.id]:entry};if(mounted){setFinalizations(records.current);reportPending()}};
    const finalize=async(entry:Finalization)=>{
      if(records.current[entry.id]?.state==='saving')return;
      update({...entry,state:'saving',error:undefined});
      try{
        await api(`${entry.url}/complete`,{method:'POST'});
        update({...entry,state:'complete'});
        if(mounted)current.current.onComplete();
      }catch(cause){update({...entry,state:'failed',error:cause instanceof Error?cause.message:String(cause)})}
    };
    finalizeRef.current=finalize;
    const queue=new Uppy<TransferMeta,TransferBody>({
      id:`file-transfers-${props.base}`,autoProceed:false,
      onBeforeFileAdded(file){
        if(!can(current.current.permissions,'file.create'))throw new Error('You do not have permission to upload files.');
        const directory=uploadTarget(String(file.meta.directory||current.current.directory),String(file.meta.relativePath||''),file.name||'');
        return {...file,id:transferIdentity(props.base,directory,file.id),meta:{...file.meta,directory,filename:file.name,filetype:file.type,scope:props.base}};
      },
    });
    queue.use(Tus,{endpoint:`${props.base}/files/transfers`,chunkSize:8*1024*1024,limit:3,withCredentials:true,
      allowedMetaFields:['filename','directory','filetype'],retryDelays:[0,1000,3000,5000,10000],
      onShouldRetry(err,_attempt,_options,next){const status=err.originalResponse?.getStatus();return status===401||status===403?false:next(err)},
    });
    queue.on('file-added',()=>{if(mounted){setCount(queue.getFiles().length);setExpanded(true);setError('');reportPending()}});
    queue.on('file-removed',file=>{
      if(mounted){setCount(queue.getFiles().length);reportPending()}
      const url=file.response?.uploadURL||file.tus?.uploadUrl;
      if(url&&!records.current[file.id])void fetch(url,{method:'DELETE',credentials:'same-origin',headers:{'Tus-Resumable':'1.0.0'}}).catch(()=>{});
    });
    queue.on('upload-success',(file,response)=>{
      if(!file)return;
      const url=response.uploadURL;
      if(!url){if(mounted)setError('The upload finished without a transfer URL. Please retry the file.');return}
      void finalize({id:file.id,name:file.name||'File',directory:String(file.meta.directory||'/'),url,state:'failed'});
    });
    queue.on('upload-error',(_file,cause)=>{if(mounted)setError(cause.message||'Upload failed. Retry the file to resume.')});
    const beforeUnload=(event:BeforeUnloadEvent)=>{
      if(queue.getFiles().some(f=>!f.progress.uploadComplete)||Object.values(records.current).some(f=>f.state!=='complete')){event.preventDefault();event.returnValue=''}
    };
    window.addEventListener('beforeunload',beforeUnload);
    setUppy(queue);
    void api(`${props.base}/files/transfers`).then(result=>{
      const max=result?.attributes?.max_file_size;
      if(mounted&&typeof max==='number'&&max>0)queue.setOptions({restrictions:{maxFileSize:max}});
    }).catch(cause=>{if(mounted)setError(cause instanceof Error?cause.message:String(cause))});
    return()=>{mounted=false;window.removeEventListener('beforeunload',beforeUnload);queue.destroy();current.current.onPendingChange?.(false);setUppy(null)};
  },[props.base]);
  useImperativeHandle(ref,()=>({async addFiles(files,folder=false,targetDirectory=current.current.directory){
    if(!uppy)throw new Error('Upload queue is starting. Please try again.');
    if(!can(current.current.permissions,'file.create'))throw new Error('You do not have permission to upload files.');
    setExpanded(true);setError('');
    const errors:string[]=[];
    for(const file of files){try{uppy.addFile({name:file.name,type:file.type,data:file,meta:{name:file.name,directory:targetDirectory,relativePath:folder?(file.webkitRelativePath||(file as File&{relativePath?:string}).relativePath):undefined}})}catch(cause){errors.push(cause instanceof Error?cause.message:String(cause))}}
    if(errors.length)setError(errors.join(' '));
  }}),[uppy]);
  async function discard(entry:Finalization){
    try{
      const response=await fetch(entry.url,{method:'DELETE',credentials:'same-origin',headers:{'Tus-Resumable':'1.0.0'}});
      if(!response.ok&&response.status!==404)throw new Error(`Could not discard transfer (${response.status}).`);
      const next={...records.current};delete next[entry.id];records.current=next;setFinalizations(next);
      if(uppy?.getFile(entry.id))uppy.removeFile(entry.id);
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}
  }
  const pending=Object.values(finalizations).filter(entry=>entry.state!=='complete');
  if(!can(props.permissions,'file.create')&&!count&&!pending.length)return null;
  return <section className="file-transfers" aria-label="File transfers">
    <button type="button" className="file-transfers-toggle" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><span>Transfers{count?` (${count})`:''}</span><span>{pending.length?`${pending.length} awaiting save`:'Pause, resume and retry uploads'} {expanded?'Hide':'Show'}</span></button>
    {error&&<div role="alert" className="file-transfers-error">{error}</div>}
    <div hidden={!expanded}>
      <p className="file-transfers-help">Files go to the folder open when you add them. Keep this page open to preserve your queue. Paused uploads resume from their last uploaded chunk. Uploaded files appear after saving to the server finishes.</p>
      {uppy&&<Dashboard uppy={uppy} theme="dark" height={320} width="100%" proudlyDisplayPoweredByUppy={false} hideProgressDetails={false} hideRetryButton={false} hidePauseResumeButton={false} hideCancelButton={false} disabled={!can(props.permissions,'file.create')} note={`Add files to ${props.directory}`} />}
      {Object.values(finalizations).map(entry=><div key={entry.id} className={`file-transfer-result is-${entry.state}`}><span><strong>{entry.name}</strong><small>{entry.directory}</small></span><span>{entry.state==='saving'?'Saving to server':entry.state==='complete'?'Saved to server':entry.error}</span>{entry.state==='failed'&&<><button type="button" onClick={()=>void finalizeRef.current(entry)}>Retry save</button><button type="button" onClick={()=>void discard(entry)}>Discard</button></>}</div>)}
    </div>
  </section>;
});
export default FileTransfers;




