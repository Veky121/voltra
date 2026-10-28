export type QueryRequest = <T>(path:string,options?:RequestInit)=>Promise<T>;
type Snapshot = {data:any;error:string;loading:boolean};
type Entry = {path:string;request:QueryRequest;state:Snapshot;expires:number;listeners:Set<()=>void>;abort?:AbortController;flight?:Promise<void>;queued:boolean;version:number};
const entries=new Map<string,Entry>();
let epoch=0;
let sessionScope:unknown;
/** Pass a stable account/session identity on every session refresh. */
export function setQueryCacheScope(scope:unknown){if(!Object.is(scope,sessionScope)){sessionScope=scope;purgeQueryCache();}}
export function normalizedQueryPath(path:string):string {
  try{const base=typeof window!=='undefined'?window.location.origin:'http://localhost';const url=new URL(path,base);return url.origin===base?url.pathname+url.search:'';}catch{return '';}
}
const MAX_ENTRIES=100;
// Explicit allowlist: never widen this to arbitrary server child resources.
export function queryTTL(path:string):number {
  if(/^\/api\/client\/(account|settings)$/.test(path))return 15000;
  if(/^\/api\/client\/servers\/[^/?#]+\/files\/list\?directory=[^#]*$/.test(path))return 2000;
  if(/^\/api\/(admin|application)\/locations(?:\?[^#]*)?$/.test(path))return 15000;
  if(/^\/api\/client(?:\?[^#]*)?$/.test(path))return 5000;
  if(/^\/api\/client\/servers\/[^/?#]+$/.test(path))return 5000;
  if(/^\/api\/client\/game-library\/(templates|steam)(?:\?[^#]*)?$/.test(path))return 30000;
  return 0;
}
function emit(entry:Entry){for(const listener of entry.listeners)listener();}
function entryFor(path:string,request:QueryRequest){
  let entry=entries.get(path);
  if(entry&&entry.request!==request)return undefined;
  if(!entry){
    // Never evict an active consumer. Fall back to an uncached request at capacity.
    if(entries.size>=MAX_ENTRIES){const victim=[...entries].find(([,e])=>!e.listeners.size);if(victim){victim[1].abort?.abort();entries.delete(victim[0]);}else return undefined;}
    entry={path,request,state:{data:null,error:'',loading:false},expires:0,listeners:new Set(),queued:false,version:0};entries.set(path,entry);
  }
  return entry;
}
function load(entry:Entry,force=false){
  if(entry.flight){if(force)entry.queued=true;return;}
  if(!force&&entry.expires>Date.now())return;
  const generation=epoch,version=entry.version,abort=new AbortController();entry.abort=abort;
  entry.state={...entry.state,error:'',loading:true};emit(entry);
  // Install flight before invoking request, including synchronous errors.
  entry.flight=Promise.resolve().then(()=>entry.request(entry.path,{signal:abort.signal})).then(data=>{
    if(epoch===generation&&entry.version===version&&!abort.signal.aborted){entry.state={data,error:'',loading:false};entry.expires=Date.now()+queryTTL(entry.path);emit(entry);}
  },error=>{
    if(epoch===generation&&entry.version===version&&!abort.signal.aborted){entry.state={...entry.state,data:[401,403,404].includes(Number((error as any)?.status))?null:entry.state.data,error:error instanceof Error?error.message:String(error),loading:false};emit(entry);}
  }).finally(()=>{
    if(entry.abort!==abort)return;
    entry.flight=undefined;entry.abort=undefined;
    if(entry.queued&&entry.listeners.size){entry.queued=false;load(entry,true);}
  });
}
export function observeQuery(path:string,request:QueryRequest,listener:(state:Snapshot)=>void){
  if(!queryTTL(path))return undefined;
  const entry=entryFor(path,request);if(!entry)return undefined;
  const notify=()=>listener(entry.state);entry.listeners.add(notify);notify();load(entry);
  return {reload:()=>load(entry,true),unsubscribe:()=>{
    entry.listeners.delete(notify);
    if(!entry.listeners.size&&entry.flight){entry.version++;entry.abort?.abort();entry.abort=undefined;entry.flight=undefined;entry.queued=false;entry.state={...entry.state,loading:false};}
  }};
}
/** Call after any out-of-band mutation. Conservative invalidation also refreshes active readers. */
export function invalidateQueryCache(mutationPath?:string){
  const path=mutationPath===undefined?undefined:normalizedQueryPath(mutationPath).split('?')[0];
  if(path&&/\/(navigation|favorite|favourite)(?:\/|$)/.test(path))return;
  const server=path?.match(/^\/api\/client\/servers\/([^/]+)/)?.[1];
  for(const entry of entries.values()){
    if(path!==undefined){
      const key=entry.path.split('?')[0];
      const related=server?(key===`/api/client/servers/${server}`||key.startsWith(`/api/client/servers/${server}/`)||key==='/api/client'):
        path.startsWith('/api/client/account')?key==='/api/client/account':
        path.startsWith('/api/admin/')||path.startsWith('/api/application/')?key===path.split('/').slice(0,4).join('/')||key==='/api/client':
        /\/(uploads?|transfers?)\//.test(path)?key.startsWith('/api/client/servers/'):key===path;
      if(!related)continue;
    }
    entry.version++;entry.expires=0;entry.state={...entry.state,error:'',loading:false};
    entry.abort?.abort();entry.abort=undefined;entry.flight=undefined;entry.queued=false;emit(entry);
    if(entry.listeners.size)load(entry,true);
  }
}
/** Authentication boundary: fence all old responses and clear every consumer without refetching. */
export function purgeQueryCache(){
  epoch++;
  for(const entry of entries.values()){
    entry.version++;entry.expires=0;entry.abort?.abort();entry.abort=undefined;entry.flight=undefined;entry.queued=false;
    entry.state={data:null,error:'',loading:false};emit(entry);
    if(!entry.listeners.size)entries.delete(entry.path);
  }
}
if(typeof window!=='undefined'){
  window.addEventListener('panel-auth-changed',purgeQueryCache);
  window.addEventListener('desktop-session-rejected',purgeQueryCache);
}
