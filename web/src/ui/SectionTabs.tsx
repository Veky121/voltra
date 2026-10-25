import type {ReactNode} from 'react';
import {NavLink} from 'react-router-dom';
import './sectionTabs.css';

export type SectionTab={id:string;label:ReactNode;to?:string;end?:boolean;disabled?:boolean;controls?:string};
type Props={label:string;items:readonly SectionTab[];className?:string;scope?:string;active?:string;onChange?:(id:string)=>void;disabled?:boolean};

/** Route navigation and in-page tabs share one visual and keyboard contract. */
export function SectionTabs({label,items,className='',scope='section',active,onChange,disabled=false}:Props){
 const local=!!onChange;
 return <nav className={`section-tabs ${className}`} aria-label={label} role={local?'tablist':undefined}>
  {items.map((item,index)=>item.to!==undefined&&!local?
   <NavLink key={item.id} to={item.to} end={item.end} className="section-tab">{item.label}</NavLink>:
   <button key={item.id} type="button" role="tab" className={`section-tab${active===item.id?' active':''}`} id={`${scope}-tab-${item.id}`} aria-selected={active===item.id} aria-controls={item.controls??`${scope}-panel-${item.id}`} tabIndex={active===item.id?0:-1} disabled={disabled||item.disabled} onClick={()=>onChange?.(item.id)} onKeyDown={event=>{
    const enabled=items.filter(item=>!item.disabled),current=enabled.findIndex(item=>item.id===items[index].id);
    const target=event.key==='Home'?0:event.key==='End'?enabled.length-1:event.key==='ArrowRight'?(current+1)%enabled.length:event.key==='ArrowLeft'?(current+enabled.length-1)%enabled.length:-1;
    if(target<0||!enabled[target])return;
    event.preventDefault();onChange?.(enabled[target].id);
    document.getElementById(`${scope}-tab-${enabled[target].id}`)?.focus();
   }}>{item.label}</button>
  )}
 </nav>;
}
