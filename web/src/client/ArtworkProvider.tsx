import {useEffect,useSyncExternalStore,type ReactNode} from 'react';
import {api} from '../lib';
import {artworkSnapshot,setArtworkMapping,subscribeArtwork} from './artworkLibrary';
export function useArtworkLibrary(){return useSyncExternalStore(subscribeArtwork,artworkSnapshot,artworkSnapshot)}
export function ArtworkProvider({children}:{children:ReactNode}){
 useEffect(()=>{
  let active=true,pending=false,lastAttempt=0;
  setArtworkMapping(null);
  const refresh=()=>{
   if(pending||Date.now()-lastAttempt<30000)return;
   pending=true;lastAttempt=Date.now();
   api('/api/client/artwork/catalog').then(value=>{if(active)setArtworkMapping(value)}).catch(()=>{}).finally(()=>{pending=false});
  };
  refresh();const interval=window.setInterval(refresh,60000);
  window.addEventListener('focus',refresh);
  return()=>{active=false;clearInterval(interval);window.removeEventListener('focus',refresh);setArtworkMapping(null)};
 },[]);
 return children;
}
