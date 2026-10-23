import {useEffect,useState} from 'react';
import {getServerIconSources,type ServerIdentityArtwork} from './serverArtwork';
import './serverIdentity.css';

type Source=ReturnType<typeof getServerIconSources>[number];
function IconImage({sources,revision,lazy}:{sources:Source[];revision:number;lazy:boolean}){
  const [index,setIndex]=useState(0);
  const source=sources[index];
  if(!source)return null;
  return <img className="server-identity-icon" data-icon-source={source.kind} src={`${source.src}?v=${revision}`} alt="" aria-hidden="true" width={64} height={64} loading={lazy?'lazy':'eager'} decoding="async" title={source.kind==='server'?'Server icon':'Modpack artwork'} onError={()=>setIndex(value=>value+1)}/>;
}

export function ServerIdentityIcon({artwork,lazy=false}:{artwork?:ServerIdentityArtwork;lazy?:boolean}){
  const sources=getServerIconSources(artwork);
  const key=sources.map(source=>source.src).join('|');
  const [revision,setRevision]=useState(()=>Math.floor(Date.now()/60000));
  useEffect(()=>{
    if(!key)return;
    const refresh=()=>{if(!document.hidden)setRevision(Math.floor(Date.now()/60000))};
    const timer=setInterval(refresh,60000);
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)};
  },[key]);
  return <IconImage key={`${key}:${revision}`} sources={sources} revision={revision} lazy={lazy}/>;
}
