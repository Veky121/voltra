import {useCallback,useEffect,useRef,useState,type SetStateAction} from 'react';
import {captureErrorContext,isErrorContextCurrent,reportPanelError} from './store';

type ErrorOptions={transient?:boolean};
// Transient action failures remain in notification history after leaving the page.
// Loading failures, validation and unsaved drafts keep their inline explanation.
export function useErrorState(source:string,{transient=false}:ErrorOptions={}){
 const [error,setState]=useState(''),current=useRef(''),active=useRef(true);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const context=captureErrorContext(source);
 useEffect(()=>{active.current=true;current.current='';setState('');return()=>{active.current=false;clearTimeout(timer.current)}},[context.page,context.epoch]);
 const setError=useCallback((next:SetStateAction<string>)=>{
  const message=typeof next==='function'?next(current.current):next;
  if(message)reportPanelError(message,context);
  if(!active.current||!isErrorContextCurrent(context))return;
  clearTimeout(timer.current);
  current.current=message;
  setState(message);
  if(message&&transient)timer.current=setTimeout(()=>{if(active.current&&isErrorContextCurrent(context)){current.current='';setState('')}},10000);
 },[source,context.page,context.epoch,transient]);
 return [error,setError] as const;
}
