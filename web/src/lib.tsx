import {useCallback,useEffect,useState} from 'react';
import type {ButtonHTMLAttributes,InputHTMLAttributes,SelectHTMLAttributes,TextareaHTMLAttributes,HTMLAttributes,ReactNode} from 'react';
import {Card as ShadcnCard} from './components/ui/card';
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
  const headers=new Headers(options.headers);
  headers.set('Accept','application/json');
  if(options.body&&!(options.body instanceof FormData)&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const response=await fetch(path,{...options,headers});
  if(response.status===401)window.dispatchEvent(new Event('desktop-session-rejected'));
  if(response.ok&&path==='/api/auth/logout')window.dispatchEvent(new Event('panel-auth-changed'));
  if(response.status===204)return undefined as T;
  const contentType=response.headers.get('content-type')||'';
  const data=contentType.includes('json')?await response.json():await response.text();
  if(!response.ok){
    const message=typeof data==='object'?(data.errors?.map((e:any)=>e.detail||e.message).join('\n')||data.message):data;
    throw new Error(message||`Request failed (${response.status})`);
  }
  if(path==='/api/admin/settings'&&options.method&&options.method.toUpperCase()!=='GET')window.dispatchEvent(new Event('panel-settings-changed'));
  return data as T;
}
export function unwrap(response:any):any{return response?.attributes??response}
export function rows(response:any):any[]{return (response?.data??[]).map((x:any)=>({...unwrap(x),...(x.meta?{_meta:x.meta}:{})}))}
export function useAPI<T=any>(path:string|null){const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(!!path),[version,setVersion]=useState(0);const reload=useCallback(()=>setVersion(v=>v+1),[]);useEffect(()=>{let cancelled=false;if(!path){setData(null);setLoading(false);return}setLoading(true);setError('');api<T>(path).then(v=>{if(!cancelled)setData(v)}).catch(e=>{if(!cancelled)setError(e.message)}).finally(()=>{if(!cancelled)setLoading(false)});return()=>{cancelled=true}},[path,version]);return {data,error,loading,reload}}
export function translate(dictionary:any,key:string,values:Record<string,any>={},fallback=key,locale='en'):string{const lookup=(path:string)=>path.split('.').reduce((value:any,part)=>value?.[part],dictionary);let found=lookup(key);if(values.count!==undefined&&Number.isFinite(Number(values.count))){let category='other';try{category=new Intl.PluralRules(locale).select(Number(values.count))}catch{}found=(Number(values.count)===0?lookup(`${key}_zero`):undefined)??lookup(`${key}_${category}`)??found}if(typeof found!=='string')return fallback;return found.replace(/{{([^}]+)}}/g,(_whole,path:string)=>{const value=path.split('.').reduce((v:any,p)=>v?.[p],values);return value===undefined?`{{${path}}}`:String(value)})}
export function useTranslation(namespace:string){const account=useAPI('/api/client/account');const locale=unwrap(account.data)?.language||'en';const local=useAPI(`/locales/locale.json?locale=${encodeURIComponent(locale)}&namespace=${encodeURIComponent(namespace)}`);const english=useAPI(locale==='en'?null:`/locales/locale.json?locale=en&namespace=${encodeURIComponent(namespace)}`);return useCallback((key:string,values:Record<string,any>={},fallback=key)=>translate(local.data?.[locale]?.[namespace],key,values,translate(english.data?.en?.[namespace],key,values,fallback),locale),[local.data,english.data,locale,namespace])}
type ButtonProps=ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'default'|'secondary'|'danger'};
export function Button({variant='default',className='',children,...props}:ButtonProps){return <button type="button" className={`button ${variant==='default'?'':variant} ${className}`} {...props}>{children}</button>}
export function Input(props:InputHTMLAttributes<HTMLInputElement>){return <input {...props}/>}
export {Select} from './ui/Select';
export function Textarea(props:TextareaHTMLAttributes<HTMLTextAreaElement>){return <textarea {...props}/>}
export function Field({label,hint,children}: {label:string,hint?:string,children:ReactNode}){return <label className="field"><span>{label}</span>{children}{hint&&<small className="muted">{hint}</small>}</label>}
export function Card({children,className='',...props}:HTMLAttributes<HTMLElement>){return <ShadcnCard as="section" data-ui="card" className={`card legacy-card scn:gap-0 scn:[--card-spacing:var(--ui-card-padding)] ${className}`} {...props}>{children}</ShadcnCard>}
export function ErrorBox({children}: {children?:ReactNode}){return children?<div className="error" role="alert">{children}</div>:null}
export function Loading(){return <div className="loading" role="status"><span className="spinner"/>Loading…</div>}
export function Empty({children}: {children?:ReactNode}){return <div className="empty">{children||'Nothing here yet.'}</div>}
export function Modal({title,onClose,children}: {title:string,onClose:()=>void,children:ReactNode}){useEffect(()=>{const fn=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};document.addEventListener('keydown',fn);return()=>document.removeEventListener('keydown',fn)},[onClose]);return <div className="modal-backdrop" onClick={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}><header><h2>{title}</h2><Button aria-label="Close dialog" variant="secondary" onClick={onClose}>×</Button></header>{children}</section></div>}
