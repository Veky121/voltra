import {useEffect,useRef,useSyncExternalStore} from 'react';
import {useLocation} from 'react-router-dom';
import {AlertDialog,AlertDialogContent,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogAction,AlertDialogCancel} from '../components/ui/alert-dialog';
import './confirmAction.css';

type Options={title:string;description:string;confirmLabel?:string;danger?:boolean};
type Request=Options&{resolve:(accepted:boolean)=>void;origin:HTMLElement|null};
let current:Request|null=null;
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
const snapshot=()=>current;
function settle(accepted:boolean){const request=current;current=null;listeners.forEach(listener=>listener());request?.resolve(accepted)}
/** Await explicit consent before a mutation; navigation cancels pending consent. */
export function confirmAction(options:Options):Promise<boolean>{
  if(current)return Promise.resolve(false);
  return new Promise(resolve=>{current={...options,resolve,origin:document.activeElement instanceof HTMLElement?document.activeElement:null};listeners.forEach(listener=>listener())});
}
export function ConfirmActionLayer(){
  const request=useSyncExternalStore(subscribe,snapshot,snapshot),cancel=useRef<HTMLButtonElement>(null);
  const location=useLocation(),origin=useRef<HTMLElement|null>(null);
  const previous=useRef(request);
  if(request){origin.current=request.origin;previous.current=request}
  const display=request??previous.current;
  useEffect(()=>()=>settle(false),[location.key]);
  useEffect(()=>{
    const cancel=()=>settle(false);
    window.addEventListener('panel-auth-changed',cancel);window.addEventListener('desktop-session-rejected',cancel);
    return()=>{window.removeEventListener('panel-auth-changed',cancel);window.removeEventListener('desktop-session-rejected',cancel)};
  },[]);
  return <AlertDialog open={!!request} onOpenChange={open=>{if(!open)settle(false)}}>
    <AlertDialogContent className="confirm-action" initialFocus={cancel} finalFocus={origin}>
      <AlertDialogTitle>{display?.title}</AlertDialogTitle>
      <AlertDialogDescription>{display?.description}</AlertDialogDescription>
      <AlertDialogFooter><AlertDialogCancel ref={cancel}>Cancel</AlertDialogCancel><AlertDialogAction variant={display?.danger?'destructive':'default'} onClick={()=>settle(true)}>{display?.confirmLabel||'Continue'}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
