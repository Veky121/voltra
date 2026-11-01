import {useCallback,useRef,useState,type SetStateAction} from 'react';
import {captureErrorContext,reportPanelError} from './store';

// Same setter contract as useState; reports before unmount can hide an error.
export function useErrorState(source:string){
 const [error,setState]=useState(''),current=useRef('');
 const context=captureErrorContext(source);
 const setError=useCallback((next:SetStateAction<string>)=>{
  const message=typeof next==='function'?next(current.current):next;
  current.current=message;
  if(message)reportPanelError(message,context);
  setState(message);
 },[source,context.page,context.epoch]);
 return [error,setError] as const;
}
