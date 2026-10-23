import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {api,rows} from './lib';
import {Icon} from './Icons';

export type NavigationServer={uuid:string;identifier:string;name:string;egg_name?:string;status:string|null;favorite:boolean;last_visited_at:string|null};
type NavigationState={servers:NavigationServer[];loading:boolean;error:string;pending:Set<string>;reload:()=>void;visit:(id:string)=>void;favorite:(id:string,value:boolean)=>Promise<void>};
const Context=createContext<NavigationState>({servers:[],loading:true,error:'',pending:new Set(),reload:()=>{},visit:()=>{},favorite:async()=>{}});
export const useServerNavigation=()=>useContext(Context);

export function ServerNavigationProvider({children}:{children:ReactNode}){
 const [servers,setServers]=useState<NavigationServer[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0),[pending,setPending]=useState(new Set<string>());
 const busy=useRef(new Set<string>());
 const writeVersion=useRef(0);
 const reload=useCallback(()=>setRevision(v=>v+1),[]);
 useEffect(()=>{
  const abort=new AbortController();
  let timer:ReturnType<typeof setTimeout>;
  async function load(){
   const version=writeVersion.current;
   try{const data=await api('/api/client/account/server-navigation',{signal:abort.signal});if(!abort.signal.aborted){if(version!==writeVersion.current){reload();return;}setServers(rows(data));setError('');}}
   catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:String(e));}
   finally{if(!abort.signal.aborted){setLoading(false);timer=setTimeout(load,60000);}}
  }
  void load();
  return()=>{abort.abort();clearTimeout(timer)};
 },[revision]);
 useEffect(()=>{window.addEventListener('focus',reload);return()=>window.removeEventListener('focus',reload)},[reload]);
 const favorite=useCallback(async(id:string,value:boolean)=>{
  if(busy.current.has(id))return;
  busy.current.add(id);setPending(new Set(busy.current));setError('');
  try{
   await api(`/api/client/servers/${encodeURIComponent(id)}/navigation`,{method:'PUT',body:JSON.stringify({favorite:value})});
   writeVersion.current++;
   setServers(old=>old.map(s=>s.uuid===id||s.identifier===id?{...s,favorite:value}:s));
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{busy.current.delete(id);setPending(new Set(busy.current));}
 },[]);
 const visit=useCallback((id:string)=>{
  void api(`/api/client/servers/${encodeURIComponent(id)}/navigation`,{method:'POST'}).then(()=>{
   writeVersion.current++;
   setServers(old=>old.map(s=>s.uuid===id||s.identifier===id?{...s,last_visited_at:new Date().toISOString()}:s));
   reload();
  }).catch(e=>setError(e instanceof Error?e.message:String(e)));
 },[reload]);
 return <Context.Provider value={{servers,loading,error,pending,reload,visit,favorite}}>{children}</Context.Provider>;
}

export function FavoriteButton({id,name}:{id:string;name:string}){
 const nav=useServerNavigation(),server=nav.servers.find(s=>s.uuid===id||s.identifier===id);
 return <button type="button" className={`button secondary server-favorite${server?.favorite?' is-favorite':''}`} aria-label={`${server?.favorite?'Remove':'Add'} ${name} ${server?.favorite?'from':'to'} favorites`} title={server?.favorite?'Remove favorite':'Add to favorites'} aria-pressed={!!server?.favorite} disabled={!server||nav.pending.has(id)} onClick={()=>void nav.favorite(id,!server?.favorite)}><Icon name="star"/><span>{server?.favorite?'Favorited':'Favorite'}</span></button>;
}
