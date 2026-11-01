import {captureErrorContext,reportPanelError,resolvePanelErrors,type ErrorContext} from '../notifications/store';
export type LiveSnapshot={status:number;data:any;invalidate?:boolean};
type Entry={listeners:Set<(sample:LiveSnapshot)=>void>;at:number;context:ErrorContext;sample?:LiveSnapshot};
const entries=new Map<string,Entry>(),navigation=new Set<()=>void>();
let socket:WebSocket|undefined,attempt=0,revision=0,ready=false,attached=false;
let retry:ReturnType<typeof setTimeout>|undefined,refresh:ReturnType<typeof setTimeout>|undefined,subscriptions:ReturnType<typeof setTimeout>|undefined;
export function livePathAllowed(path:string):boolean {
  return path==='/api/client?summary=overview&states=1'||/^\/api\/client\/servers\/[^/?#%.\\]+(?:\/(?:resources|console-history|steam|backups|schedules|activity))?$/.test(path);
}
export function isLivePathFresh(path:string):boolean {const at=entries.get(path)?.at;return !!at&&ready&&Date.now()-at<12000}
function invalidate(){if(refresh!==undefined)return;refresh=setTimeout(()=>{refresh=undefined;for(const listener of navigation)listener()},75)}
function clearFreshness(){for(const entry of entries.values())entry.at=0}
function sendSubscriptions(){
  subscriptions=undefined;if(!ready||!socket)return;
  const hidden=typeof document!=='undefined'&&document.hidden;
  socket.send(JSON.stringify({type:'subscribe',revision:++revision,paths:hidden?[]:[...entries.keys()].slice(0,64)}));
}
function scheduleSubscriptions(){clearTimeout(subscriptions);subscriptions=setTimeout(sendSubscriptions,75)}
function visibility(){clearFreshness();scheduleSubscriptions()}
function detachSocket(){
  ready=false;clearFreshness();clearTimeout(retry);clearTimeout(subscriptions);
  if(socket){socket.onclose=null;socket.onerror=null;socket.onmessage=null;socket.close();socket=undefined}
}
function detachListeners(){
  if(!attached)return;attached=false;window.removeEventListener('panel-auth-changed',authChanged);window.removeEventListener('desktop-session-rejected',authChanged);
  if(typeof document!=='undefined')document.removeEventListener('visibilitychange',visibility);
}
function authChanged(){
  detachSocket();clearTimeout(refresh);refresh=undefined;
  const old=[...entries.values()];entries.clear();navigation.clear();detachListeners();
  for(const entry of old)for(const listener of entry.listeners)listener({status:401,data:null});
}
function maybeStop(){if(entries.size||navigation.size)return;detachSocket();clearTimeout(refresh);refresh=undefined;detachListeners();attempt=0}
function connect(){
  if(socket||(!entries.size&&!navigation.size))return;
  const url=new URL('/api/client/events',window.location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const connectionContext=captureErrorContext('WebSocket',{endpoint:'/api/client/events',method:'GET'});
  const reconnect=()=>{
    ready=false;socket=undefined;clearFreshness();if(!entries.size&&!navigation.size)return;
    if(attempt>=2)reportPanelError('Live updates disconnected. HTTP refresh remains available.',{...connectionContext,quiet:true});
    retry=setTimeout(connect,Math.min(30000,1000*2**Math.min(attempt++,5))*(0.8+Math.random()*0.4));
  };
  let current:WebSocket;try{current=socket=new WebSocket(url)}catch{reconnect();return}
  current.onmessage=event=>{
    if(socket!==current)return;
    let message:any;try{message=JSON.parse(String(event.data))}catch{return}
    if(!message||message.version!==1)return;
    if(message.type==='ready'){
      resolvePanelErrors('/api/client/events','GET',connectionContext.epoch);
      attempt=0;ready=Array.isArray(message.capabilities)&&message.capabilities.includes('snapshots');invalidate();if(ready)scheduleSubscriptions();
    }else if(message.type==='navigation.invalidated')invalidate();
    else if(['snapshot','invalidated','unchanged'].includes(message.type)&&message.revision===revision){
      const entry=entries.get(message.path);if(!entry||!Number.isInteger(message.status))return;
      entry.at=message.status===200?Date.now():0;
      if(message.type==='unchanged')return;
      if(message.status>=400)reportPanelError(message.data?.errors?.map((error:any)=>error.detail||error.message).join('\n')||`Live update failed (${message.status}).`,{...entry.context,status:message.status});
      else if(message.status===200)resolvePanelErrors(message.path,'GET',entry.context.epoch);
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
export function observeLivePath(path:string,onSample:(sample:LiveSnapshot)=>void):(()=>void)|undefined {
  if(!livePathAllowed(path))return undefined;
  let entry=entries.get(path);if(!entry){entry={listeners:new Set(),at:0,context:captureErrorContext('WebSocket',{endpoint:path,method:'GET'})};entries.set(path,entry)}
  const observed=entry;observed.listeners.add(onSample);
  if(observed.sample&&isLivePathFresh(path))onSample(observed.sample);
  ensureConnected();scheduleSubscriptions();
  return()=>{observed.listeners.delete(onSample);if(!observed.listeners.size&&entries.get(path)===observed){entries.delete(path);scheduleSubscriptions()}maybeStop()};
}
export function observeLiveNavigation(onInvalidate:()=>void):()=>void {
  const listener=()=>onInvalidate();navigation.add(listener);ensureConnected();return()=>{navigation.delete(listener);maybeStop()};
}
