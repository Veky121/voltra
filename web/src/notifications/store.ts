export type ErrorContext={source:string;page?:string;endpoint?:string;method?:string;status?:number;epoch?:number;quiet?:boolean;requestId?:string};
export type PanelNotification={id:string;title:string;message:string;source:string;page:string;endpoint:string;method:string;status?:number;firstAt:number;lastAt:number;count:number;read:boolean;resolved:boolean;requestId?:string;code?:string};
type Event={kind:'add'|'update';entry:PanelNotification}|{kind:'clear'};
let entries:PanelNotification[]=[],epoch=0,sequence=0,scope:unknown;
const listeners=new Set<()=>void>(),events=new Set<(event:Event)=>void>();
let reported=new WeakSet<object>();
export const notificationSnapshot=()=>entries;
export const subscribeNotifications=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
export const observeNotifications=(listener:(event:Event)=>void)=>{events.add(listener);return()=>{events.delete(listener)}};
function emit(event?:Event){for(const listener of listeners)listener();if(event)for(const listener of events)listener(event)}
export function safePath(value=''):string{
 if(!value)return '';
 try{const url=new URL(value,'http://panel.local');return url.pathname.replace(/\/(token|secret|password|authorize)\/[^/]+/gi,'/$1/[redacted]').slice(0,300)}catch{return ''}
}
export function redactMessage(value:unknown):string{
 let text=value instanceof Error?value.message:typeof value==='string'?value:'An unexpected error occurred.';
 text=text.replace(/-----BEGIN [\s\S]*?-----END [^-]+-----/g,'[redacted key]')
  .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi,'[redacted credential]')
  .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g,'[redacted token]')
  .replace(/(["']?(?:password|passwd|secret|secret_access_key|access_key|api[_-]?key|token|authorization|cookie)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1[redacted]')
  .replace(/https?:\/\/[^\s<>"']+/gi,url=>{try{const u=new URL(url);return `${u.protocol}//${u.host}${u.pathname}${u.search?'?[redacted]':''}`}catch{return '[redacted URL]'}})
  .replace(/([?&][\w%.-]+=)[^\s&#]*/g,'$1[redacted]');
 return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,1000);
}
export function captureErrorContext(source:string,extra:Partial<ErrorContext>={}):ErrorContext{
 return {source,page:typeof window==='undefined'?'':safePath(window.location?.pathname),epoch,...extra};
}
// Local UI updates must still belong to the page and account that started them.
// Notifications deliberately retain the captured page when an action finishes elsewhere.
export function isErrorContextCurrent(context:ErrorContext):boolean{
 const current=captureErrorContext(context.source);
 return context.epoch===current.epoch&&context.page===current.page;
}
function titleFor(context:ErrorContext){
 if(context.source==='WebSocket')return 'Live update failed';
 if(context.source==='Browser'||context.source==='Page rendering')return 'Panel error';
 if(context.endpoint)return ['GET','HEAD'].includes(context.method||'GET')?'Could not load data':'Action failed';
 return 'Action needs attention';
}
const safeErrorMessages:Record<string,string>={
 DaemonTimeoutException:'The node did not respond in time. The operation may still be running. Check the server state before trying again.',
 DaemonInterruptedException:'The request to the node was interrupted. Check the server state before trying again; the operation may still be running.',
 DaemonDNSException:'Voltra could not find the node hostname. Ask an administrator to check the node address and DNS settings.',
 DaemonConnectionException:'Voltra could not connect to the node. Ask an administrator to check the node connection and service status.',

 ProxyLocalPortReserved:'Public forwarding was blocked by a node port reservation. Choose a different assigned game port in Network, or ask an administrator to review the reservations. No new proxy route was created.',
};
function requestReference(value:unknown):string|undefined{
 return typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)?value:undefined;
}
export function reportPanelError(error:unknown,context:ErrorContext){
 if((error as any)?.name==='AbortError'||context.epoch!==undefined&&context.epoch!==epoch)return;
 if(error&&typeof error==='object'){if(reported.has(error))return;reported.add(error)}
 const rawCode=(error as any)?.code;
 const code=typeof rawCode==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(rawCode)?rawCode:undefined;
 const requestId=requestReference(context.requestId??(error as any)?.requestId);
 const safeMessage=code?Object.prototype.hasOwnProperty.call(safeErrorMessages,code)?safeErrorMessages[code]:undefined:undefined;
 const sensitive=/\/(?:auth|api-keys|ssh-keys|sftp-password|integrations|(?:game-|fs25-)?licen[cs]es|proxy-gateways|startup|variables|game-settings|configuration)(?:\/|$)/i.test(context.endpoint||'');
 const message=safeMessage||(sensitive?`Request failed${context.status?` (${context.status})`:''}. Check the originating page for details.`:redactMessage(error));if(!message.trim())return;
 const now=Date.now(),page=safePath(context.page),endpoint=context.endpoint?safePath(context.endpoint):'',method=(context.method||'').toUpperCase();
 // The same failure is often subsequently displayed by a local form. Keep the
 // transport record with its richer request context instead of another toast.
 if(!endpoint&&entries.some(e=>e.page===page&&now-e.lastAt<2000&&(e.message===message||e.message.endsWith('Check the originating page for details.')||e.code&&Object.prototype.hasOwnProperty.call(safeErrorMessages,e.code))))return;
 const previous=entries.find(e=>e.message===message&&e.page===page&&e.endpoint===endpoint&&e.method===method&&e.status===context.status&&!e.resolved);
 const entry:PanelNotification=previous?{...previous,lastAt:now,count:previous.count+1,requestId:requestId||previous.requestId}:{id:`panel-${++sequence}`,title:code==='ProxyLocalPortReserved'?'Public forwarding blocked':titleFor(context),message,source:context.source,page,endpoint,method,status:context.status,firstAt:now,lastAt:now,count:1,read:false,resolved:false,requestId,code};
 entries=[entry,...entries.filter(e=>e.id!==entry.id)].slice(0,200);
 emit({kind:previous||context.quiet?'update':'add',entry});
 return entry.id;
}
export function resolvePanelErrors(endpoint:string,method='GET',generation=epoch){
 if(generation!==epoch)return;
 const path=safePath(endpoint);let changed=false;
 entries=entries.map(e=>{if(!e.resolved&&e.endpoint===path&&e.method===method.toUpperCase()){changed=true;return {...e,resolved:true}}return e});
 if(changed)emit();
}
export function markNotificationsRead(){entries=entries.map(e=>({...e,read:true}));emit()}
export function dismissNotification(id:string){entries=entries.filter(e=>e.id!==id);emit()}
export function clearNotifications(){entries=[];emit({kind:'clear'})}
export function resetNotificationSession(){epoch++;scope=undefined;reported=new WeakSet();clearNotifications()}
export function setNotificationScope(value:unknown){if(scope===undefined){scope=value;return}if(!Object.is(scope,value)){resetNotificationSession();scope=value}}
export function exportNotificationLog(){return JSON.stringify({exportedAt:new Date().toISOString(),errors:entries},null,2)}
