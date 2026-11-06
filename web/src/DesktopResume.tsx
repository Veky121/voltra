import {useEffect,useRef,useState,type ReactNode} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {Loading} from './lib';

// Mounted only after authentication. A relink gets a separate desktop profile.
export default function DesktopResume({children}:{children:ReactNode}){
 const location=useLocation(),navigate=useNavigate();
 const desktop=import.meta.env.VITE_DESKTOP==='true';
 const [ready,setReady]=useState(!desktop);
 const initialPath=useRef(location.pathname);
 const saves=useRef(Promise.resolve());
 useEffect(()=>{
  if(!desktop)return;
  let active=true;
  void fetch('/desktop/resume').then(async response=>{
   if(!response.ok)return;
   const state=await response.json();
   if(active&&initialPath.current==='/'&&typeof state.path==='string'&&/^\/(?:$|(?:server|account|admin|game-library)(?:\/[A-Za-z0-9_-]+)*\/?$)/.test(state.path)){
    await navigate(state.path,{replace:true});
   }
  }).catch(()=>{}).finally(()=>{if(active)setReady(true)});
  return()=>{active=false};
 },[desktop,navigate]);
 useEffect(()=>{
  if(!desktop||!ready)return;
  // Keep saves ordered while navigating quickly; this also survives port changes.
  saves.current=saves.current.then(async()=>{
   await fetch('/desktop/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:location.pathname}),keepalive:true});
  }).catch(()=>{});
 },[desktop,ready,location.pathname]);
 return ready?children:<Loading/>;
}
