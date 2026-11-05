import {matchesReadChange,readPolicy} from './readPolicy';
export type LiveSnapshot={status:number;data:any;invalidate?:boolean};
type Entry={listeners:Set<(sample:LiveSnapshot)=>void>;pending:Set<()=>void>;waiting?:boolean;at:number;sample?:LiveSnapshot};
const readListeners=new Map<string,Set<()=>void>>();
const changedDomains=new Set<string>();
let readTimer:ReturnType<typeof setTimeout>|undefined;
let eventDriven=false,heartbeatAt=0;
const entries=new Map<string,Entry>(),navigation=new Set<()=>void>();
let socket:WebSocket|undefined,attempt=0,revision=0,ready=false,attached=false;
let retry:ReturnType<typeof setTimeout>|undefined,refresh:ReturnType<typeof setTimeout>|undefined,subscriptions:ReturnType<typeof setTimeout>|undefined;
export function livePathAllowed(path:string):boolean {
 if(path==='/api/client?summary=overview&states=1')return true;
 const match=path.match(/^\/api\/client\/servers\/[^/?#%.\\]+(?:\/(resources|console-history|steam|backups|schedules|activity|users|files\/list))?(?:\?([^#]*))?$/);
 if(!match)return false;
 const family=match[1]||'',q=new URLSearchParams(match[2]||'');
 for(const [key,value] of q){
   if(q.getAll(key).length!==1)return false;
   if(family==='files/list'&&key==='directory'&&value.length<=1024&&!/[\x00\r\n]/.test(value))continue;
   if(family==='schedules'&&key==='include'&&value==='tasks')continue;
   if(['backups','activity'].includes(family)&&['page','per_page'].includes(key)&&/^\d+$/.test(value)&&Number(value)>0&&Number(value)<=(key==='per_page'?100:10000))continue;
   if(family==='backups'&&key==='sort'&&['newest','oldest','largest','smallest','name'].includes(value))continue;
   if(family==='backups'&&key==='origin'&&['manual','scheduled','unknown'].includes(value))continue;
   return false;
 }
 return path.length<=2048;
}
export function isLivePathFresh(path:string):boolean {
 const at=entries.get(path)?.at;
 if(!at||!ready)return false;
 const sampled=/\/(resources|console-history)(?:\?|$)/.test(path);
 return eventDriven&&!sampled?Date.now()-heartbeatAt<45000&&Date.now()-at<90000:Date.now()-at<12000;
}
function invalidateReads(domains:readonly string[]){
 for(const [path,entry] of entries)if(matchesReadChange(path,domains)){
   entry.at=0;entry.waiting=true;
   for(const listener of entry.pending)listener();
 }
 for(const domain of domains)changedDomains.add(domain);
 if(readTimer!==undefined)return;
 readTimer=setTimeout(()=>{readTimer=undefined;const changes=[...changedDomains];changedDomains.clear();for(const [path,listeners] of readListeners){if(matchesReadChange(path,changes))for(const listener of listeners)listener();}},250);
}
export function observeReadInvalidation(path:string,listener:()=>void):()=>void {
 let listeners=readListeners.get(path);if(!listeners){listeners=new Set();readListeners.set(path,listeners)}
 listeners.add(listener);ensureConnected();scheduleSubscriptions();
 return()=>{listeners.delete(listener);if(!listeners.size)readListeners.delete(path);scheduleSubscriptions();maybeStop()};
}
function invalidate(){if(refresh!==undefined)return;refresh=setTimeout(()=>{refresh=undefined;for(const listener of navigation)listener()},75)}
function clearFreshness(){for(const entry of entries.values())entry.at=0}
function sendSubscriptions(){
  subscriptions=undefined;if(!ready||!socket)return;
  const hidden=typeof document!=='undefined'&&document.hidden;
  socket.send(JSON.stringify({type:'subscribe',revision:++revision,paths:hidden?[]:[...entries.keys()].slice(0,64),domains:hidden?[]:[...new Set([...readListeners.keys(),...entries.keys()].flatMap(path=>readPolicy(path)?.domains||[]))].slice(0,16)}));
}
function scheduleSubscriptions(){clearTimeout(subscriptions);subscriptions=setTimeout(sendSubscriptions,75)}
function visibility(){clearFreshness();scheduleSubscriptions()}
function detachSocket(){
  ready=false;eventDriven=false;heartbeatAt=0;clearFreshness();clearTimeout(retry);clearTimeout(subscriptions);
  if(socket){socket.onclose=null;socket.onerror=null;socket.onmessage=null;socket.close();socket=undefined}
}
function detachListeners(){
  if(!attached)return;attached=false;window.removeEventListener('panel-auth-changed',authChanged);window.removeEventListener('desktop-session-rejected',authChanged);
  if(typeof document!=='undefined')document.removeEventListener('visibilitychange',visibility);
}
function authChanged(){
  detachSocket();clearTimeout(refresh);refresh=undefined;
  const old=[...entries.values()];entries.clear();navigation.clear();readListeners.clear();clearTimeout(readTimer);readTimer=undefined;changedDomains.clear();detachListeners();
  for(const entry of old)for(const listener of entry.listeners)listener({status:401,data:null});
}
function maybeStop(){if(entries.size||navigation.size||readListeners.size)return;detachSocket();clearTimeout(refresh);refresh=undefined;detachListeners();attempt=0}
function connect(){
  if(socket||(!entries.size&&!navigation.size&&!readListeners.size))return;
  const url=new URL('/api/client/events',window.location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';

  const reconnect=()=>{
    ready=false;socket=undefined;clearFreshness();if(!entries.size&&!navigation.size&&!readListeners.size)return;

    retry=setTimeout(connect,Math.min(30000,1000*2**Math.min(attempt++,5))*(0.8+Math.random()*0.4));
  };
  let current:WebSocket;try{current=socket=new WebSocket(url)}catch{reconnect();return}
  current.onmessage=event=>{
    if(socket!==current)return;
    let message:any;try{message=JSON.parse(String(event.data))}catch{return}
    if(!message||message.version!==1)return;
    if(message.type==='ready'){

      eventDriven=Array.isArray(message.capabilities)&&message.capabilities.includes('event-driven');heartbeatAt=Date.now();invalidateReads(['all']);
      attempt=0;ready=Array.isArray(message.capabilities)&&message.capabilities.includes('snapshots');invalidate();if(ready)scheduleSubscriptions();
    }else if(message.type==='heartbeat'){heartbeatAt=Date.now()}
    else if(message.type==='reads.invalidated'&&Array.isArray(message.domains)){invalidateReads(message.domains.filter((value:unknown)=>typeof value==='string'));}
    else if(message.type==='navigation.invalidated')invalidate();
    else if(['snapshot','invalidated','unchanged'].includes(message.type)&&message.revision===revision){
      const entry=entries.get(message.path);if(!entry||!Number.isInteger(message.status))return;
      entry.at=message.status===200?Date.now():0;heartbeatAt=Date.now();
      const waiting=entry.waiting;entry.waiting=false;
      if(message.type==='unchanged'){
        if(waiting&&entry.sample)for(const listener of entry.listeners)listener(entry.sample);
        return;
      }

      entry.sample={status:message.status,data:message.data,invalidate:message.type==='invalidated'};
      for(const listener of entry.listeners)listener(entry.sample);
    }
  };
  current.onclose=()=>{if(socket===current)reconnect()};current.onerror=()=>current.close();
}
function ensureConnected(){
  if(!attached){attached=true;window.addEventListener('panel-auth-changed',authChanged);window.addEventListener('desktop-session-rejected',authChanged);if(typeof document!=='undefined')document.addEventListener('visibilitychange',visibility)}
  connect();
}
export function observeLivePath(path:string,onSample:(sample:LiveSnapshot)=>void,onPending?:()=>void):(()=>void)|undefined {
  if(!livePathAllowed(path))return undefined;
  let entry=entries.get(path);if(!entry){entry={listeners:new Set(),pending:new Set(),at:0};entries.set(path,entry)}
  const observed=entry;observed.listeners.add(onSample);
  if(onPending)observed.pending.add(onPending);
  if(observed.sample&&isLivePathFresh(path))onSample(observed.sample);
  ensureConnected();scheduleSubscriptions();
  return()=>{observed.listeners.delete(onSample);if(onPending)observed.pending.delete(onPending);if(!observed.listeners.size&&entries.get(path)===observed){entries.delete(path);scheduleSubscriptions()}maybeStop()};
}
export function observeLiveNavigation(onInvalidate:()=>void):()=>void {
  const listener=()=>onInvalidate();navigation.add(listener);ensureConnected();return()=>{navigation.delete(listener);maybeStop()};
}
