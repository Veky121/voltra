import {useSyncExternalStore} from 'react';
export type UpdateStatus={channel:string;state:string;version:string;available_version?:string;error?:string};
type Snapshot={status:UpdateStatus|null;busy:boolean;error:string;checkedAt:number|null};
let snapshot:Snapshot={status:null,busy:false,error:'',checkedAt:null};
const listeners=new Set<()=>void>();
const publish=(value:Partial<Snapshot>)=>{snapshot={...snapshot,...value};listeners.forEach(listener=>listener());};
export function useDesktopUpdates(){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}},()=>snapshot,()=>snapshot);}
export async function updateAction(path:string,body:unknown={},automatic=false){
 if(snapshot.busy)return;
 if(automatic&&(snapshot.status?.state==='ready'||snapshot.status?.state==='available'||(snapshot.checkedAt!==null&&Date.now()-snapshot.checkedAt<60*60*1000)))return;
 publish({busy:true,error:''});
 try{
  const response=await fetch(`/desktop/${path}`,{method:path==='update-status'?'GET':'POST',headers:{'Content-Type':'application/json'},body:path==='update-status'?undefined:JSON.stringify(body),cache:'no-store'});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Update request failed.');
  publish({status:data,...(path==='updates'?{checkedAt:Date.now()}:{}),...(path==='update-channel'?{checkedAt:null}:{})});
 }catch(error){publish({error:(error as Error).message,...(path==='updates'?{checkedAt:Date.now()}: {})});}
 finally{publish({busy:false});}
}
export function startUpdateChecks(){
 let active=true;
 const initial=window.setTimeout(()=>{void updateAction('update-status').then(()=>{if(active)void updateAction('updates',{},true)})},250);
 const check=()=>{if(document.visibilityState==='visible')void updateAction('updates',{},true)};
 const interval=window.setInterval(check,60*60*1000);
 window.addEventListener('focus',check);
 return()=>{active=false;clearTimeout(initial);clearInterval(interval);window.removeEventListener('focus',check);};
}
