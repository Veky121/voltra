import {useEffect,useRef,useState} from 'react';
import {api} from '../lib';
import {can,value} from './common';

export type RemoteOptions={url:string;directory:string;filename?:string;use_header?:boolean};
export type RemoteTransfer={identifier:string;directory:string;name:string;state:'queued'|'downloading'|'complete'|'failed';progress:number;error?:string;updated:number};

export default function useRemoteTransfers(base:string,permissions:string[],onComplete:()=>void){
 const [records,setRecords]=useState<Record<string,RemoteTransfer>>({}),[error,setError]=useState('');
 const current=useRef({onComplete});current.current={onComplete};
 const known=useRef<Record<string,RemoteTransfer>>({});
 const loadRef=useRef<()=>Promise<void>>(async()=>{});
 const mergeRef=useRef<(entries:RemoteTransfer[])=>void>(()=>{});
 useEffect(()=>{
  let active=true,socket:WebSocket|null=null,reconnect:ReturnType<typeof setTimeout>|undefined,loading=false;
  known.current={};setRecords({});setError('');
  const merge=(entries:RemoteTransfer[])=>{
   if(!active)return;
   let completed=false;
   const next={...known.current};
   for(const entry of entries){
    if(!entry.identifier||entry.updated<(next[entry.identifier]?.updated||0))continue;
    if(['complete','failed'].includes(next[entry.identifier]?.state)&&['queued','downloading'].includes(entry.state))continue;
    if(entry.state==='complete'&&next[entry.identifier]?.state!=='complete')completed=true;
    next[entry.identifier]=entry;
   }
   known.current=next;setRecords(next);
   if(completed)current.current.onComplete();
  };
  mergeRef.current=merge;
  const load=async()=>{
   if(loading||!active)return;loading=true;
   try{const result=await api(`${base}/files/pulls`);if(active){merge(result.transfers||[]);setError('')}}
   catch(e){if(active)setError(e instanceof Error?e.message:String(e))}
   finally{loading=false}
  };
  loadRef.current=load;
  const connect=async()=>{
   if(!active||!can(permissions,'websocket.connect'))return;
   try{
    const d=value(await api(`${base}/websocket`));if(!active)return;
    const u=new URL(d.socket,location.href);if(u.protocol==='http:')u.protocol='ws:';if(u.protocol==='https:')u.protocol='wss:';
    socket=new WebSocket(u);
    socket.onopen=()=>socket?.send(JSON.stringify({event:'auth',args:[d.token]}));
    socket.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.event==='download progress')merge([JSON.parse(m.args[0])]);if(m.event==='auth success')void load();if(m.event==='token expiring'||m.event==='token expired'||m.event==='jwt error')socket?.close()}catch{/* Ignore unrelated or malformed events. */}};
    socket.onclose=()=>{if(active)reconnect=setTimeout(()=>void connect(),5000)};
   }catch{if(active)reconnect=setTimeout(()=>void connect(),5000)}
  };
  void load();void connect();
  // Reconcile missed terminal events and support users without socket permission.
  const timer=setInterval(()=>void load(),5000);
  return()=>{active=false;clearInterval(timer);clearTimeout(reconnect);socket?.close()};
 },[base,permissions.join(',')]);
 async function start(options:RemoteOptions){
  const result=await api(`${base}/files/pull`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...options,foreground:false,tracked:true})});
  if(!result?.identifier)throw new Error('The node did not return a download identifier.');
  if(!known.current[result.identifier])mergeRef.current([{identifier:result.identifier,directory:options.directory,name:options.filename||new URL(options.url).pathname.split('/').pop()||'Download',state:'queued',progress:0,updated:Date.now()}]);
  void loadRef.current();
 }
 return {transfers:Object.values(records).sort((a,b)=>a.updated-b.updated),error,start};
}
