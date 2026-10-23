import {useCallback,useEffect,useRef,useState} from 'react';
import {useBlocker,type BlockerFunction} from 'react-router-dom';

export default function useFileNavigationGuard(dirty:boolean,shouldBlock?:BlockerFunction){
  const [attention,setAttention]=useState(0);
  const bar=useRef<HTMLDivElement>(null);
  const blocker=useBlocker(useCallback<BlockerFunction>(event=>dirty&&(shouldBlock?shouldBlock(event):(event.currentLocation.pathname!==event.nextLocation.pathname||event.currentLocation.search!==event.nextLocation.search)),[dirty,shouldBlock]));
  useEffect(()=>{
    if(blocker.state==='blocked'){
      setAttention(n=>n+1);
      // Cancel the attempted navigation. Saving or discarding never jumps away unexpectedly.
      blocker.reset();
    }
  },[blocker]);
  useEffect(()=>{
    if(attention&&dirty){bar.current?.focus({preventScroll:true});bar.current?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}
  },[attention,dirty]);
  useEffect(()=>{if(!dirty)setAttention(0)},[dirty]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  return {attention,bar};
}
