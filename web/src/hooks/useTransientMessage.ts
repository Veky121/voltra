import {useCallback,useEffect,useRef,useState} from 'react';

export function useTransientMessage(duration=3000){
 const [message,setMessage]=useState('');
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const show=useCallback((value:string)=>{
  clearTimeout(timer.current);
  setMessage(value);
  if(value)timer.current=setTimeout(()=>setMessage(''),duration);
 },[duration]);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 return [message,show] as const;
}
