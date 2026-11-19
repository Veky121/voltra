import {Feedback} from './notifications';
import {Field as MiraField} from './components/ui/field';
import {Skeleton} from './components/ui/skeleton';
import {Empty as MiraEmpty,EmptyDescription} from './components/ui/empty';
import {useCallback} from 'react';
import {invalidateQueryCache,purgeQueryCache,normalizedQueryPath,setQueryCacheScope} from './hooks/queryCache';
export {invalidateQueryCache,purgeQueryCache,setQueryCacheScope} from './hooks/queryCache';
import {useAPIRequest} from './hooks/useAPIRequest';
import {bootReadsRevision,discardBootReads,rememberSignedIn,takeBootRead} from './bootReads';
import {clearAccountSnapshots,identifySnapshotAccount,releaseSnapshotAccount,snapshotRevisionInTurn,snapshotStoreIsShared} from './accountSnapshots';
import {moveSessionRevision,signedOutCount} from './signedOut';
import type {ButtonHTMLAttributes,InputHTMLAttributes,SelectHTMLAttributes,TextareaHTMLAttributes,HTMLAttributes,ReactNode} from 'react';
import {Button as ShadcnButton} from './components/ui/button';
import {Input as ShadcnInput} from './components/ui/input';
import {Textarea as ShadcnTextarea} from './components/ui/textarea';
import {Card as ShadcnCard} from './components/ui/card';
export function queryCacheSessionIdentity(session:any):string{return JSON.stringify([!!session?.authenticated,session?.user?.id??null,!!session?.user?.root_admin]);}
let sessionIdentity:string|undefined;
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{

  const headers=new Headers(options.headers);
  headers.set('Accept','application/json');
  if(options.body&&!(options.body instanceof FormData)&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const method=(options.method||'GET').toUpperCase();
  // A write may change what the reads started by startup.js describe.
  if(method!=='GET')discardBootReads();
  const mutationPath=normalizedQueryPath(path).split('?')[0];
  // An account read names who the saved pages belong to. Note what the store looked like
  // when the read began, here or in startup.js, so a late answer cannot name the wrong account.
  const identifying=mutationPath==='/api/client/account'&&method==='GET';
  const startedHere=identifying?snapshotRevisionInTurn():undefined,startedEarly=identifying?bootReadsRevision():undefined;
  const signOutsAtStart=signedOutCount();
  const early=method==='GET'?await takeBootRead(path,options.signal):undefined;
  const response=early??await fetch(path,{...options,headers});
  if(response.status===401)purgeQueryCache();
  if(response.ok&&mutationPath.startsWith('/api/auth/')&&mutationPath!=='/api/auth/session')purgeQueryCache();
  if(response.ok&&!['GET','HEAD','OPTIONS'].includes((options.method||'GET').toUpperCase())&&!mutationPath.startsWith('/api/auth/'))invalidateQueryCache(path);
  if(response.status===401)window.dispatchEvent(new Event('desktop-session-rejected'));
  // A sign-in starts from nothing, whatever an earlier session left behind unseen.
  if(response.ok&&mutationPath==='/api/auth/login'){moveSessionRevision();clearAccountSnapshots();}
  if(response.ok&&path==='/api/auth/logout')window.dispatchEvent(new Event('panel-auth-changed'));
  if(response.status===204){return undefined as T;}
  const contentType=response.headers.get('content-type')||'';
  let data:any;
  try{data=contentType.includes('json')?await response.json():await response.text()}
  catch(error){if(error instanceof SyntaxError)throw Object.assign(new Error('The panel returned an invalid JSON response.'),{status:response.status,code:'invalid_json'});throw error}
  if(!response.ok){
    const message=typeof data==='object'?(data.errors?.map((e:any)=>e.detail||e.message).join('\n')||data.message||(typeof data.error==='string'?data.error:undefined)):data;
    throw Object.assign(new Error(message||`Request failed (${response.status})`),{status:response.status,code:data?.errors?.[0]?.code,requestId:response.headers.get("X-Request-ID")||data?.errors?.[0]?.request_id});
  }
  if(path==='/api/admin/settings'&&options.method&&options.method.toUpperCase()!=='GET')window.dispatchEvent(new Event('panel-settings-changed'));
  if(mutationPath==='/api/auth/session'){
    const identity=queryCacheSessionIdentity(data);
    // Someone else is signed in now. This tab stops saving until the account is identified again.
    if(sessionIdentity!==undefined&&sessionIdentity!==identity)releaseSnapshotAccount();
    sessionIdentity=identity;
    setQueryCacheScope(identity);
  }
  if(identifying){
    // Names whose saved copies may be shown, and lets the next start ask for account reads early.
    const account=unwrap(data),id=account?.uuid??account?.id;
    // Waited for, so that whatever is drawn with this answer already knows whose saved pages it may read.
    if(id!==undefined&&id!==null&&id!==''){
      // An early answer began when startup.js noted the shared store's revision. A store that is
      // this page's own was not what startup.js looked at, so its revision at this call is used.
      await identifySnapshotAccount(String(id),early&&snapshotStoreIsShared()?startedEarly:await startedHere);
      // The note says account reads succeed. It is not written by an answer that a sign-out overtook.
      if(signOutsAtStart===signedOutCount())rememberSignedIn(true);
    }
  }

  return data as T;
}
export function unwrap(response:any):any{return response?.attributes??response}
export function rows(response:any):any[]{return (response?.data??[]).map((x:any)=>({...unwrap(x),...(x.meta?{_meta:x.meta}:{})}))}
export function useAPI<T=any>(path:string|null){return useAPIRequest<T>(path,api)}
export function translate(dictionary:any,key:string,values:Record<string,any>={},fallback=key,locale='en'):string{const lookup=(path:string)=>path.split('.').reduce((value:any,part)=>value?.[part],dictionary);let found=lookup(key);if(values.count!==undefined&&Number.isFinite(Number(values.count))){let category='other';try{category=new Intl.PluralRules(locale).select(Number(values.count))}catch{}found=(Number(values.count)===0?lookup(`${key}_zero`):undefined)??lookup(`${key}_${category}`)??found}if(typeof found!=='string')return fallback;return found.replace(/{{([^}]+)}}/g,(_whole,path:string)=>{const value=path.split('.').reduce((v:any,p)=>v?.[p],values);return value===undefined?`{{${path}}}`:String(value)})}
export function useTranslation(namespace:string){const account=useAPI('/api/client/account');const locale=unwrap(account.data)?.language||'en';const local=useAPI(`/locales/locale.json?locale=${encodeURIComponent(locale)}&namespace=${encodeURIComponent(namespace)}`);const english=useAPI(locale==='en'?null:`/locales/locale.json?locale=en&namespace=${encodeURIComponent(namespace)}`);return useCallback((key:string,values:Record<string,any>={},fallback=key)=>translate(local.data?.[locale]?.[namespace],key,values,translate(english.data?.en?.[namespace],key,values,fallback),locale),[local.data,english.data,locale,namespace])}
type ButtonProps=ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'default'|'secondary'|'danger'};
export function Button({variant='default',className='',children,...props}:ButtonProps){return <ShadcnButton type="button" variant={variant==='danger'?'destructive':variant} className={`button ${variant==='default'?'':variant} ${className}`} {...props}>{children}</ShadcnButton>}
export function Input(props:InputHTMLAttributes<HTMLInputElement>){return <ShadcnInput {...props}/>}
export {Select} from './ui/Select';
export function Textarea(props:TextareaHTMLAttributes<HTMLTextAreaElement>){return <ShadcnTextarea {...props}/>}
export function Field({label,hint,children}: {label:string,hint?:string,children:ReactNode}){return <MiraField as="label" className="field"><span>{label}</span>{children}{hint&&<small className="muted">{hint}</small>}</MiraField>}
export function Card({children,className='',...props}:HTMLAttributes<HTMLElement>){return <ShadcnCard as="section" data-ui="card" className={`card legacy-card scn:gap-0 scn:[--card-spacing:var(--ui-card-padding)] ${className}`} {...props}>{children}</ShadcnCard>}
export function ErrorBox({children}: {children?:ReactNode}){return <Feedback message={children} tone="error"/>}
export function Loading(){return <div className="loading" role="status"><Skeleton className="loading-skeleton"/>Loading…</div>}
export function Empty({children}: {children?:ReactNode}){return <MiraEmpty className="empty"><EmptyDescription>{children||'Nothing here yet.'}</EmptyDescription></MiraEmpty>}
export {Modal} from './ui/Modal';
