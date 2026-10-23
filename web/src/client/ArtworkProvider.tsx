import {useEffect,useSyncExternalStore,type ReactNode} from 'react';
import {api} from '../lib';
import {artworkSnapshot,setArtworkMapping,subscribeArtwork} from './artworkLibrary';
export function useArtworkLibrary(){return useSyncExternalStore(subscribeArtwork,artworkSnapshot,artworkSnapshot)}
export function ArtworkProvider({children}:{children:ReactNode}){
 useEffect(()=>{let active=true;setArtworkMapping(null);api('/api/client/artwork/catalog').then(value=>{if(active)setArtworkMapping(value)}).catch(()=>{});return()=>{active=false;setArtworkMapping(null)}},[]);
 return children;
}
