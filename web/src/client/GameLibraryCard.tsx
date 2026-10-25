import './games-ui.css';
import {panelArtwork} from './artworkLibrary';
import {useArtworkLibrary} from './ArtworkProvider';
import {useState} from 'react';
import {Link} from 'react-router-dom';
import {Icon} from '../Icons';
import artworkCatalog from './gameArtwork.json';
import './gameLibraryCards.css';

export type GameArtwork={title:string;src:string;sourcePage:string;imageUrl:string;credit:string;fit?:string};
const assets:Record<string,GameArtwork>=artworkCatalog.assets;
export function gameArtwork(kind:'steam'|'templates'|'categories',id:string):GameArtwork|undefined{
  const mapping:Record<string,string>=artworkCatalog[kind];
  const key=mapping[id];const base=assets[key];return base?panelArtwork('library',key,base):undefined;
}
export const minecraftArtwork=()=>panelArtwork('library',artworkCatalog.categories.minecraft,assets[artworkCatalog.categories.minecraft]);

type Props={name:string;subtitle:string;artwork?:GameArtwork;to?:string;onClick?:()=>void;note?:string;noteTitle?:string;source?:string;disabledReason?:string;guided?:boolean};

export function GameLibraryCard({name,subtitle,artwork,to,onClick,note,noteTitle,source,disabledReason,guided}:Props){
  useArtworkLibrary();
  const [failed,setFailed]=useState('');
  const base=Object.values(assets).find(a=>a.title===artwork?.title);
  const key=Object.keys(assets).find(id=>assets[id].title===artwork?.title);
  const current=artwork&&key?panelArtwork('library',key,artwork):artwork;
  const displayed=current&&failed===current.src?base:current;
  const content=<>
    <div className={`library-card-art${artwork?.fit==='contain'?' library-card-art--logo':''}`}>
      {displayed?<img src={displayed.src} alt={`${displayed.title} artwork`} loading="lazy" decoding="async" width="460" height="215" onError={()=>setFailed(current?.src||'')}/>:<span className="library-art-unavailable">Image unavailable</span>}
      {guided&&<span className="library-card-kind">Guided setup</span>}
    </div>
    <div className="library-card-copy"><h3>{name}</h3><p>{subtitle}</p></div>
    {disabledReason&&<span className="library-card-action">{disabledReason}</span>}
  </>;
  return <article className="library-card games-ui">
    {to&&!disabledReason?<Link className="library-card-main" to={to}>{content}</Link>:onClick&&!disabledReason?<button type="button" className="library-card-main" onClick={onClick} aria-haspopup="dialog">{content}</button>:<div className="library-card-main library-card-main--disabled" aria-disabled="true">{content}</div>}
    {(note||source)&&<div className="library-card-foot"><span title={noteTitle}>{note}</span>{source&&<a href={source} target="_blank" rel="noreferrer" aria-label={`View recipe for ${name}`}>Recipe<Icon name="chevron"/></a>}</div>}
  </article>;
}

export function GameArtworkCredits(){
  return <details className="library-artwork-credits"><summary>Artwork credits</summary><p>Original Voltra typography and geometric tiles. Game names identify compatible software and remain the property of their respective owners. No publisher artwork or logos are included.</p><ul>{Object.entries(assets).sort(([,a],[,b])=>a.title.localeCompare(b.title)).map(([id,a])=><li key={id}><a href={a.sourcePage} target="_blank" rel="noreferrer">{a.title}</a><span>{a.credit}</span></li>)}</ul></details>;
}
