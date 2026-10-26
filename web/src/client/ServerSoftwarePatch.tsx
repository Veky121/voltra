import {useState} from 'react';
import type {ServerSoftwareArtwork} from './serverSoftwareArtwork';

export function ServerSoftwarePatch({artwork}:{artwork:ServerSoftwareArtwork}){
  const [loaded,setLoaded]=useState(false),[failed,setFailed]=useState(false);
  if(failed)return null;
  return <span className="overview-software-patch" data-loaded={loaded} title={`Minecraft · ${artwork.name}`}>
    <img src={artwork.src} alt={`Minecraft · ${artwork.name}`} width={36} height={36} decoding="async" onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)}/>
  </span>;
}
