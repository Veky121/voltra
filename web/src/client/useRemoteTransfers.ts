import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {mergeTransfers,reconcileTransfers,transferPollDelay,type RemoteTransfer} from './remoteTransferModel';
export type {RemoteTransfer} from './remoteTransferModel';
import {api} from '../lib';
import {captureErrorContext,reportPanelError} from '../notifications/store';
import {can,value} from './common';
import {mergeOperationEvent,operationEventsFromMessage,type OperationEvent} from './operationEvents';

export type RemoteOptions={url:string;directory:string;filename?:string;use_header?:boolean};
export const RemoteTransferContext=createContext<ReturnType<typeof useRemoteTransferQueue>|null>(null);

export function useRemoteTransferQueue(base:string,permissions:string[],onComplete:()=>void){
 const [records,setRecords]=useState<Record<string,RemoteTransfer>>({}),[error,setError]=useState('');
 const [operations,setOperations]=useState<OperationEvent[]>([]);
 const current=useRef({onComplete});current.current={onComplete};
 const known=useRef<Record<string,RemoteTransfer>>({});
 const generation=useRef(0);
 const loadRef=useRef<()=>Promise<void>>(async()=>{});
 const mergeRef=useRef<(entries:RemoteTransfer[])=>void>(()=>{});
 useEffect(()=>{
  generation.current++;
  let active=true,socket:WebSocket|null=null,reconnect:ReturnType<typeof setTimeout>|undefined,loading=false,socketReady=false,lastSnapshot=0;
  known.current={};setRecords({});setOperations([]);setError('');
  const canFiles=can(permissions,'file.read')||can(permissions,'file.create');
  const canConsole=can(permissions,'websocket.connect');
  const context=captureErrorContext('Server transfer');
  const merge=(entries:RemoteTransfer[],kind?:'upload'|'download',started?:Record<string,RemoteTransfer>)=>{
   if(!active)return;
   const next=kind&&started?reconcileTransfers(known.current,entries,kind,started):mergeTransfers(known.current,entries);
   const completed=entries.some(entry=>entry.state==='complete'&&known.current[entry.identifier]?.state!=='complete');
   for(const entry of entries){if(entry.state==='failed'&&known.current[entry.identifier]?.state!=='failed')reportPanelError(entry.error||'A server download failed. Open Transfers for details.',{...context,quiet:!known.current[entry.identifier]})}
   known.current=next;setRecords(next);
   if(completed)current.current.onComplete();
  };
  mergeRef.current=merge;
  const load=async()=>{
   if(loading||!active||!canFiles)return;loading=true;lastSnapshot=Date.now();
   const started=known.current;
   try{
    const results=await Promise.allSettled([api(`${base}/files/pulls`),api(`${base}/files/transfer-progress`)]);
    if(active){
     const failures:string[]=[];
     for(const [index,result] of results.entries()){
      if(result.status==='fulfilled'){
       const entries=result.value.transfers||[];
       merge(entries,index===0?'download':'upload',started);
      }
      else failures.push(result.reason instanceof Error?result.reason.message:String(result.reason));
     }
     setError(failures.join(' '));
    }
   }catch(e){if(active)setError(e instanceof Error?e.message:String(e))}
   finally{loading=false}
  };
  loadRef.current=load;
  const connect=async()=>{
   if(!active||!canConsole)return;
   try{
    const d=value(await api(`${base}/websocket`));if(!active)return;
    const u=new URL(d.socket,location.href);if(u.protocol==='http:')u.protocol='ws:';if(u.protocol==='https:')u.protocol='wss:';
    const connection=new WebSocket(u);socket=connection;
    connection.onopen=()=>{if(active&&socket===connection)connection.send(JSON.stringify({event:'auth',args:[d.token]}))};
    connection.onmessage=e=>{if(!active||socket!==connection)return;try{
     const m=JSON.parse(e.data);
     if(canFiles&&m.event==='download progress')merge([JSON.parse(m.args[0])]);
     const reports=operationEventsFromMessage(m);
     if(reports.length)setOperations(previous=>active?reports.reduce(mergeOperationEvent,previous):previous);
     if(m.event==='auth success'){socketReady=true;void load();connection.send(JSON.stringify({event:'send logs',args:[]}))}
     if(m.event==='token expiring'||m.event==='token expired'||m.event==='jwt error')connection.close();
    }catch{/* Ignore unrelated or malformed events. */}};
    connection.onclose=()=>{if(active&&socket===connection){socket=null;socketReady=false;reconnect=setTimeout(()=>void connect(),5000)}};
   }catch{if(active)reconnect=setTimeout(()=>void connect(),5000)}
  };
  if(!canFiles&&!canConsole)return ()=>{active=false};
  void load();void connect();
  // Reconcile missed terminal events and support users without socket permission.
  const timer=canFiles?setInterval(()=>{
   if(globalThis.document?.hidden)return;
   if(Date.now()-lastSnapshot>=transferPollDelay(Object.values(known.current),socketReady))void load();
  },5000):undefined;
  const visible=()=>{if(!globalThis.document?.hidden)void load()};
  globalThis.document?.addEventListener('visibilitychange',visible);
  const reset=()=>{generation.current++;active=false;clearInterval(timer);clearTimeout(reconnect);socket?.close();known.current={};setRecords({});setOperations([]);setError('')};
  window.addEventListener('panel-auth-changed',reset);window.addEventListener('desktop-session-rejected',reset);
  return()=>{generation.current++;active=false;clearInterval(timer);clearTimeout(reconnect);socket?.close();globalThis.document?.removeEventListener('visibilitychange',visible);window.removeEventListener('panel-auth-changed',reset);window.removeEventListener('desktop-session-rejected',reset)};
 },[base,permissions.join(',')]);
 async function start(options:RemoteOptions){
  const currentGeneration=generation.current;
  const result=await api(`${base}/files/pull`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...options,foreground:false,tracked:true})});
  if(currentGeneration!==generation.current)return;
  if(!result?.identifier)throw new Error('The node did not return a download identifier.');
  if(!known.current[result.identifier])mergeRef.current([{identifier:result.identifier,directory:options.directory,name:options.filename||new URL(options.url).pathname.split('/').pop()||'Download',state:'queued',progress:0,updated:0}]);
  void loadRef.current();
 }
 const canFilesNow=can(permissions,'file.read')||can(permissions,'file.create');
 return {transfers:canFilesNow?Object.values(records).sort((a,b)=>a.updated-b.updated):[],operations:can(permissions,'websocket.connect')?operations:[],error:canFilesNow?error:'',start,reload:()=>loadRef.current()};
}

export default function useRemoteTransfers(_base:string,_permissions:string[],onComplete:()=>void){
 const shared=useContext(RemoteTransferContext);
 const callback=useRef(onComplete);callback.current=onComplete;
 const previous=useRef(new Set<string>());
 useEffect(()=>{
  const completed=new Set(shared?.transfers.filter(entry=>entry.state==='complete').map(entry=>entry.identifier)||[]);
  if([...completed].some(id=>!previous.current.has(id)))callback.current();
  previous.current=completed;
 },[shared?.transfers]);
 if(!shared)throw new Error('Remote transfers require the server transfer provider.');
 return shared;
}
